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

### Phase 3 — MikroORM Entities, Migrations, and Vault API | Complexity: M

**Goals:** Define the full data model and expose the vault CRUD API. Server stores and retrieves opaque blobs — no crypto knowledge required.

**Deliverables:**
- Full entity set: `User`, `RefreshToken`, `VaultEntry`, `WebAuthnCredential`, `AuditLog`
- Initial migration + seed script for development
- `GroupsModule`: full CRUD + `POST /groups/:id/rotate-key` (member removal + atomic group re-key)
- `SecretsModule`: full CRUD under `/groups/:groupId/secrets`, version history, restore
- Request DTOs with `class-validator`: structural validation only (server cannot validate encrypted content)
- **Group key rotation** — atomic transaction: delete membership + bulk update secrets + bulk update remaining memberships. Server validates secret count integrity.
- `AuditModule` global interceptor (logs `GROUP_MEMBER_REMOVE` + `SECRET_UPDATE` x n on rotate)
- E2E tests: auth flow + group CRUD + secret CRUD + rotation flow

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

**Deliverables:**
- `/vault/index.vue`: entry table, type filter tabs, real-time label search (client-side), infinite scroll cursor pagination
- `/vault/[id].vue`: entry detail, inline edit mode, field reveal, copy to clipboard with 30s clear
- `/generator.vue`: standalone password generator with all `PasswordOptions` exposed
- `/settings/security.vue`: session list with revoke buttons
- `/settings/danger.vue`: account deletion with master password confirmation
- `useVaultStore` with full encrypt/decrypt lifecycle; **no persistence plugin**
- Auto-lock composable and lock screen overlay in `vault.vue` layout
- NuxtUI theming (dark mode, violet accent)
- `PasswordInput` component with zxcvbn strength meter

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

