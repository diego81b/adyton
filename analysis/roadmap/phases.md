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

**Step 1 — vault data layer + list + shell (DONE 2026-06-03):** `vault-crypto.ts` (encrypt/decrypt mapping, blob schema), `useVaultStore` (cursor pagination, no persistence plugin), `/vault/index.vue` (cards, client-side search, type filter), `vault` layout (sidebar + bottom nav + lock pill), `LockOverlay`, auto-lock composable.

**Step 2 — entry detail, modal, history, TOTP (DONE 2026-06-03):** `/vault/[id].vue` (per-type view, reveal/copy with 30s clear via `useReveal` — separate from clipboard clear, `.env` export); `VaultEntryModal` (add/edit all 6 types, responsive **slideover**, type-scoped emission); version history list + restore (`decryptVersion` AAD uses the parent entry id); per-LOGIN **TOTP** (`packages/shared/src/totp.ts`, RFC 6238). Also: `useVaultStore.fetchAll()` loads the whole vault on unlock (client search must be complete — the server cannot search ciphertext); `VaultFilters` slideover (type + environment, environment shown only for ENV_FILE/SECRET).

**Deviations from the original plan (decided during Step 2):**
- **Dedicated `/environments` view DROPPED** — it was only a pre-filtered vault; folded into the `VaultFilters` slideover. Nav is now Vault / Generator / Settings.
- **Settings is a single `/settings/index.vue`** (account + security + danger zone with in-page anchors), not separate `/settings/security.vue` + `/settings/danger.vue`.
- Per-entry TOTP (vault entries storing a 2FA seed) is a Step 2 feature, distinct from account 2FA (Phase 6).

**Step 4 — `/generator` (DONE 2026-06-04):** password + passphrase modes with live regenerate on option change. Passphrase generation added to `packages/shared` (`generator.ts` + `wordlist.ts`: EFF large wordlist, 7776 words ≈ 12.92 bits/word, CSPRNG + rejection sampling — never `Math.random`); entropy helpers (`passwordEntropyBits`/`passphraseEntropyBits`) compute from the real charset pool (`buildPasswordPool` exported) so the entropy arc cannot drift from the generator. Strength tiers (<45 Weak / 45–64 Fair / 65–99 Strong / ≥100 Excellent), copy with 30s clipboard auto-clear, `/generator` added to the auth middleware.

**Step 5 — `/settings` (DONE 2026-06-04):** account (display name), active-session + trusted-device revoke, auto-lock timeout (5/15/30/60/never) and mode (activity/absolute), account deletion with master-password confirmation. **Deviation: settings are per-user DB-backed** (`users.settings` JSONB + `GET/PUT /settings`), not localStorage-only as originally planned — they must sync across devices for the extension (Phase 7) and mobile (Phase 9); localStorage is a boot cache only. Lock mode/duration are non-secret behavioral metadata (zero-knowledge unaffected). In absolute mode a timer-fired lock defers while an entry form has unsaved edits and fires as soon as the form closes. Email change and master-password change (vault re-encryption) are deferred past Phase 5.

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

### Phase 7 — Production Hardening | Complexity: M | **STATUS: DONE (2026-06-07)**

**Goals:** Transition from development to a production-grade deployment on a VPS with CI/CD, automated backups, and a final security review pass.

**What landed (2026-06-07, branch `feature/phase-7-production-hardening`):**
- **Step 0:** `TOTP_ENC_KEY` + `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` env var fallback — loaders check env var first, then file path; int tests switched to env var approach (no gitignored file dep on CI)
- **Step 1:** `apps/api/Dockerfile` + `apps/web/Dockerfile` — multistage builds from monorepo root; non-root users; Nitro output self-contained (no node_modules in web runner)
- **Step 2:** `docker-compose.prod.yml` rewritten as standalone (not base overlay): `build:` instead of `image:`, no db/redis (Coolify-managed), `coolify` external network, TOTP_ENC_KEY + WEBAUTHN_* env vars, health check via wget
- **Step 3:** `.github/workflows/ci.yml` (typecheck + unit + integration + pnpm audit on every push/PR) + `.github/workflows/deploy.yml` (staging branch → COOLIFY_WEBHOOK_STAGING; v* tag → COOLIFY_WEBHOOK_PROD, gated by tests)
- **Step 4:** `scripts/backup.sh` (pg_dump, 7-daily/4-weekly retention, optional rclone offsite) + `scripts/setup-vps.sh` (UFW, swap, sysctl) + `infra/README.md` (Coolify setup, env vars table, backup cron, CI/CD, fail2ban deferral)
- **Step 5 (security audit):** `pnpm audit --audit-level=high` — bumped `happy-dom` 15→20 (critical RCE GHSA-37j7-fg3j-429f) and `vitest` 3→4 (GHSA-5xrq-8626-4rwp); 0 high/critical findings remaining
- **Step 6:** README, `secrets/README.md`, `analysis/roadmap/phases.md` updated

**Deferred from original spec:**
- nginx config: replaced by Coolify/Caddy (no nginx in this deployment pattern)
- fail2ban: deferred post-V1 (Cloudflare WAF + app-level progressive delay sufficient; Caddy log path/format in Coolify not stable enough; see `infra/README.md`)
- Trusted device integration test: covered by Phase 2 unit tests; email OTP = NoOp in V1

---

### Phase 8 — Capacitor Mobile App (iOS + Android) | Complexity: M

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

### Future Roadmap (post-Phase 8)

The following features are architecturally sound but outside current V1 implementation scope:

| Feature | Prerequisite | Complexity | Notes |
|---------|-------------|------------|-------|
| **Desktop Daemon + Browser Stub (MV3)** | PAK complete | L | Architecture redesigned (2026-06-28): daemon+stub resolves all §7.7 ZK risks. Daemon process holds vault key in OS-protected heap (never `chrome.storage.session`, never SW); thin stub extension handles DOM autofill + exact-URL matching via NativeMessaging stdio pipe. DOM inject = no AutoType = no keylogger exposure. Popup XSS steals nothing (stub holds no key material). Positioned post-PAK to share OS-native infrastructure. See `analysis/extension.md` §7.9 for full architecture, security analysis, and pre-implementation decisions. |
| **Tauri desktop app** | Phase 8 complete | M | Tauri wraps same Nuxt build; adds Rust plugins for Keychain, screen-lock, global shortcut |
| **Phone-as-Key (PAK)** | Phase 8 ✅ | XL | Moved to dedicated roadmap version after V1 (decided 2026-06-28). Sub-model B + Model 3: QR+ECDH relay, SE keypair wrapping, ~9 weeks. See `analysis/roadmap/device-as-key.md` §16.8 and §16.10.10. |
| **Emergency access (trusted contact)** | V2 (EC keypairs) | M | V5 in roadmap (decided 2026-06-28). ECDH-wrapped vault key snapshot for designated Adyton contact, 7-day timeout, ZK preserved. See `analysis/roadmap/v5-emergency-access.md` for full design + security analysis. |
| **TOTP vault entries** | Phase 5 | S | store TOTP secrets as vault entries, display live codes |
| **CLI tool** | Phase 7 | M | `@adyton/cli` using shared crypto, reads/writes vault via API |
| **Trusted device enrollment UI** | V1 (backend done) | S | Backend complete (`TrustedDevice` entity, `POST /devices/register` OTP flow, `GET/DELETE /devices`, email alert on new device). Missing: login flow does not consume `newDeviceId` from `completeLogin` — no "Trust this device?" step shown to user. `TrustedDevicesCard` in settings lists and revokes but is always empty. Work: (1) `useAuthStore.login()` checks `newDeviceId` in response, (2) new `TrustDevicePrompt` component shown post-login (skip or trust → `POST /devices/register`), (3) `deviceId` cookie then sent on future logins, bypassing new-device alert. |
| **Encrypted metadata** | Phase 5 ✅ | S | DB scaffold complete (columns `encryptedMetadata`/`metadataIv`/`metadataAuthTag` nullable on `vault_entries`, accepted by backend DTOs). Only frontend wiring missing. See dedicated section below. |

---

### Encrypted Metadata — Implementation Notes

**Status:** DB + backend scaffold done in Phase 3. Frontend never implemented. All three columns are always `null` in API responses today.

**What it protects:** `environmentTag` is the only current plaintext leak this feature eliminates. Label, domain, URL, and all secret fields already live inside `encryptedData` (ZK from day one). `entryType` is kept plaintext by design (needed for client-side rendering before decrypt; type-distribution leak is accepted — see `analysis/security/architecture.md` §3.1).

**What stays plaintext (by design, do not move):**
- `entryType` — structural, needed pre-decrypt for rendering
- `labelHash` — SHA-256 for server-side dedup hints; removing breaks the index without real gain (client already does full `fetchAll`, no server search on ciphertext)
- `createdAt` / `updatedAt` / `version` — timing metadata, accepted trade-off

**AAD contract (load-bearing, cannot change post-ship):**
```
main blob:     ${userId}:${entryId}
metadata blob: ${userId}:${entryId}:meta
```
Both already implemented in `packages/shared/src/crypto.ts` (`encryptSecret` / `decryptSecret`). AAD is enforced by AES-256-GCM — a mismatch causes a hard decrypt failure.

**Metadata blob schema (client-defined JSON, server-opaque):**
```ts
interface EntryMetadata {
  environmentTag?: EnvironmentTag; // 'production' | 'staging' | 'development' | 'custom'
  // Extend here in future versions — blob is schema-flexible
}
```

**Files to change:**

1. `apps/api/src/vault/dto/create-vault-entry.dto.ts` — add `@ApiProperty` / `@ApiPropertyOptional` to all fields including the three metadata fields (Swagger gap, violates CLAUDE.md convention; can ship independently of the feature).
2. `apps/api/src/vault/dto/update-vault-entry.dto.ts` — same.
3. `apps/web/app/utils/vault-crypto.ts`:
   - Extend `CreateEntryPayload` and `UpdateEntryPayload` to include `encryptedMetadata?`, `metadataIv?`, `metadataAuthTag?`.
   - Add `encryptMetadata(draft, key, userId, entryId)` → calls `encryptSecret(key, JSON.stringify({ environmentTag: draft.environment }), \`${userId}:${entryId}:meta\`)`.
   - Wire into `encryptEntry` and `encryptEntryUpdate` — call `encryptMetadata` when `draft.environment` is set; omit metadata blob entirely when environment is absent (saves a crypto op for non-ENV_FILE types).
   - Update `decryptRawEntry`: if `raw.encryptedMetadata` is non-null, decrypt under AAD `${userId}:${entryId}:meta` and merge `environmentTag` from the result. Fallback: if null, use `raw.environmentTag` column (backward compat for existing entries).
   - After client reads the fallback path (old entry), do NOT immediately PATCH — lazy migration on next user edit is cleaner than a silent background re-encrypt-all (avoids a bulk write storm on first unlock).
4. Stop writing `environmentTag` as a plaintext column for new entries after the feature ships — the column stays in the schema and in the response DTO as the backward-compat read path; just stop populating it on write.

**Version history impact:** `VaultEntryVersion` has no metadata columns and does not need them. The metadata blob (environment tag) is entry-level metadata that does not change version-by-version. Existing version snapshots decrypt correctly without metadata.

**No DB migration needed.** Columns are already nullable and present in the entity. Zero backend changes required beyond the Swagger decorator fix.

**Testing requirements (per CLAUDE.md invariants):**
- Unit: `encryptMetadata` round-trip; AAD mismatch rejection (wrong entryId → hard fail); null metadata path (no encrypt call, no metadata fields sent); backward-compat path (null `encryptedMetadata` + populated `environmentTag` column → correct `environment` on `DecryptedEntry`).
- Integration: `POST /vault` with metadata fields → `GET /vault/:id` returns them; `PATCH /vault/:id` with metadata fields → persisted; old entry (null metadata) → reads `environmentTag` column correctly.
- No regression on existing vault CRUD tests.

**Suggested timing:** before PAK. PAK adds native Android clients that read the same vault API; having a consistent ZK story across all clients is cleaner than patching the metadata gap post-PAK. Complexity is S — pure frontend + Swagger fix, no DB work.

---

### V2 — Enterprise Multi-User (post-V1, target ~150 users on-premise)

Full design: [`analysis/roadmap/v2-enterprise.md`](./v2-enterprise.md)

Transforms Adyton from a personal vault into a multi-user on-premise product. Personal vaults are fully preserved; team group vaults are layered on top via asymmetric ECDH key wrapping.

**Key capabilities:**
- Organisation tenant with roles (owner / admin / member)
- Group vaults: ECDH key distribution, one `WrappedGroupKey` per member
- SSO as authentication plugin: OIDC (Microsoft Entra, Google Workspace, Okta) + SAML — SSO proves identity only; Vault PIN still required for crypto
- Backoffice admin UI at `/admin/**` (member management, group management, SSO config, audit log)
- Kick (destructive, deletes wrapped keys) and Suspend (reversible, keeps wrapped keys)
- Optional group key rotation post-kick

**ZK guarantee:** server never sees group key or personal vault key in plaintext. Admin can revoke group access but cannot read personal vault content.

| Component | Complexity |
|---|---|
| EC key pairs per user + ECDH wrapping | M |
| Group vault API + entities | M |
| SSO OIDC + SAML plugins | M |
| Backoffice UI | M |
| Kick / suspend flows | S |
| **Total** | **L** |

---

### V3 — Federation and Cross-Instance Sharing (post-V2)

Full design: [`analysis/roadmap/v3-federation.md`](./v3-federation.md)

Enables multiple independent on-premise Adyton deployments to collaborate. A self-hosted **federation hub** (itself an Adyton instance with `FEDERATION_HUB=true`) acts as an identity registry. Vault data never leaves its home instance.

**Key capabilities:**
- Universal User Code (UUC): `urn:adyton:user:<uuid>` — stable identity across deployments, paired with EC public key
- Hub-and-spoke: hub holds only identity metadata (UUID → pubkey → instance URL), zero vault data
- Spoke registration: instance registers with hub; hub admin approves; mutual trust established
- Cross-instance group sharing: ECDH wrap group key for remote user → push wrapped key to their instance → user decrypts locally
- Cross-instance access assertions: short-lived JWTs signed by user's EC private key, verified by home instance without hub contact
- Device binding: per-device EC keypair in OS keychain, revocable independently of user account

**ZK guarantee:** hub never sees vault ciphertext. Cross-instance operations are purely key-wrapping exchanges. Remote vault access is authenticated by cryptographic proof of key possession, not by password transmission.

| Component | Complexity |
|---|---|
| UUC (trivial add on V2 registration) | XS |
| Hub mode + spoke mode modules | M |
| Identity publication + hub registry | S |
| Cross-instance key routing | M |
| Cross-instance assertion sign/verify | M |
| Cross-org group backoffice UI | M |
| **Total** | **L** |

---

---

