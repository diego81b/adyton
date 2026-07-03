# Changelog

All notable changes to Adyton are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.0] — 2026-07-03

PAK (Phone-as-Key) and biometric unlock reliability pass, after broader real-device use surfaced several dead ends.

### Fixed

- Native biometric prompt calls on Android could hang indefinitely with no callback, leaving the unlock button permanently disabled with no recovery short of a force-close. Calls are now bounded by a client-side timeout that always settles.
- The manual "use master password" fallback link could be unavailable while a biometric unlock was in progress, briefly trapping users behind a biometric-only screen on both the lock overlay and the full unlock page.
- PAK approve on mobile issued two separate fingerprint prompts (wrap key, then sign key) for a single approval. The sign step now reuses the wrap key's just-satisfied auth window when still valid, collapsing this to one prompt in the common case.
- QR codes for PAK enrollment and desktop unlock could fail to scan or autofocus due to high module density. Error-correction level, canvas size, and quiet-zone margin adjusted for reliable scanning.
- PAK QR unlock was unreachable from a manually-locked vault: the lock overlay never rendered it, only the full-page unlock route did. The overlay now supports PAK QR unlock and resets any stale poll/relay session on open and close.
- A dependency used by the recovery kit was not hoisted for the build tool's import analysis, silently breaking any page importing the shared package's barrel export — most visibly the PAK panel disappearing on the unlock page, worse after a refresh.
- Newly-enrolled PAK devices did not appear in the Settings device list without a manual reload.
- API 401 responses on JWT-protected endpoints nested under the auth route prefix (PAK's QR relay/enroll-vault, current-user, account deletion) were treated as credential errors and skipped the silent refresh-and-retry that applies to every other expired-session case.
- README's "no password recovery" callout predated the recovery kit feature and no longer reflected it; corrected, and the recovery kit documented in "How it works".

---

## [1.3.0] — 2026-07-02

Recovery kit is now discoverable independent of PAK enrollment.

### Added

- Dismissible recovery-kit reminder on the vault landing page for any user who has not set one up yet. Previously a recovery kit was only ever offered during phone (PAK) enrollment or by a manual visit to Settings — a user who never used either had no backup path and no warning if they forgot their master password.

### Fixed

- The "lost your phone" recovery page told users with no recovery kit to "enroll a phone first," even though a recovery kit has always been generatable from Settings without a phone.

---

## [1.2.0] — 2026-07-02

PAK reliability fixes and a safer recovery kit workflow.

### Added

- Recovery kit "Regenerate" action (Settings): re-verify master password, rewrap the vault key under a fresh salt and mnemonic, and replace the stored kit — no longer requires enrolling a phone to get a new recovery kit.
- PAK unlock now detects a stale/ghost enrollment (server has an active device record but local key data is missing) and offers in-place cleanup instead of a dead end.

### Fixed

- PAK self-revoke ("Remove" on a phone) sent the wrong device identifier to the server, so the revocation silently failed after local key material was already deleted — leaving the device active on the server indefinitely and causing later unlock attempts to fail with a misleading "Device not enrolled" error.
- PAK phone enrollment could report "Received incomplete vault key payload" almost immediately due to a status-value mismatch between frontend and backend during polling.
- Login no longer discards the pending QR payload and destination when it needs to redirect an unauthenticated phone to sign in first.

### Changed

- Recovery kit's destructive one-click "Revoke" button removed in favor of "Regenerate" — the recovery kit can no longer be deleted without immediately being replaced by a new one.

---

## [1.1.1] — 2026-06-30

Security patch: three vulnerabilities found in internal audit of v1.1.0.

### Security

- **VULN-001 (HIGH):** Phase 8 biometric unlock no longer reads vault key from `capacitor-secure-storage` before biometric authentication. Vault key is now sealed/unsealed via `AdytonKeystore.sealVaultKey`/`unsealVaultKey` using `BiometricPrompt.authenticate(CryptoObject(cipher))` — the OS withholds the AES-GCM Keystore key until biometric succeeds. A DevTools call cannot retrieve the key by reordering JS execution.
- **VULN-002 (HIGH):** PAK Keystore AES-GCM wrap key now uses `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` — per-use biometric, no time window, no device credential fallback. Replaced old ECDH+HKDF vault-key sealing (v1 format) with direct AES-GCM wrap (v2 format); existing v1 sealed files are rejected at unseal time, prompting re-enrollment. `BiometricPrompt` is now called with `CryptoObject` for seal and unseal operations.
- **VULN-003 (LOW):** WebAuthn registration and authentication now enforce `userVerification: 'required'` (was `'preferred'`) and `requireUserVerification: true` in `verifyAuthenticationResponse`. Possession-only passkey assertions are rejected.

---

## [1.1.0] — 2026-06-30

Bug fixes and security hardening found during v1.1.0 test campaign.

### Fixed

- **Route collision:** `PakController` and `DevicesController` both registered `GET /api/devices`, causing Fastify to throw `Method already declared` at startup when both modules loaded. All PAK device management routes moved to `/api/pak/devices/*`.
- **Vault response user field leak:** `VaultController` returned raw MikroORM entities; the `@ManyToOne` user relation serialised to `{ id: "..." }` in JSON responses. Added `VaultService.toDto()` explicit allowlist mapper applied on all five entry-returning endpoints.
- **Vault entry create drawer flash:** closing the slideover before `router.push` caused the vault list to render for one frame before navigation. The page unmounts naturally on route change — the explicit close was removed.

### Security

- Integration tests now assert vault response ciphertext opacity: `GET /api/vault` and `GET /api/vault/:id` must return only the 13 allowed fields and must not expose any user-owned relation or plaintext canary value.
- `PATCH /api/pak/devices/:id` now covered by a 401-without-token integration test.

---

## [1.0.0] — 2026-06-28

First production release. Complete self-hosted zero-knowledge personal password and secrets vault.

### Added

**Core vault**
- AES-256-GCM client-side encryption with Argon2id key derivation (`m=65536, t=3, p=1`). Master password and vault key never leave the browser.
- Six entry types: `LOGIN`, `SECURE_NOTE`, `CREDIT_CARD`, `IDENTITY`, `ENV_FILE`, `SECRET`.
- Per-entry version history (last 10 snapshots). Restore to any previous version.
- Per-LOGIN TOTP vault entries (RFC 6238, SHA-1, live countdown).
- ENV_FILE entries: dotenv key/value table view + raw JSON viewer. `.env` and `.json` download.
- Client-side search and filtering (type + environment tag). Server stores only ciphertext — search must be local.
- Vault export/import as encrypted `.adyton` file (Argon2id + AES-256-GCM, separate export password, portable across instances).

**Authentication**
- RS256 JWT (15-min access in memory, 7-day refresh as `httpOnly` cookie, SHA-256 hash stored server-side).
- Token family rotation with theft detection (full family revocation on reuse).
- Progressive login delays and account soft-lock at 10 failures.
- Trusted device model (`device_id` cookie, email OTP on new device).
- Session management: list active sessions, revoke individual or all.

**Two-factor authentication**
- TOTP (otplib, RFC 6238, AES-256-GCM encrypted secret at rest). Setup wizard with QR code, manual secret, and mandatory recovery code acknowledgment.
- 8 single-use recovery codes (Argon2id hashed).
- WebAuthn passkeys (FIDO2 / @simplewebauthn). Registration requires TOTP enabled first. Passkey management in settings.
- Login: opaque `mfaToken` (Redis, TTL 300s, 5-attempt budget) prevents partial-auth JWT issuance.

**Generator**
- Password generator: configurable length (12–64), character classes, ambiguous-character exclusion, real-pool entropy display.
- Passphrase generator: EFF large wordlist (7776 words, 12.92 bits/word), configurable word count (3–10), CSPRNG + rejection sampling.
- 30-second clipboard auto-clear after copy.

**Mobile (Capacitor — Android device-verified)**
- Capacitor 8 shell wrapping the Nuxt static build. Zero frontend code duplication.
- Biometric unlock: raw Argon2id key bytes stored in iOS Keychain / Android Keystore (never the master password). Stale-key auto-unenroll on vault decrypt failure.
- Lock on background (`App.addListener('appStateChange')`).
- Edge-to-edge insets (`@capacitor-community/safe-area` + CSS `env()`).
- Branded launcher icons and splash screen.

**Settings**
- Per-user DB-backed settings (JSONB, syncs across devices): display name, auto-lock mode (`activity` / `absolute`), auto-lock duration (1–60 min or never).
- Lock deferral: auto-lock in absolute mode defers while an entry modal has unsaved edits.
- Appearance: light / dark / system theme selector (per-device, `localStorage`).
- Account deletion: master-password re-verification + full cascade.

**Infrastructure**
- NestJS 11 (Fastify 5), MikroORM 6 code-first, PostgreSQL 16, Redis 7.
- Multi-stage Docker builds (non-root users, self-contained Nitro output).
- `docker-compose.prod.yml` for Coolify deployment (no nginx, Traefik-terminated).
- GitHub Actions CI: typecheck + unit + integration + `pnpm audit` on every push/PR.
- GitHub Actions deploy: `staging` branch → Coolify webhook; `v*` tag → production (gated by CI).
- Automated backup script (`pg_dump`, 7-daily + 4-weekly retention, optional rclone offsite).
- Email notifications (Nodemailer, NoOp fallback): new device login alert. Mailpit in dev.
- `pnpm audit` clean at release (0 high/critical findings).

**Design system**
- Brand palette generated from two anchors via OKLCH (`scripts/gen-palette.mjs`). WCAG AA by construction. `pnpm palette` regenerates from anchors — never hand-edit the generated block in `main.css`.
- Swiss/minimal enterprise UI language: single radius scale, 3-level elevation, accent only on primary CTA / active / focus / status dot.
- `SettingsGroup` + `SettingRow` primitives (flex-wrap, Revoke-overflow-safe).
- Segmented 6-box OTP input with OS one-time-code autofill support.

### Security notes

- Zero-knowledge: server stores opaque ciphertext only. No plaintext secret, master password, or vault key ever reaches the server.
- `CryptoKey` is non-extractable. `exportKey` is never called on the vault key.
- Browser extension deferred post-V1: service worker cannot safely hold the vault key (see `analysis/extension.md §7.7`). Redesigned as daemon + stub (§7.9) — positioned post-PAK.

---

<!-- next release entry goes above this line -->
