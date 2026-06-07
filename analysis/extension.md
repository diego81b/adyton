## 7. Browser Extension (Manifest V3)

### 7.1 Architecture Overview

```
extension/
├── manifest.json
├── popup/
│   ├── main.ts              # Vue 3 createApp, Pinia
│   ├── App.vue
│   └── components/
│       ├── LoginForm.vue
│       ├── VaultList.vue
│       ├── EntryCard.vue
│       └── PasswordGenerator.vue
├── content/
│   └── content.ts           # DOM injection, form detection, autofill
├── background/
│   └── service-worker.ts    # API calls, token refresh, message routing
├── options/
│   └── options.html         # Extension settings: server URL override
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

The popup is a standalone Vue 3 SPA bundled separately from the main web app. It uses Tailwind CSS (bundled, not NuxtUI) to keep the bundle small. State shared with the service worker uses `chrome.storage.session` as the synchronization layer.

### 7.2 Manifest V3 Key Decisions

```json
{
  "manifest_version": 3,
  "name": "Adyton",
  "version": "1.0.0",
  "permissions": ["storage", "cookies", "activeTab", "clipboardWrite"],
  "host_permissions": ["https://vault.example.com/*"],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": { "48": "icons/icon-48.png" }
  }
}
```

`host_permissions` is scoped to the API domain, not `<all_urls>`. The content script needs `<all_urls>` to detect password forms on any website, but it makes no API calls itself — all API communication is proxied through the service worker via `chrome.runtime.sendMessage`. This separation means credentials never leave through the content script's execution context.

The critical MV3 difference from MV2: the background service worker is ephemeral. Chrome may terminate it after 30 seconds of inactivity. `chrome.storage.session` (available since Chrome 102) fills this gap: it persists for the browser session, is not written to disk, and is accessible from both the service worker and popup.

### 7.3 Content Script — Form Detection and Autofill

```typescript
// content/content.ts
const observer = new MutationObserver(() => detectLoginForms());
observer.observe(document.body, { childList: true, subtree: true });
detectLoginForms();

function detectLoginForms() {
  const passwordFields = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  passwordFields.forEach(field => {
    if (field.dataset.vaultKeyAttached) return;
    field.dataset.vaultKeyAttached = 'true';
    injectAutofillButton(field);
  });
}

function injectAutofillButton(passwordField: HTMLInputElement) {
  const btn = document.createElement('button');
  btn.className = 'adyton-autofill-btn';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const domain = window.location.hostname;
    const response = await chrome.runtime.sendMessage({ type: 'AUTOFILL_REQUEST', domain });
    if (response?.credentials) {
      const usernameField = findAdjacentUsernameField(passwordField);
      if (usernameField) usernameField.value = response.credentials.username;
      passwordField.value = response.credentials.password;
      // Dispatch input events so SPA frameworks detect the fill
      [usernameField, passwordField].forEach(f =>
        f?.dispatchEvent(new Event('input', { bubbles: true }))
      );
    }
  });
  document.body.appendChild(btn);
}
```

SPA navigation is handled by intercepting `history.pushState` and `history.replaceState` with a 500ms delay to allow the SPA's new DOM to render before the detection pass runs.

The username field heuristic checks inputs within the same `<form>` element first, then within a ±300px vertical radius, filtering for `type="text"`, `type="email"`, or `name` attributes containing `user`, `email`, or `login`.

### 7.4 Background Service Worker

```typescript
// background/service-worker.ts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Keep the channel open for async response
});

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await chrome.storage.session.get('accessToken');
  const res = await fetch(`https://vault.example.com/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers
    },
  });
  if (res.status === 401) {
    await silentRefresh();
    return apiFetch(path, init); // Retry once
  }
  return res.json();
}

async function silentRefresh() {
  const res = await fetch('https://vault.example.com/api/auth/refresh', {
    method: 'POST',
    credentials: 'include', // Sends the httpOnly cookie
  });
  const data = await res.json();
  await chrome.storage.session.set({ accessToken: data.accessToken });
}
```

The service worker wakes on incoming messages and sleeps again when the handler resolves. If `chrome.storage.session` contains a valid access token from a previous wake cycle, the request proceeds without re-authentication.

### 7.5 Popup Application

The popup checks `chrome.storage.session` on mount. If an `accessToken` key exists, it shows the vault view. Otherwise it renders the login form. After successful login the access token is written to `chrome.storage.session`.

The vault list in the popup shows the top five entries matching the current domain, retrieved by calling through the service worker message bus. Copy buttons run:

```typescript
async function copyAndClear(text: string) {
  await navigator.clipboard.writeText(text);
  setTimeout(() => navigator.clipboard.writeText(''), 30_000);
}
```

### 7.6 Message Bus Protocol

```typescript
// packages/shared/src/extension-messages.ts
export type ExtensionMessage =
  | { type: 'AUTOFILL_REQUEST'; domain: string }
  | { type: 'AUTOFILL_RESPONSE'; credentials: { username: string; password: string } | null }
  | { type: 'VAULT_SEARCH'; query: string }
  | { type: 'VAULT_SEARCH_RESPONSE'; entries: DecryptedEntry[] }
  | { type: 'LOCK' }
  | { type: 'UNLOCK_REQUEST'; masterPassword: string }
  | { type: 'GET_USER_INFO' }
  | { type: 'USER_INFO_RESPONSE'; user: { email: string; totpEnabled: boolean } | null };
```

All message handlers in the service worker switch on `message.type` with exhaustive matching enforced by TypeScript's discriminated union. Adding a new message type to the union without a corresponding case causes a compile error.

---

### 7.7 Security Risks — Deferred to Post-V1

The extension phase was reviewed for security risks before implementation (2026-06-06) and moved to post-V1. The risks below must be resolved in the design before any code is written.

#### Critical — breaks zero-knowledge invariants

**Vault key storage (§7.4 is wrong as written)**
The analysis at §7.4 says `packages/shared` crypto is used "in service worker and popup". This is incorrect for the zero-knowledge model:

- `chrome.storage.session` is accessible from all extension contexts (SW, popup, options, content script). Storing the vault key there is equivalent to writing it to a shared variable any extension XSS can read.
- The service worker is ephemeral and terminates after ~30s of inactivity. It cannot hold a `CryptoKey` in memory across wake cycles.
- **Correct model:** vault key lives **only in popup JS memory** (never in `storage.session`, never in the SW). The popup derives the key on unlock, decrypts entries, and sends **plaintext only to itself**. The SW relays encrypted blobs from the API; the popup decrypts. Popup close = key gone (natural lock).
- Consequence: autofill from the content script requires the popup to be open. The SW cannot autofill autonomously. This is the safe trade-off.

#### High — new attack surface

**Message bus not authenticated by default**
`chrome.runtime.sendMessage` accepts messages from any extension context. Every handler in the SW must validate `sender.id === chrome.runtime.id` before processing. Without this, a page that discovers the extension ID can inject arbitrary messages.

**Autofill domain matching must be exact hostname**
The content script detects `window.location.hostname`. Domain matching against vault entries must be **exact hostname equality** (e.g. `example.com`), not suffix matching. Suffix matching allows `evil.example.com` to trigger autofill for `example.com` credentials (subdomain takeover vector).

**Content script DOM clobbering**
The content script runs at `document_idle` in the page's world. A malicious page can manipulate the DOM to inject fake `<input type="password">` fields and trigger the autofill button for a domain the user has credentials for. Mitigate: only inject the autofill button on visible, focusable fields (`offsetParent !== null`).

#### Medium — implementation details

**Clipboard clear on popup close**
The 30s clipboard clear uses `setTimeout` in the popup. If the popup closes before the timeout fires, the timer is destroyed and the password persists in the clipboard indefinitely. Fix: use `chrome.alarms` (survives popup close) to schedule the clear, not `setTimeout`.

**Autofill on hidden fields**
Some sites use `input[type="password"]` honeypots with `display:none`. The content script must skip fields where `offsetParent === null` or `visibility === 'hidden'` to avoid autofilling anti-bot traps.

**`<all_urls>` content script permission**
The content script requires `<all_urls>` host permission to detect forms on any website. This is a broad permission that Chrome flags to users. Must be documented and justified (the content script makes no API calls — all communication is proxied through the SW).

#### Low — supply chain

**Extension distribution**
For personal use (sideload), supply chain risk is zero. For Chrome Web Store distribution, a compromised Google account can push a malicious update. CI should sign the `.crx` with a developer key stored separately from the Web Store account.

---

### 7.8 Pre-implementation requirements

Before Phase 7 begins, the following design decisions must be locked:

1. Confirm vault key lives in popup memory only (not SW, not `storage.session`).
2. Define autofill flow when popup is closed: content script → SW → returns "vault locked, please open popup" → popup opens → user unlocks → autofill completes.
3. Define message bus sender validation pattern (whitelist `sender.id`).
4. Define exact hostname matching algorithm and edge cases (www. prefix, IP addresses, localhost).
5. Define clipboard clear mechanism (`chrome.alarms` vs `setTimeout` trade-off and popup lifecycle).

---

