## Adyton — Roadmap Summary

*Last updated: 2026-06-28 (PAK priority decision — moved before V2/V3/V4; V5 Emergency Access added)*

---

### Status at a Glance

| Version | Status | Branch |
|---|---|---|
| V1 (Phases 1–8) | **Done** | merged to develop |
| PAK (Phone-as-Key) | **Designed** | analysis complete, not started — next |
| V2 (Team Vault) | **Designed** | analysis complete, not started |
| V3 (Admin Backoffice + Certified Groups) | **Designed** | analysis complete, not started |
| V4 (Federation) | **Designed** | analysis complete, not started |
| V5 (Emergency Access) | **Designed** | analysis complete, not started |

**Order: V1 → PAK → V2 → V3 → V4 → V5.** PAK is independent of V2/V3/V4 (single-user feature, V1 codebase). Doing it first keeps the codebase simple before multi-user complexity lands. V5 requires V2 EC keypair infrastructure.

---

### V1 — Personal Vault (COMPLETE)

Phases 1–8 complete on `develop`. Includes: monorepo, Docker dev stack, NestJS auth, vault API, shared crypto, Nuxt vault UI, 2FA (TOTP + WebAuthn), production hardening, Capacitor mobile (Android device-verified). Browser extension deferred post-V1 (ZK key storage risk unresolved).

Reference: `analysis/roadmap/phases.md`

---

### PAK — Phone-as-Key (next after V1)

**Goal:** eliminate master password from desktop entirely. After enrollment, vault unlocks via phone (Face ID / fingerprint) — master password becomes recovery-only. Optional: users can always fall back to typing master password.

**Why before V2:** PAK operates on V1 single-user codebase. No dependency on multi-user infrastructure. Doing it before V2 keeps implementation scope clean.

**What it is NOT:** not a 2FA replacement (Phase 6 WebAuthn already handles authentication). PAK operates on vault key derivation, not on session authentication. The two are independent layers.

**Implementation: Sub-model B + Model 3 (most secure)**

Sub-model B — master password never on desktop:
- Master password: random 32 bytes, generated at enrollment, stored on phone only
- Desktop requests vault key via QR + ECDH ephemeral key exchange through self-hosted relay
- Server relay sees only ciphertext (E2E encrypted phone→desktop)
- Forward secrecy: new ephemeral keypairs per unlock session

Model 3 — Secure Enclave wrapping on phone:
- Phone generates P-256 keypair inside Secure Enclave (key never leaves SE)
- Master password wrapped by SE key, not stored raw in Keychain
- `.biometryCurrentSet`: SE key invalidated if biometrics change on device
- Custom Capacitor plugin `capacitor-adyton-keystore` (~300 lines Swift + Kotlin)

**Fallback hierarchy (mandatory — activation blocked until recovery kit confirmed):**

```
1. Phone available         → QR + ECDH relay (daily path)
2. Phone unavailable       → Recovery kit (BIP39 24-word mnemonic)
3. Recovery kit lost       → Master password (rate-limited 1/hr, email confirm, EMERGENCY_FALLBACK audit log)
```

**Coexistence:** login page always shows both paths. Users who never enroll PAK see no change.

**Effort:** ~10 weeks (8w QR relay infrastructure + 2w SE plugin).

Reference: `analysis/roadmap/device-as-key.md` §16.1–16.10

---

### V2 — Team Vault (multi-user, single instance)

**What it adds:** invite-to-join onboarding, group vaults with ECDH key sharing, background key rotation, realtime notifications, GroupMembership roles (viewer/editor/manager).

**What it is NOT:** no admin backoffice (`apps/admin` is V3), no certified groups (V3), no SSO, no federation.

**V2 is a complete standalone product.** Group-level access control (add/remove members → rotation) is sufficient without instance-level admin tooling. A team that never needs admin governance can stop here.

Reference: `analysis/roadmap/v2-enterprise.md`

#### Bitwarden competitive differentiator

Bitwarden org vaults use a **shared org symmetric key** — admin holds the key, can read all org entries. Account recovery (Master Password Reset policy) re-encrypts org keys through the admin, breaking per-user ZK. ETH Zurich (USENIX 2026) identified 12 design-level weaknesses; 3 accepted by Bitwarden as intentional design tradeoffs.

Adyton V2: **ECDH group key wrapping (X25519)** — server never sees the group key. Admin can revoke access (delete WrappedGroupKey rows) but cannot decrypt group vault content. No account recovery = ZK preserved.

#### Key architectural decisions

**Identity model:**
- No Organization entity. `User.role` (owner/admin/member) + `InstanceSettings` singleton.
- First user = owner. Subsequent users via invite only.
- `User.uuc` (UUID v4) — stable identity, V4 foundation.

**Onboarding:**
- Invite-based. `allow_member_invites` flag (true = any member invites, false = admin/owner only).
- `POST /api/invites` always returns `{ token, url }` — email delivery optional, not blocking.
- SMTP configured via env vars only. `email_configured: boolean` in instance settings API.

**Group vaults:**
- Any member can create a standard group — no admin approval.
- Group key distributed via ECDH (X25519) — server never sees plaintext.
- `GroupMembership.role: 'viewer' | 'editor' | 'manager'`
  - **viewer** — decrypt + read; server blocks POST/PATCH/DELETE (403). Server-enforced, not crypto-enforced (ZK: all roles receive the group key).
  - **editor** — full CRUD on group entries.
  - **manager** — full CRUD + add/remove members.
- `owner_id` separate from `created_by` — transferable.
- Any member (not just owner) can execute key rotation.
- Rotation uses `VaultService.rotateBatch()` — bypasses version snapshot path.

**Keypair model:**
- X25519 (ECDH) + Ed25519 (signing) per user, generated on first vault unlock.
- Both encrypted with `personal_vault_key`, stored server-side.
- `has_keypair: boolean` in directory — add-member rejects (422) if target has no keypair.
- Ed25519 serves no V2 function — front-loaded for V4 to avoid future re-enrollment migration.

**Notifications & realtime:**
- **Soketi** (self-hosted Pusher-compatible, Docker) — WebSocket for web + mobile foreground.
- **BullMQ** on existing Redis — background jobs (rotation queue).
- **Email** (existing SmtpEmailNotifier) — async admin alerts (rotation failure).
- **Mobile background push** — out of scope V2.

#### Implementation steps

| Step | Content | Complexity |
|---|---|---|
| 0 | EC key infrastructure (shared crypto + API) | M |
| 1 | Invite-to-join + user management API | M |
| 2 | Group vault (entities + ECDH crypto + API + GroupMembership roles) | L |
| 3 | Member lifecycle + rotation + BullMQ + Soketi + NotificationService | L |
| 4 | Tests + security hardening + Swagger | M |
| **Total** | | **L** |

*`apps/admin`, `packages/ui`, certified groups, admin API endpoints moved to V3.*

---

### V3 — Admin Backoffice + Certified Groups

**What it adds:** `apps/admin` dedicated UI, `packages/ui` shared component library, certified groups (admin-created, central-to-peripheral invite), instance-level user management (suspend/delete/role), audit log UI.

**Why separate from V2:** certified group management is a governance concern (IT → users), not a peer-to-peer sharing concern. Admin creates certified groups and pushes membership — users receive secrets read-only without any vault management action. This requires a dedicated admin app separate from the user vault.

**What it is NOT:** no federation, no SSO.

Reference: `analysis/roadmap/v3-admin.md`

#### Certified Groups vs Standard Groups

| | Standard Group (V2) | Certified Group (V3) |
|---|---|---|
| Created by | Any member | Admin only (via apps/admin) |
| Invite flow | Client-to-client (instance invite) | Central-to-peripheral (group invite with pre-assigned role) |
| Default member role | editor | viewer (read-only) |
| Managed by | Group members | Admin in apps/admin |
| Use case | Peer-to-peer secret sharing | IT distributes secrets to employees |

**Central-to-peripheral invite flow:**
1. Admin creates certified group in `apps/admin`
2. Admin generates group invite `{ email, groupId, role: viewer|editor }`
3. Recipient clicks link → registers on instance → on first vault unlock: automatically receives wrapped group key
4. Personal vault shows "Groups" section with read-only entries

#### Implementation steps

| Step | Content | Complexity |
|---|---|---|
| 0 | `packages/ui` (extract SettingsGroup, SettingRow, OtpInput, ConfirmModal; add DataTable, StatusBadge) | S |
| 1 | `apps/admin` scaffold + auth (role-check middleware, same JWT) | S |
| 2 | Certified groups + group invite flow (backend + admin UI) | M |
| 3 | Instance user management (suspend/delete/role, keypair reset) | M |
| 4 | Audit log UI (paginated, filterable) + instance settings UI | M |
| 5 | Tests + hardening + Swagger | M |
| **Total** | | **L** |

---

### V4 — Federation (cross-instance sharing)

**What it adds:** federation hub (identity registry), cross-instance group vault sharing, EdDSA cross-instance assertions.

**What it is NOT:** no SSO (separate sub-scope), no vault replication.

**Prerequisite:** V2 deployed on all participating instances (V3 not required — federation is orthogonal to admin governance).

Reference: `analysis/roadmap/v3-federation.md` *(document retains original filename)*

#### Key architectural decisions

**Hub is identity-only:**
- Hub stores public keys + instance URLs. Never touches ciphertext or group keys.
- Key delivery is direct spoke-to-spoke (not hub-proxied).
- Vault access is direct browser-to-remote instance (hub not in hot path after setup).
- Resolves the **public key substitution attack** identified in ETH Zurich research: hub-signed identity bundles + out-of-band fingerprint verification.

**Two signing keys separated:**
- `FEDERATION_HUB_SIGNING_KEY` (Ed25519) — signs identity bundles.
- `FEDERATION_HUB_INSTANCE_KEY` (X25519) — hub's own instance auth.

**Cross-instance assertions:**
- JWT algorithm: EdDSA (Ed25519). Signed by user's `ed25519_private_key`.
- Audience-bound + 60s window. No hub contact at access time.

**ECDH wrapping — identical to V2:**
- Same HKDF info string: `"adyton-group-key-wrap-v1:${groupId}:${recipientUserId}"`
- Same AAD: `"${groupId}:${userId}:wrap"`

#### Implementation steps

| Step | Content | Complexity |
|---|---|---|
| 0 | Hub infrastructure, identity publication timing | M |
| 1 | Cross-instance member add, direct key delivery, CORS | M |
| 2 | EdDSA assertions, cross-instance vault access | M |
| 3 | Cross-instance rotation, lifecycle, admin pages, tests | L |
| **Total** | | **XL** |

---

### Infrastructure Stack (V2+)

| Component | Technology | Notes |
|---|---|---|
| API | NestJS 11 + Fastify 5 | unchanged from V1 |
| DB | PostgreSQL 16 | new tables per version |
| Cache/queue | Redis 7 | shared for MFA, rate-limit, BullMQ |
| Background jobs | BullMQ | group-key-rotation (V2+) |
| Realtime | Soketi (Docker) | new container V2; Pusher-compatible |
| Email | nodemailer (SmtpEmailNotifier) | env-var-configured, NoOp fallback |
| Admin app | apps/admin (Nuxt 4) | V3; separate Docker service |
| Shared UI | packages/ui | V3; extracted from apps/web |
| Mobile push (future) | Web Push VAPID + APNs | post-V2; no Firebase SDK for Android |

---

### V5 — Emergency Access (Trusted Contact)

**What it adds:** a designated trusted contact can request access to the owner's vault after a configurable timeout (default 7 days). Owner receives multi-channel notification and has the full window to deny. If incapacitated and unresponsive, access is granted automatically. Server stores only ciphertext — ZK preserved.

**What it is NOT:** not account recovery (lost master password still unrecoverable), not admin access, not a backup.

**Prerequisite:** V2 (X25519 keypairs per user). The trusted contact must be an Adyton user on the same instance — external email requires server-side key escrow which breaks ZK.

**Key design decisions:**
- **Snapshot access** (not live key): contact decrypts the vault as it existed at grant time. Owner revokes by rotating vault key — snapshot becomes stale.
- **ZK mechanism**: owner wraps raw vault key bytes via ECDH (X25519 ephemeral) to contact's public key. Server stores ciphertext + ephemeral public key only. Server cannot decrypt.
- **Timeout defence**: 7d default, configurable 48h/7d/30d per contact. Short = coercion risk; long = delay in genuine emergency.
- **Single contact V5.0**, M-of-N Shamir as V5.1 hardening.

**Security honest assessment:** each trusted contact doubles the social engineering surface. The contact's security posture (2FA, device encryption) directly affects vault security. This is a real cost. For a personal vault the use case (incapacitation / death) is rare but legitimate.

**Effort:** M (~6 weeks). BullMQ (V2 dependency) handles the timeout-to-approval job.

Reference: `analysis/roadmap/v5-emergency-access.md`

---

### Open questions / backlog

- Master password change: must re-encrypt both EC private keys atomically — flag for when implemented.
- Browser extension: ZK key storage risk unresolved (see `analysis/extension.md §7.7–7.8`).
- SSO: V4 sub-scope or separate V3.1, not designed yet.
- V4 instance token rotation: manual in V4.0, automated as V4.1 hardening.
- Mobile background push: no V2 use case; add when "added to group" notification becomes needed.
- Soketi → SSE migration: evaluate at V2.1 for simpler deployments.
- Key fingerprint verification UI: out-of-band verification for certified group member public keys (mitigates substitution attack risk in V2 before V4 hub-signed bundles land).
