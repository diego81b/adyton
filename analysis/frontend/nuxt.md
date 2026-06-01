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

The vault is a **flat, per-user model** — no groups. Entries belong directly to the authenticated user. The API is `/vault` (list/create) and `/vault/:id` (get/update/delete/versions).

```
app/pages/
├── index.vue                                    # Redirects to /vault
├── auth/
│   ├── login.vue                                # Email + password, TOTP if enabled
│   ├── register.vue                             # Email + master password, KDF salt generated here
│   └── setup-2fa.vue                            # QR code display, TOTP code verification, recovery codes
├── vault/
│   ├── index.vue                                # Entry list: type filter tabs, real-time label search, cursor pagination
│   ├── [id].vue                                 # Entry detail: inline edit, reveal fields, copy, version history
│   └── env/
│       ├── new.vue                              # Dedicated ENV_FILE creation (textarea + file upload)
│       └── [id]/
│           └── versions.vue                     # Version history browser
├── generator.vue                                # Standalone password generator (no auth required)
└── settings/
    ├── index.vue                                # Display name, email change
    ├── security.vue                             # 2FA management, active sessions, per-session revocation
    └── danger.vue                               # Account deletion with master password confirmation
```

`/vault/index.vue` is the application's primary working surface. It fetches the entry list (label hashes only from the server), decrypts labels client-side to populate the table, and supports real-time filtering without round-trips because all decrypted labels are held in `useVaultStore`.

`/vault/[id].vue` handles both view and edit modes in the same route. Sensitive fields (password, card number, notes) render as masked inputs by default. Each field has a copy button that writes to the clipboard and schedules a 30-second clearance via `setTimeout(() => navigator.clipboard.writeText(''), 30000)`.

`/auth/setup-2fa.vue` is a post-login flow gated by a short-lived setup token. It calls `GET /auth/2fa/setup` to receive the TOTP secret, renders it as a QR code using `qrcode` (client-side), verifies a user-provided TOTP code to confirm correct scanner setup, and displays the eight recovery codes exactly once. A mandatory acknowledgment checkbox is required before the user can proceed.

`/settings/danger.vue` requires re-entry of the master password before the account deletion API call. The master password is re-derived to verify it is correct (by attempting to decrypt one vault entry), then the deletion request is submitted.

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

This composable is called once in `app/layouts/vault.vue`. When the timer fires, `lock()` sets `cryptoKey` to null and a watcher in `vault.vue` renders a full-screen `UModal` lock overlay. The overlay contains only a master password input — submitting re-derives the key and closes the overlay without a network round-trip.

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

