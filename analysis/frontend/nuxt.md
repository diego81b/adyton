## 6. Frontend Architecture (Nuxt 4 + NuxtUI 4 + Pinia)

### 6.1 Nuxt 4 Setup

Nuxt 4 introduces a mandatory `app/` directory convention. All pages, components, composables, stores, and assets live under `app/`, keeping the project root clean for configuration and Docker files.

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  future: { compatibilityVersion: 4 },

  modules: ['@nuxt/ui', '@pinia/nuxt'],

  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? 'http://localhost/api',
    },
  },

  app: {
    head: {
      meta: [
        {
          'http-equiv': 'Content-Security-Policy',
          content: [
            "default-src 'self'",
            "script-src 'self' 'wasm-unsafe-eval'",  // Argon2id WASM requires this
            "style-src 'self' 'unsafe-inline'",
            "connect-src 'self'",
            "img-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
          ].join('; '),
        },
      ],
    },
  },

  ssr: true,
});
```

**`ssr: false` globally (SPA mode).** Every page is auth-gated; no content has SEO value. Web Crypto requires browser context — SSR would require transmitting decrypted data server-side, which violates the zero-knowledge model. SPA mode also eliminates per-request server rendering overhead in dev and prod. Individual `definePageMeta({ ssr: false })` calls are no longer needed but harmless to keep.

**CSP is applied in production only.** Nuxt dev mode injects inline scripts (HMR, `window.__NUXT__` state hydration) that violate a strict `script-src` policy. When CSP blocks those scripts, `window.__NUXT__` is undefined, `createNuxtApp` receives a non-object, and the Proxy constructor throws — crashing the entire app mount. The actual `nuxt.config.ts` gates the `Content-Security-Policy` header behind `process.env.NODE_ENV === 'production'`. In Phase 8 (production hardening), replace the static CSP header with `nuxt-security` nonce support for a proper solution that works with SSR + streaming.

### 6.2 Page Structure and Routing

**Source of truth: `analysis/frontend/mockups/adyton.html`.** The route map below was derived from the mockup after a coherence audit (2026-06-01). The mockup diverges from the original design in several places; the mockup wins.

The vault is a **flat, per-user model** — no groups. Entries belong directly to the authenticated user. The API is `/vault` (list/create) and `/vault/:id` (get/update/delete/versions).

```
app/pages/
├── index.vue                    # Redirects to /vault
├── login.vue                   # Email + password (Phase 4 + Step 0 retrofit — done; flat, not under auth/)
├── register.vue                # Email + master password + strength feedback (Phase 4 + Step 0 retrofit — done)
├── unlock.vue                  # Vault unlock / Argon2id KDF; re-hydrates session, shows account email (Phase 4 + Step 0 — done)
├── vault/
│   ├── index.vue                # All Items: type filter chips, real-time label search, cursor pagination, env dropdown
│   └── [id].vue                 # Entry detail: view + inline edit, reveal, copy, TOTP countdown (LOGIN), version history button
├── generator/
│   └── index.vue                # Password/passphrase generator with entropy arc
└── settings/
    └── index.vue                # Single scrollable page: Account + Security + Danger zone (in-page anchor nav on desktop)

app/components/
# Built in Phase 5 Step 0 (auth UI foundation):
├── AuthShell.vue               # Full-screen grid+glow backdrop, centered column, slots: brand / default / footer
├── AuthCard.vue                # Translucent themed card (NuxtUI bg-elevated/border-default)
├── BrandLogo.vue               # /logo.svg painted emerald via CSS mask + wordmark + tagline (props: size, pulse)
├── PasswordInput.vue           # UInput + lock leading icon + eye show/hide toggle (v-model)
├── PasswordStrengthMeter.vue   # 4-segment bar + label + entropy bits (presentational; fed by usePasswordStrength)
├── KeyDerivationStatus.vue     # "Deriving encryption key…" spinner during Argon2id
# Built in Phase 5 Steps 1–2 (app shell + vault UI):
├── VaultEntryModal.vue          # Add/Edit entry — USlideover (right panel ≥lg, bottom sheet <lg), unified for all types
├── LockOverlay.vue              # In-place lock overlay (triggered by auto-lock timer or lock button)
├── AppSidebar.vue               # Desktop left sidebar (3 nav items: Vault / Generator / Settings)
└── AppBottomNav.vue             # Mobile bottom nav bar (same 3 items)

app/composables/
└── usePasswordStrength.ts      # Debounced zxcvbn validation -> score/valid/feedback/segColor/label/bits (Step 0)
```

**Key divergences from original design doc:**

| Original doc | Mockup (authoritative) |
|---|---|
| Accent color: violet | Accent color: **emerald** (`#10b981`) |
| `/vault/env/new.vue` dedicated page | **VaultEntryModal** (type selector inside modal) |
| `/vault/secret/new.vue` dedicated page | **VaultEntryModal** (same modal, type = SECRET) |
| `/vault/env/[id]/versions.vue` page | History accessed via button on `/vault/[id].vue` |
| `/settings/security.vue` + `/settings/danger.vue` separate pages | **Single `/settings/index.vue`** with in-page anchors |
| Environment filter as dropdown on vault index | ~~Dedicated `/environments/` page~~ — superseded again 2026-06-03: filters live in the `VaultFilters` slideover on `/vault` (see deviation note below) |
| TOTP only in Phase 6 (2FA setup) | **Per-LOGIN-entry TOTP field** (secret + countdown + copy) |

**Navigation (desktop sidebar + mobile bottom nav):**
1. Vault — `/vault` — all entry types, type-filter chips
2. Generator — `/generator` — password/passphrase
3. Settings — `/settings` — account + security + danger

> **Deviation (2026-06-03): the dedicated `/environments` view was dropped.** It was only a
> pre-filtered vault (ENV_FILE + SECRET by `environmentTag`) rendering the same cards — not
> worth a dedicated route. The type + environment filters now live in an in-list `VaultFilters`
> slideover on `/vault`. The nav item was removed. Re-introduce a dedicated view only if a
> genuinely distinct grouped UX is justified later.

**Accent:** `app.config.ts` uses `primary: 'emerald'`. The mockup aliases emerald onto the `violet` Tailwind key for inline CSS, but NuxtUI uses the `primary` token directly — no aliasing needed. Solid emerald buttons need an explicit `text-white` (NuxtUI's solid variant uses inverted = dark label text in dark mode).

**Auth integration contract (learned in Step 0 — do not regress):**
- The API uses `setGlobalPrefix('api')`, so every route is `/api/...`. `NUXT_PUBLIC_API_BASE_URL` must end in `/api`; the refresh cookie `path` must be `/api/auth` (otherwise the browser never sends it and the session is lost on reload).
- `useAuthStore().apiFetch` must NOT set `Content-Type: application/json` on no-body POSTs (`/auth/refresh`, `/auth/logout`) — Fastify rejects an empty JSON body with 400.
- Master-password strength (zxcvbn score ≥ 4, char classes, weak patterns, HIBP breach) is enforced **client-side only**; the backend checks length ≥ 12. Register must surface `usePasswordStrength` feedback so a disabled submit has a visible reason.
- **`/unlock` redirect (BY DESIGN, not a bug — invariant #3):** the vault `CryptoKey` lives only in memory (`useCryptoStore`, never persisted). Any **full page reload** — typing a URL in the address bar, F5, opening a deep link, or returning from the browser error page — reboots the SPA and wipes the key. The `auth` middleware (on `/vault**`, `/settings**`) then sees a valid session (refresh cookie) but a locked vault and redirects to `/unlock`; the user re-enters the master password to re-derive the key and is returned to the target page. It redirects to `/login` only when there is no valid session. **In-app SPA navigation (clicking nav links) does NOT reload**, so the key survives and there is no unlock bounce. Consequence: navigating between real pages stays unlocked; reloads always require unlock. The custom `app/error.vue` "Back to vault" button uses `clearError({ redirect: '/vault' })` (in-SPA nav, not a reload) precisely so it preserves the key when it is still alive.
- Recovery: V1 has **no master-password recovery** (intentional — zero-knowledge). The "unrecoverable / no reset" copy on register is correct until the Phase-10 Recovery Kit (`roadmap/device-as-key.md §16.9`); a `TODO(phase-10)` marks where to soften it.

`/vault/index.vue` fetches the entry list (encrypted blobs from server), decrypts labels client-side, supports real-time label search and type-chip filtering without round-trips because all decrypted entries are held in `useVaultStore`.

`/vault/[id].vue` handles view and edit mode in the same route. LOGIN entries display a live TOTP section (countdown ring + 6-digit code) if a TOTP secret is stored. Sensitive fields are masked by default; reveal auto-hides after 30s, clipboard auto-clears after 30s.

> **ENV_FILE formats (2026-06-04):** the encrypted blob is format-agnostic, so it also holds
> JSON env files (.NET `appsettings.json`). `detectEnvFormat` picks the view: dotenv →
> key/value table; JSON (or anything `parseEnv` can't extract rows from) → masked raw viewer
> with reveal + pretty-print. Download follows the format (`.json` extension + mime); the
> whole file is still never copied to the clipboard (invariant #8).

`/generator/index.vue` is a standalone password/passphrase generator: mode toggle, length/word-count slider, character-class checkboxes, entropy arc computed from the real charset pool (shared entropy helpers), copy via `useSecureClipboard`. Generation uses `generatePassword`/`generatePassphrase` from `@adyton/shared` (CSPRNG + rejection sampling) — never `Math.random`.

`/settings/index.vue` is a single page. Account section: display name, email, change-master-password (opens a modal with re-encryption warning). Security section: 2FA status + management, active sessions with per-session revoke, trusted devices, auto-lock timeout segmented control. Danger zone: account deletion with master password confirmation. Desktop shows an in-page anchor sidebar. The change-master-password and confirm-action flows use overlay modals — no separate routes.

> **As built (Step 5, 2026-06-04):** settings persist **per-user in the DB** (`users.settings`
> JSONB via `GET/PUT /settings`, `useSettingsStore` with a localStorage boot cache) so they
> sync across devices. Auto-lock gained a **mode** control (`activity`/`absolute`) on top of
> the timeout (incl. `never`); in absolute mode an expiring timer defers while an entry form
> has unsaved edits (`useLockDeferral`). Email change and master-password change are
> placeholders (deferred — changing the master password requires full vault re-encryption);
> 2FA shows a not-configured placeholder until Phase 6. Sessions have no "this device" badge:
> the refresh cookie is scoped to `/api/auth`, so `/sessions` cannot identify the caller.

`/auth/setup-2fa.vue` (Phase 6) is a post-login flow for TOTP setup. Not in Phase 5 scope but shown in Settings security section as a placeholder state.

### 6.3 Pinia Stores

```typescript
// stores/auth.ts
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<User | null>(null);
  const isAuthenticated = computed(() => accessToken.value !== null);

  async function login(email: string, password: string, totpCode?: string) {
    const data = await $fetch<AuthTokens>('/auth/login', {
      method: 'POST',
      body: { email, password, totpCode },
    });
    accessToken.value = data.accessToken;
    user.value = data.user;
  }

  async function refreshToken() {
    // Cookie is sent automatically (httpOnly, SameSite=Strict)
    const data = await $fetch<AuthTokens>('/auth/refresh', { method: 'POST' });
    accessToken.value = data.accessToken;
  }

  function logout() {
    accessToken.value = null;
    user.value = null;
    useVaultStore().clear();
    useCryptoStore().lock();
  }

  return { accessToken, user, isAuthenticated, login, logout, refreshToken };
});
```

The `accessToken` living in Pinia memory means it disappears on page refresh. The refresh token in the httpOnly cookie survives the refresh and the `auth` middleware calls `refreshToken()` on every page load if `isAuthenticated` is false but the cookie is present.

```typescript
// stores/crypto.ts
export const useCryptoStore = defineStore('crypto', () => {
  const cryptoKey = shallowRef<CryptoKey | null>(null);
  const isUnlocked = computed(() => cryptoKey.value !== null);
  let lockTimer: ReturnType<typeof setTimeout> | null = null;

  async function deriveKey(masterPassword: string, kdfSalt: string) {
    const salt = base64ToUint8Array(kdfSalt);
    cryptoKey.value = await deriveEncryptionKey(masterPassword, salt);
    resetLockTimer();
  }

  function lock() {
    cryptoKey.value = null;
    if (lockTimer) clearTimeout(lockTimer);
  }

  function resetLockTimer() {
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(lock, 15 * 60 * 1000); // 15 minutes
  }

  return { cryptoKey, isUnlocked, deriveKey, lock, resetLockTimer };
});
```

```typescript
// stores/vault.ts
//
// Crypto contract:
//   - entryId generated client-side before encryption (crypto.randomUUID())
//   - main blob AAD:      `${userId}:${entryId}`
//   - metadata blob AAD:  `${userId}:${entryId}:meta`
//   - uses encryptSecret / decryptSecret from @adyton/shared
//   - auth header injected by useAuthStore().apiFetch — never use bare $fetch for vault endpoints

export const useVaultStore = defineStore('vault', () => {
  const entries = ref<DecryptedEntry[]>([]);
  const loading = ref(false);
  const cursor = ref<string | null>(null);

  async function fetchEntries(reset = false) {
    const auth = useAuthStore();
    const cryptoStore = useCryptoStore();
    if (!cryptoStore.isUnlocked) throw new Error('Vault is locked');
    loading.value = true;
    const raw = await auth.apiFetch<{ data: RawVaultEntry[]; nextCursor: string | null }>(
      '/vault', { params: { cursor: reset ? null : cursor.value } }
    );
    const decrypted = await Promise.all(
      raw.data.map(e => decryptRawEntry(e, cryptoStore.cryptoKey!, auth.user!.id))
    );
    entries.value = reset ? decrypted : [...entries.value, ...decrypted];
    cursor.value = raw.nextCursor;
    loading.value = false;
  }

  async function createEntry(data: Omit<DecryptedEntry, 'id' | 'updatedAt'>) {
    const auth = useAuthStore();
    const cryptoStore = useCryptoStore();
    const entryId = crypto.randomUUID();
    const payload = await encryptEntry(entryId, data, cryptoStore.cryptoKey!, auth.user!.id);
    const created = await auth.apiFetch<RawVaultEntry>('/vault', { method: 'POST', body: payload });
    entries.value.unshift(await decryptRawEntry(created, cryptoStore.cryptoKey!, auth.user!.id));
  }

  function clear() { entries.value = []; cursor.value = null; }

  return { entries, loading, cursor, fetchEntries, createEntry, clear };
});
```

**Important:** Pinia persistence plugins must **not** be configured for `useVaultStore` or `useCryptoStore`. Persisting these stores would write decrypted vault content or the derived key to browser storage, breaking the zero-knowledge model.

### 6.4 Client-Side Crypto Integration

The `packages/shared` crypto module is imported directly by both the web app and the extension. There is **no group key** — each user has a single vault key derived from their master password via Argon2id. Key derivation happens once per session in `useCryptoStore.deriveKey`, and the resulting `CryptoKey` object (marked `extractable: false`) is reused for every encrypt/decrypt operation.

Shared exports used by the vault store:

- `encryptSecret(key, plaintext, aad)` → `EncryptedBlob` (`ciphertext`, `iv`, `authTag`)
- `decryptSecret(key, blob, aad)` → `string`
- `hashLabel(label)` → `string` (SHA-256 hex, for `labelHash` field)

AAD values:
- Main blob: `` `${userId}:${entryId}` ``
- Metadata blob: `` `${userId}:${entryId}:meta` ``

`entryId` must be generated client-side (`crypto.randomUUID()`) **before** encrypting, so it can be baked into the AAD. It is sent as the `id` field of `CreateVaultEntryDto` and the server persists it as the primary key.

Argon2id runs via `hash-wasm` WASM (not `argon2-browser`). On the main thread it blocks for roughly 500ms to 2 seconds. Moving this to a Web Worker eliminates the UI freeze:

```typescript
// composables/useArgon2Worker.ts
export async function deriveKeyInWorker(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('~/workers/argon2.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.postMessage({ password, salt });
    worker.onmessage = e => { resolve(e.data); worker.terminate(); };
    worker.onerror = e => { reject(e); worker.terminate(); };
  });
}
```

The worker produces the raw key bytes, which are imported back on the main thread via `SubtleCrypto.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])`.

### 6.5 NuxtUI 4 Component Strategy

The application uses NuxtUI 4 component primitives without wrapping them in intermediate abstraction layers, keeping the component tree shallow and easy to audit.

The vault entry form uses `UForm` with a Zod schema:

```vue
<UForm :schema="vaultEntrySchema" :state="form" @submit="onSubmit">
  <UFormField label="Label" name="label">
    <UInput v-model="form.label" placeholder="e.g. GitHub" />
  </UFormField>
  <UFormField label="Password" name="password">
    <PasswordInput v-model="form.password" />
  </UFormField>
</UForm>
```

`PasswordInput` is the one custom component: a `UInput` with a trailing icon slot that toggles `type` between `password` and `text`, plus a `StrengthMeter` component that evaluates entropy using `zxcvbn` and renders a four-segment colored bar.

The vault index uses `UTable` with custom cell slots for the type badge (`UBadge`) and action dropdown (`UDropdownMenu`). Color theming is defined in `app.config.ts` using NuxtUI 4's design token overrides — dark mode first, violet accent palette.

### 6.6 Auto-Lock Behavior

The 15-minute idle timer in `useCryptoStore` is initialized on successful vault unlock and reset on any user activity:

```typescript
// composables/useAutoLock.ts
export function useAutoLock() {
  const crypto = useCryptoStore();
  const events = ['mousemove', 'keydown', 'pointerdown', 'focus'];

  function reset() { if (crypto.isUnlocked) crypto.resetLockTimer(); }

  onMounted(() => events.forEach(e => window.addEventListener(e, reset, { passive: true })));
  onUnmounted(() => events.forEach(e => window.removeEventListener(e, reset)));
}
```

This composable is called once in `app/layouts/vault.vue`. When the timer fires, `lock()` sets `cryptoKey` to null and the `LockOverlay` (`UModal`, non-dismissible) renders over the current page. The overlay re-derives the key from the entered master password and verifies it by re-fetching the vault (a wrong password yields a key that fails AES-GCM decryption → re-lock + error); it never navigates away, so the user stays in place.

**Implemented refinements (Phase 5 Step 1):**
- **Throttled reset.** Raw `mousemove` fires hundreds of times a second; resetting `resetLockTimer` on every event rewrites the lock deadline constantly and the countdown never visibly ticks. `useAutoLock` wraps `reset` in a 30s **leading-edge** throttle (`@vueuse/core` `useThrottleFn`): the first activity resets immediately, then further activity is ignored for the window, so the countdown decrements between resets.
- **Countdown pill.** `useCryptoStore` exposes `lockAt` (epoch ms of the next auto-lock) set in `resetLockTimer`, cleared in `lock`. `useAutoLock` ticks a 1s interval and derives an `mm:ss` `countdown` shown in the layout header lock pill. `lockAt` is display-only, not a security control — the real lock is the `setTimeout` clearing `cryptoKey`.

**DEFERRED — configurable lock policy (user decision 2026-06-03; Steps 5 + 2):** the lock mode must become a user setting — `activity` (current: reset on use) vs `absolute` (count down regardless of activity) — plus a configurable duration. These are **non-secret** preferences → persist in a dedicated prefs store backed by `localStorage` (NEVER in the crypto/vault stores, which must stay non-persisted). Build the prefs store + segmented control in **Step 5 (Settings)**; `resetLockTimer`/`autoLockMs` then read mode + duration from prefs, and `useAutoLock` skips the activity-reset when mode is `absolute`. In `absolute` mode the **Step 2** detail page may DEFER the lock **only while the form has unsaved edits** — never suspend auto-lock indefinitely while a detail is open (an idle open detail must still lock on schedule).

### 6.7 Environment Secrets Management

The application supports two dedicated entry types for DevOps workflows: `ENV_FILE` (entire `.env` file) and `SECRET` (single named secret). Both follow the identical zero-knowledge encryption model as regular vault entries — the server stores opaque ciphertext, the client decrypts and parses.

#### ENV_FILE Entry Type

An `ENV_FILE` entry stores the full text content of a `.env` file as a single AES-256-GCM encrypted blob. Parsing into individual key=value pairs happens **entirely on the client** after decryption — the server never sees individual variable names or values.

```
Plaintext stored in encrypted blob:
  DATABASE_URL=postgres://user:pass@host:5432/db
  REDIS_URL=redis://:secret@redis:6379
  JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEo...
  STRIPE_SECRET_KEY=sk_live_...
  SENDGRID_API_KEY=SG....
```

**UI behavior for ENV_FILE:**
- **Create/Edit**: textarea for raw `.env` paste, or file upload (`<input type="file" accept=".env,.txt">`) — content read client-side with FileReader, never sent to server unencrypted
- **View**: parsed into a two-column table (`KEY` / `VALUE`) with all values masked by default. Each row has independent reveal-toggle and copy button (clipboard cleared after 30s)
- **Export**: "Download as .env" button writes the decrypted `envContent` as a file download via `URL.createObjectURL(new Blob([content], { type: 'text/plain' }))` — no server round-trip
- **Environment tag**: badge displayed (production / staging / development / custom) — stored in `VaultEntry.environment` column (plaintext, non-secret label)
- **Version history**: `secretVersion` incremented on each save. Previous encrypted blobs retained in a `VaultEntryVersion` table (see below), allowing rollback

#### SECRET Entry Type

A `SECRET` entry stores a single named key/value pair. Use cases: individual API keys, tokens, connection strings, SSH private keys, TLS certificates, webhook signing secrets.

**UI behavior for SECRET:**
- **Create/Edit**: two fields — `secretKey` (variable name, e.g. `STRIPE_SECRET_KEY`) and `secretValue` (masked input). Optional `secretDescription` and `environment` tag.
- **View**: key shown in plaintext (it is just a variable name), value masked with reveal toggle. One-click copy.
- **Bulk import from ENV_FILE**: user can open an ENV_FILE entry and "extract" individual keys as standalone SECRET entries for granular access tracking.

#### Version History for ENV_FILE and SECRET

A companion entity stores previous versions:

```typescript
// vault-entry-version.entity.ts
@Entity({ tableName: 'vault_entry_versions' })
export class VaultEntryVersion {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => VaultEntry, { onDelete: 'cascade' })
  entry!: VaultEntry;

  @Property({ type: 'text' })
  encryptedData!: string;  // snapshot of that version's encrypted blob

  @Property({ length: 24 })
  iv!: string;

  @Property({ length: 24 })
  authTag!: string;

  @Property()
  version!: number;  // matches VaultEntry.secretVersion at time of save

  @Property({ length: 255, nullable: true })
  changeNote: string | null = null;  // optional user-supplied note

  @Property()
  createdAt: Date = new Date();
}
```

Retention policy: keep the last 10 versions per entry (enforced in the VaultService update method: after flush, delete versions where `version < currentVersion - 10`). This is configurable per instance.

**API endpoints for version history:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/vault/:id/versions` | List version metadata (no encrypted content) |
| GET | `/vault/:id/versions/:v` | Get specific version (encrypted blob) |
| POST | `/vault/:id/revert/:v` | Copy version v to current (creates new version) |

#### Vault Page Additions for ENV_FILE / SECRET

```
app/pages/vault/
├── index.vue           # Updated: filter tabs include ENV_FILE, SECRET, All
├── [id].vue            # Updated: renders ENV_FILE table or SECRET single-value view
├── env/
│   ├── new.vue         # Dedicated ENV_FILE creation (textarea + file upload)
│   └── [id]/
│       └── versions.vue # Version history browser with diff view
└── secret/
    └── new.vue          # Dedicated SECRET creation
```

The vault index gains an environment filter dropdown (production / staging / development / all) that filters client-side by the `environment` field on decrypted entries. This allows quickly finding all production secrets without a server round-trip.

#### Security Notes for ENV_FILE

- **Never log**: API must not log request bodies on endpoints that receive encrypted vault data. The `encryptedData` field is large and binary — logging it wastes space and could create log-based leakage if logs are shipped to third-party services.
- **Clipboard risk**: copying a full `.env` file to clipboard is risky. The UI should copy individual keys only, never the full file content. The "Download as .env" path is the intended full-file export.
- **SSH/TLS private keys**: multi-line PEM content is handled correctly because `envContent` is a plain string (newlines included). No special handling required — the encrypted blob stores bytes verbatim.
- **Rotation workflow**: when rotating a secret (e.g. rolling a `DATABASE_PASSWORD`), the user updates the ENV_FILE entry, the old version is automatically retained in `VaultEntryVersion`, and the environment tag makes it easy to identify which environment was updated.

---

