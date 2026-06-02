## 10. Implementation Roadmap

### Phase 1 — Monorepo Scaffolding and Docker | Complexity: S

**Goals:** Establish the workspace structure that all subsequent phases build on. Get Docker Compose running with all five services healthy before writing application code.

**Deliverables:**
- `pnpm` workspace with `apps/api`, `apps/web`, `apps/mobile`, `apps/extension`, `packages/shared`
- `tsconfig.json` at root with project references to each package; path aliases configured (`@shared/*`)
- `docker-compose.yml` with all five services (db, redis, api, web, nginx), health checks passing
- `packages/shared` with type definitions and empty crypto module stubs
- `nginx.dev.conf` routing `/api/` to NestJS and `/` to Nuxt with WebSocket support for HMR
- Pre-commit hooks via `husky`: ESLint + `tsc --noEmit`
- RS256 keypair generation documented in `README.md`

---

### Phase 2 — NestJS Authentication | Complexity: M

**Goals:** Implement the complete auth surface: registration, login, JWT issuance, refresh token rotation, and the session management model.

**Deliverables:**
- `User`, `RefreshToken`, `TrustedDevice` entities with MikroORM
- `AuthModule`: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- RS256 JWT strategy: access token 15 min (memory), refresh token 7 days (httpOnly cookie, SameSite=Strict)
- Token family-based rotation: old token invalidated on use, entire family revoked on theft detection
- **Trusted device model**: `device_id` httpOnly cookie (365-day), new-device detection, email notification on unknown device, one-time device registration token flow
- **Progressive login delays**: Redis `login_fail:ip:emailHash` counter, delay schedule 0 / 2s / 5s / 10s, account soft-lock at 10 failures with email unlock
- **PoW challenge endpoint** (`GET /auth/challenge`): gated by `ENABLE_POW` env flag, Redis single-use challenge TTL 120s
- `SessionsModule`: `GET /auth/sessions`, `DELETE /auth/sessions/:id`
- `DevicesModule`: `GET /auth/devices`, `POST /auth/devices/register`, `DELETE /auth/devices/:id`, `DELETE /auth/devices`
- Fastify cookie plugin configured; `trustProxy: true` for real IP extraction
- Unit tests for token rotation logic, progressive delay logic, device trust flow

---

### Phase 3 — MikroORM Entities, Migrations, and Vault API | Complexity: M ✅ DONE

**Goals:** Define the full data model and expose the vault CRUD API. Server stores and retrieves opaque blobs — no crypto knowledge required.

**Deliverables (as implemented):**
- Full entity set: `User`, `RefreshToken`, `VaultEntry`, `VaultEntryVersion`, `TrustedDevice`, `WebAuthnCredential`, `AuditLog`
- Migrations: `Migration20260528110043_initial_schema`, `Migration20260529172416_vault_entities`, `Migration20260601_add_metadata_auth_tag`
- `VaultModule`: flat per-user CRUD — `GET/POST /vault`, `GET/PATCH/DELETE /vault/:id`, `GET /vault/:id/versions`, `POST /vault/:id/versions/:versionId/restore`
- Request DTOs with `class-validator`: structural validation only (server cannot validate encrypted content)
- **Client-provided UUID** — `CreateVaultEntryDto.id` is required (UUID v4). Client generates before encrypting so AAD `${userId}:${entryId}` can be computed correctly.
- **Metadata auth tag** — `VaultEntry` stores `encryptedMetadata`, `metadataIv`, `metadataAuthTag` (all nullable). Metadata AAD: `${userId}:${entryId}:meta`.
- **Version history** — `VaultEntryVersion` snapshots previous blobs on each update; retention policy: last 10 versions per entry.
- `AuditModule` global interceptor — logs `VAULT_CREATE`, `VAULT_READ`, `VAULT_UPDATE`, `VAULT_DELETE`, `VAULT_VERSION_RESTORE`
- Unit tests: 100% coverage. Integration tests: 70+ tests (TestContainers + real PostgreSQL)

**Note:** An earlier design explored a group-based model (`GroupsModule`/`SecretsModule`/`rotate-key`). This was replaced by a flat per-user vault for V1 simplicity. Group-based sharing is listed as a post-V1 feature in the Future Roadmap.

---

### Phase 4 — Shared Crypto Package and Nuxt Auth Flows | Complexity: L

**Goals:** Implement and test all cryptographic primitives in `packages/shared`, then wire them into Nuxt auth pages and Pinia stores.

**Deliverables:**
- `packages/shared/src/crypto.ts`: `deriveEncryptionKey`, `encryptSecret`, `decryptSecret` (both with AAD parameter), `encryptGroupKey`, `decryptGroupKey`, `generateGroupKey`, `hashLabel`, `generatePassword`, `generateRecoveryCodes`
- **AAD binding implemented from day one** — `encryptSecret(groupKey, plaintext, `${groupId}:${secretId}`)`. Retroactive addition requires full vault re-encryption; must be correct at first write.
- **Encrypted metadata** — `encryptSecret(groupKey, JSON.stringify(metadata), `${groupId}:${secretId}:meta`)`
- Argon2id parameters documented and justified
- Vitest unit tests for all crypto functions (running in Node.js via `globalThis.crypto`)
- Argon2id Web Worker (`~/workers/argon2.worker.ts`) to prevent UI blocking
- Nuxt `useAuthStore` and `useCryptoStore` wired to auth endpoints
- Login flow: `kdfSalt` received, Argon2id key derived, `CryptoKey` stored in Pinia
- Auth middleware protecting `/vault/**` and `/settings/**` routes
- Silent refresh on page load via httpOnly cookie

This is the highest-risk phase: Argon2id WASM in a browser context with Web Worker offloading and the stateful key lifecycle across page refreshes require careful testing.

---

### Phase 5 — Nuxt Vault UI | Complexity: L

**Goals:** Build the complete vault interface using NuxtUI 4 components backed by `useVaultStore`. All CRUD operations encrypt before sending and decrypt on receive.

**Step 0 — Auth UI foundation + retrofit (DONE 2026-06-02):** before the vault UI, the design system and existing auth pages were brought to mockup fidelity. Delivered: emerald visual system (`bg-grid`/`radial-glow`/`accent-glow` as Tailwind v4 `@utility`, Inter + JetBrains Mono via `@nuxt/fonts`, dark-default color mode); reusable components `AuthShell`, `AuthCard`, `BrandLogo`, `PasswordInput` (lock + eye toggle), `PasswordStrengthMeter`, `KeyDerivationStatus`; composable `usePasswordStrength`; login/register/unlock retrofitted (full-width `size=lg` inputs, confirm-password, client-side strength feedback, account email on unlock). Also fixed session persistence (refresh cookie path `/api/auth`, no-body POST content-type). Note: accent is **emerald** (mockup is authoritative), not violet; `PasswordInput` already exists from Step 0.

**Deliverables (remaining):**
- `/vault/index.vue`: entry table, type filter tabs, real-time label search (client-side), infinite scroll cursor pagination
- `/vault/[id].vue`: entry detail, inline edit mode, field reveal, copy to clipboard with 30s clear
- `/generator.vue`: standalone password generator with all `PasswordOptions` exposed
- `/settings/security.vue`: session list with revoke buttons
- `/settings/danger.vue`: account deletion with master password confirmation
- `useVaultStore` with full encrypt/decrypt lifecycle; **no persistence plugin**
- Auto-lock composable and lock screen overlay in `vault.vue` layout
- NuxtUI theming (dark mode, emerald accent)

---

### Phase 6 — Two-Factor Authentication (TOTP and WebAuthn) | Complexity: M

**Goals:** Add TOTP as the primary second factor with recovery codes, and WebAuthn as an optional hardware key second factor.

**Deliverables:**
- Backend: `otplib` for TOTP, `@simplewebauthn/server` for WebAuthn
- TOTP setup flow: QR code data URI returned to client, setup confirmed via valid TOTP code before enabling
- 8 recovery codes generated, Argon2id hashed, stored; used codes deleted on consumption
- Login flow updated: `{ requiresMfa: true, mfaToken }` returned if 2FA enabled; `/auth/2fa/authenticate` accepts TOTP code
- WebAuthn: registration options, registration complete, authentication options, authentication complete
- Frontend `/auth/setup-2fa.vue`: QR code display, verification step, recovery code download + mandatory acknowledgment
- Passkey management in `/settings/security.vue`

---

### Phase 7 — Browser Extension (MV3) | Complexity: L

**Goals:** Ship a functional Manifest V3 extension for Chrome and Firefox with autofill, vault search, and synchronized auth state.

**Deliverables:**
- Extension scaffold with Vite build, TypeScript, Tailwind CSS (bundled, not NuxtUI)
- Popup: login form, vault list with domain matching, copy buttons with 30s clipboard clear, lock/unlock
- Content script: form detection, MutationObserver, autofill button injection, SPA navigation handling
- Service worker: API proxy, silent token refresh (via httpOnly cookie), message handlers for `AUTOFILL_REQUEST` and `VAULT_SEARCH`
- `chrome.storage.session` for access token persistence across service worker wake cycles
- `packages/shared` crypto used for decrypt-on-demand in service worker and popup
- Firefox compatibility: `browser.*` API polyfill (`webextension-polyfill`), `browser_specific_settings` in manifest
- Packaged `.crx` and `.xpi` artifacts via CI

---

### Phase 8 — Production Hardening | Complexity: M

**Goals:** Transition from development to a production-grade deployment on a VPS with SSL, automated backups, rate limiting, and a final security review pass.

**Deliverables:**
- `docker-compose.prod.yml` with SSL termination, certbot sidecar, resource limits, no exposed database ports
- Production nginx config (Section 9.6): all rate limit zones, connection limits, slow HTTP timeouts, full security headers, HSTS preload, OCSP stapling, TLS 1.2/1.3 only
- `scripts/backup.sh` with 7-daily / 4-weekly rotation policy + optional rclone remote sync
- `@nestjs/throttler` rate limits verified against all auth endpoints
- **fail2ban**: nginx-pwdsecure filter + jail (Section 3.10.3), escalating ban times (`bantime.increment = true`)
- **Progressive delay smoke test**: verify Redis counters increment and delays apply under repeated auth failures
- **Trusted device integration test**: new-device flow, email notification, registration, revocation
- Dependency audit: `pnpm audit`, resolve all high/critical findings
- Manual security review against OWASP Top 10 and ASVS Level 2
- UFW firewall rules: allow only 80, 443, and SSH on non-standard port
- Optional: enable `ENABLE_POW=true` and verify PoW challenge flow end-to-end

---

### Phase 9 — Capacitor Mobile App (iOS + Android) | Complexity: M

**Goals:** Ship the mobile app using the existing Nuxt 4 frontend wrapped in Capacitor. iOS gets native Keychain storage (no ITP), native Face ID unlock, and proper home screen install. Android gets the same via Capacitor or via the existing PWA.

**Deliverables:**
- `apps/mobile/` Capacitor project referencing `apps/web` build output
- `capacitor.config.ts` with `webDir` pointing to Nuxt static build
- iOS native plugins: `@capacitor/secure-storage` (Keychain), `@capacitor-community/biometric-auth` (Face ID / Touch ID)
- Android native plugins: same stack (Android Keystore)
- `useCapacitorKeychain` composable in `apps/web` — detects Capacitor runtime, falls back to IndexedDB for browser
- Auto-lock on app background (`App.addListener('appStateChange')`)
- iOS: Xcode project build, provisioning profile, sideload via AltStore or App Store
- Android: Gradle build, signed APK or Play Store bundle
- Capacitor live-reload config for development (points to Nuxt dev server)
- Vitest integration test: key store, biometric mock, lock/unlock cycle

**Architecture note:** Zero frontend code duplication. `apps/mobile` is a thin Capacitor shell — all vault logic, UI, crypto, and Pinia stores are in `apps/web`. The mobile app adds only native bridge calls for Keychain and biometric. Capacitor detects runtime (`Capacitor.isNativePlatform()`) so the web build works identically in browser.

---

### Future Roadmap (post-Phase 9)

The following features are architecturally sound but outside current implementation scope:

| Feature | Prerequisite | Complexity |
|---------|-------------|------------|
| **Tauri desktop app** | Phase 9 complete | M — Tauri wraps same Nuxt build; adds Rust plugins for Keychain, screen-lock, global shortcut |
| **Phone-as-Key Sub-model A (enforced)** | Phase 6 (WebAuthn) | S — enforce `authenticatorAttachment: 'cross-platform'` + device-bound passkeys |
| **Phone-as-Key Sub-model B (relay)** | Tauri or Phase 9 | L — VPS relay API, Capacitor key-only app, ECDH key exchange, ntfy.sh push |
| **Emergency access (trusted contact)** | Phase 3 | M — time-locked delegated access, zero-knowledge grant flow |
| **VaultEntry sharing** | Phase 3 | L — asymmetric re-encryption for sharing between users on same instance |
| **TOTP vault entries** | Phase 5 | S — store TOTP secrets as vault entries, display live codes |
| **CLI tool** | Phase 8 | M — `@pwdsecure/cli` using shared crypto, reads/writes vault via API |

---

---

