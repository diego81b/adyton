## V2 — Team Vault (multi-user, single instance)

### Overview

V2 transforms Adyton from a personal vault into a shared-team product. A single deployment serves a team (up to ~200 users); each member keeps their personal vault intact and gains access to group vaults with other members. No vault content ever leaves the instance.

**Scope:** user management, group vaults, EC key infrastructure, invite-to-join onboarding, admin backoffice (separate app), group key rotation.

**What V2 is NOT:** no SSO, no cross-instance federation. Those are V3. V2 is a complete standalone product — a team that never needs V3 can stop here.

---

### Design Principles

1. **Personal vault is untouched.** V1 ZK model (Argon2id → vault key → AES-256-GCM) unchanged. V2 adds a separate EC key layer for group vaults only.
2. **Any member can share.** Creating a group and adding members requires no admin approval. Admin controls who has an account on the instance; members control who joins their groups.
3. **Onboarding is invite-based, not admin-provisioned.** New users self-register via invite link. No admin ever sets a password on behalf of another user (ZK: only the user knows their master password). Admin can restrict invite generation to admin/owner only via `InstanceSettings`.
4. **User directory is PII-minimal.** Members search by display name + UUC. Email addresses are never exposed in the directory.
5. **Server never sees group key plaintext.** Group keys are distributed via ECDH key wrapping. Server stores wrapped copies only.
6. **Admin cannot read group vault content.** Admin can revoke access (delete wrapped keys, reset keypair) but holds no key material.
7. **Two keypairs per user, client-side.** X25519 for ECDH group key wrapping; Ed25519 for signing (V3 cross-instance assertions). Both generated in the browser, private keys stored encrypted with `personal_vault_key`.

---

### Key Hierarchy — V2 Extension

```
Personal layer (V1, unchanged):
  master_password
      └─ Argon2id → personal_vault_key
             └─ AES-256-GCM → personal vault entries

EC key layer (V2, new):
  personal_vault_key
      ├─ AES-256-GCM decrypt (AAD: "${userId}:x25519:private") → x25519_private_key
      │        └─ ECDH(x25519_private, eph_pub) → wrapping_key (via HKDF)
      │                 └─ AES-256-GCM decrypt
      │                    (AAD: "${groupId}:${userId}:wrap") → group_key
      │                             └─ AES-256-GCM → group vault entries
      │                                (AAD: "${groupId}:${entryId}")
      │
      └─ AES-256-GCM decrypt (AAD: "${userId}:ed25519:private") → ed25519_private_key
               └─ signs cross-instance assertions (V3 only)
```

**HKDF parameters for wrapping_key derivation:**
```
HKDF-SHA256(
  ikm  = shared_secret,           // X25519(eph_priv, recipient_x25519_pub)
  salt = eph_pub,                  // ephemeral public key (unique per wrap)
  info = "adyton-group-key-wrap-v1:${groupId}:${recipientUserId}",
  len  = 32
)
```

Binding `groupId` and `recipientUserId` in the HKDF info string prevents a wrapped key blob from one group being used to decrypt another group's key.

---

### Entity Model

```
User (extended from V1):
├── ... (all V1 fields unchanged)
├── role: 'owner' | 'admin' | 'member'    (new)
├── uuc: UUID v4                           (new — stable identity, foundation for V3)
├── status: 'active' | 'suspended'        (new)
└── keypair_reset_required: boolean        (new — set by admin keypair reset)

InstanceSettings (singleton — one row, seeded on first boot):
├── id: 1
├── require_2fa: boolean              (default false — hard-overrides user settings)
├── session_timeout_ms: number | null (default null — overrides user auto-lock if shorter)
├── allow_member_invites: boolean     (default true — false = admin/owner only can invite)
└── updated_at

UserKeyPair (1:1 with User):
├── user_id → User
├── x25519_public_key       (base64url, plaintext — shared in directory)
├── x25519_private_key_enc  (base64url, AES-256-GCM, key = personal_vault_key)
├── x25519_private_key_iv
├── x25519_private_key_auth_tag
├── ed25519_public_key      (base64url, plaintext)
├── ed25519_private_key_enc (base64url, AES-256-GCM, key = personal_vault_key)
├── ed25519_private_key_iv
└── ed25519_private_key_auth_tag

Invite:
├── id: UUID (token — used in invite link)
├── created_by → User
├── email          (recipient email — validated at registration, pre-fills form; second
│                   pending invite for same email is blocked 409)
├── expires_at     (7 days from creation)
├── accepted_at    (null until used — single-use)
└── accepted_by → User (null until used)

Group:
├── id (UUID)
├── name
├── description (nullable)
├── created_by → User   (immutable — records who created the group, not transferable)
├── owner_id → User     (mutable — current owner; initially = created_by; transfer via
│                        POST /api/groups/:id/transfer-ownership)
├── rotation_pending: boolean       (default false — set true on member removal)
└── rotation_enqueued_at: timestamp | null

GroupMembership:
├── group_id → Group
├── user_id → User
├── role: 'viewer' | 'editor' | 'manager'
│   viewer  — decrypt + read; server blocks POST/PATCH/DELETE (403). Server-enforced,
│             not crypto-enforced (all roles receive the group key — ZK: server can't
│             distinguish roles at the ciphertext layer).
│   editor  — full CRUD on group entries.
│   manager — full CRUD + add/remove members (owner-level within the group).
└── added_by → User

WrappedGroupKey:
├── group_id → Group        ┐
├── user_id → User          ┘ composite PK (group_id, user_id)
├── wrapped_group_key  (base64url — AES-256-GCM ciphertext of group_key)
├── eph_pub            (base64url — ephemeral X25519 public key)
├── iv                 (base64url)
└── auth_tag           (base64url)

VaultEntry (extended from V1):
├── user_id → User   (retained for group entries — records creator for attribution/audit;
│                     NOT used for access control on group entries — see VaultGuard note)
└── group_id → Group (nullable)
    Entry AAD: personal = "${userId}:${entryId}"
               group    = "${groupId}:${entryId}"

VaultEntryVersion (extended from V1):
└── group_id → Group (nullable — copied from parent VaultEntry at snapshot time)
    Required to reconstruct the correct AAD on restore:
    personal restore AAD = "${userId}:${entryId}"
    group restore AAD    = "${groupId}:${entryId}"
    Without this field, restoring a group entry version produces an AAD mismatch → GCM tag failure.

AuditLog (new):
├── id: UUID
├── event_type: enum (see Audit Log Events §)
├── actor_id → User (nullable — null for system-triggered events)
├── target_user_id → User (nullable)
├── group_id → Group (nullable)
├── metadata: jsonb  (event-specific payload, e.g. changedFields, oldRole, newRole)
└── created_at
```

**Indexes:**
- `VaultEntry(group_id)` where group_id IS NOT NULL
- `WrappedGroupKey(user_id)` — fetch all group keys on unlock
- `GroupMembership(group_id, user_id)` unique
- `User(uuc)` unique
- `Invite(id)` — lookup by token
- `Invite(email)` where accepted_at IS NULL — enforce single pending invite per address (409)
- `AuditLog(created_at, event_type)` — paginated admin audit view

---

### Onboarding Model

Two modes controlled by `InstanceSettings.allow_member_invites`:

**Mode A — open invites (default, small team / personal use):**
Any member can generate an invite link. The recipient self-registers. No admin involvement.

**Mode B — restricted invites (enterprise / IT-controlled):**
Only `admin` or `owner` can generate invite links. Members cannot invite others. IT controls who joins the instance.

Both modes share the same invite flow — only the authorization guard on `POST /api/invites` differs.

**First-user bootstrap:**
The first user to register on a fresh instance gets `role = 'owner'` automatically. No invite needed for the first user (registration is open until one account exists, then closes unless an invite is present).

**Invite flow:**
```
1. A (any member or admin, depending on mode) calls POST /api/invites { email }
   → If a non-expired, non-accepted invite for that email already exists → 409 Conflict
   → Server creates Invite row (UUID token, 7-day TTL)
   → Response: { token, url: "/register?invite=<token>", email_delivery: boolean }
   → If SMTP_HOST is configured: also sends email
   → If not: no email sent, no error — inviter uses the returned url out-of-band
   UI: always shows a copyable link; "Email sent" toast only when email_delivery=true

2. B opens link → /register?invite=<token>
   → Client calls GET /api/invites/:token to validate (not expired, not used)
   → Pre-fills email from Invite.email (read-only)
   → B sets display name + master password

3. B submits registration:
   → POST /api/auth/register { invite_token, display_name, email, password }
   → Server validates token (not expired, not used, email matches token's email)
   → Creates User (role='member', status='active', uuc=UUID v4)
   → Marks Invite.accepted_at + accepted_by
   → Returns JWT (normal login flow)

4. On first vault unlock:
   → Client detects missing keypair (GET /api/keypair returns 404)
   → Generates X25519 + Ed25519 keypairs client-side
   → POST /api/keypair (encrypted private keys + public keys)
```

**Keypair timing note:** between step 3 (registered) and step 4 (first unlock), the user is `status='active'` and visible in the directory but has no `UserKeyPair` row. `GET /api/users/directory/:uuc` returns `has_keypair: false` during this window. `POST /api/groups/:id/members` rejects with 422 if target user's `has_keypair` is false — the group owner must wait until the new member completes their first vault unlock.

**Invite cancellation:** inviter or admin can delete a pending invite (`DELETE /api/invites/:token`) before it is accepted.

---

### Group Key Wrapping (ECDH)

When group owner A adds user B:

```
0. A fetches B from GET /api/users/directory/:uuc
   → If has_keypair=false: abort — show "B has not completed first vault unlock yet"
   → If has_keypair=true: proceed
1. A fetches B's x25519_public_key from the same response
2. A generates ephemeral X25519 keypair (eph_priv, eph_pub) — single-use per wrap
3. shared_secret  = X25519(eph_priv, B.x25519_public_key)
4. wrapping_key   = HKDF-SHA256(shared_secret, salt=eph_pub,
                     info="adyton-group-key-wrap-v1:${groupId}:${B.userId}", len=32)
5. wrapped        = AES-256-GCM(group_key, wrapping_key,
                     AAD="${groupId}:${B.userId}:wrap")
6. POST /api/groups/:id/members { uuc: B.uuc, wrapped_group_key, eph_pub, iv, auth_tag }
7. Server stores WrappedGroupKey row + GroupMembership row atomically
8. eph_priv discarded immediately after step 5
```

When B unlocks a group vault:

```
1. B decrypts personal_vault_key (Argon2id, V1 unchanged)
2. B decrypts x25519_private_key_enc with personal_vault_key (AAD: "${B.userId}:x25519:private")
3. B calls GET /api/keypair/groups → all WrappedGroupKey rows for B
4. For each group:
   shared_secret = X25519(B.x25519_private_key, eph_pub)
   wrapping_key  = HKDF-SHA256(...)     ← same derivation
   group_key     = AES-256-GCM-decrypt(wrapped_group_key, wrapping_key,
                     AAD="${groupId}:${B.userId}:wrap")
5. B decrypts group vault entries with group_key (AAD: "${groupId}:${entryId}")
```

Non-interactive: A does not need to be online when B unlocks.

---

### User Directory

Members can search by display name or UUC. Email is never returned.

```
GET /api/users/directory              → [{ uuc, display_name, has_keypair: boolean }]
GET /api/users/directory/:uuc         → { uuc, display_name, has_keypair: boolean,
                                          x25519_public_key, ed25519_public_key }
                                        x25519_public_key / ed25519_public_key are null
                                        when has_keypair=false
```

The per-user endpoint returns public keys so the client can perform ECDH wrapping in a single round-trip. `has_keypair` guards the add-member flow — a client must check this before attempting to wrap (see Group Key Wrapping §).

**Enumeration note (deliberate):** All active members can enumerate the full directory regardless of `allow_member_invites` mode. This is intentional — members need the directory to share groups. The directory is not a privacy control; it is a functional prerequisite for group key wrapping.

---

### API Surface

```
# First-user bootstrap
POST   /api/auth/register             ← open only when zero users exist, OR invite_token present

# Invites
POST   /api/invites                   ← generate invite; 409 if pending invite for same email exists
                                        response: { token, url, email_delivery: boolean }
GET    /api/invites/:token            ← validate token (public — used by register page)
DELETE /api/invites/:token            ← cancel pending invite (inviter or admin)
GET    /api/invites                   ← list own pending invites (admin sees all)

# Keypair
POST   /api/keypair                   ← register keypair (first unlock post-registration, once only — 409 if exists)
GET    /api/keypair                   ← own encrypted private keys + public keys
GET    /api/keypair/groups            ← all WrappedGroupKey rows for self (called on unlock)

# User directory
GET    /api/users/directory           ← [{uuc, display_name, has_keypair}] all active users
GET    /api/users/directory/:uuc      ← {uuc, display_name, has_keypair, x25519_public_key,
                                          ed25519_public_key}  (public keys null when has_keypair=false)

# Groups (any authenticated member)
GET    /api/groups                    ← groups user belongs to
POST   /api/groups                    ← create group (creator = owner)
GET    /api/groups/:id                ← group metadata
PATCH  /api/groups/:id                ← rename (owner only)
DELETE /api/groups/:id                ← delete (owner only, or admin)
GET    /api/groups/:id/members        ← list members (uuc + display_name, has_keypair, no email)
POST   /api/groups/:id/members        ← add member (owner only) — body includes WrappedGroupKey
                                        422 if target user has no UserKeyPair (has_keypair=false)
DELETE /api/groups/:id/members/:uid   ← remove member (owner only, or admin) → triggers rotation job
GET    /api/groups/:id/rotation-status ← { pending: boolean, enqueued_at } — any member polls
POST   /api/groups/:id/transfer-ownership ← { target_uuc } — owner only; updates Group.owner_id

# Group vault (mirrors personal vault shape)
GET    /api/groups/:id/vault
POST   /api/groups/:id/vault
GET    /api/groups/:id/vault/:eid
PATCH  /api/groups/:id/vault/:eid
DELETE /api/groups/:id/vault/:eid
GET    /api/groups/:id/vault/:eid/versions
POST   /api/groups/:id/vault/:eid/versions/:vid/restore
POST   /api/groups/:id/vault/rotate   ← atomic rotation: new ciphertext + new WrappedGroupKey rows

# Admin — user management
GET    /api/admin/users
PATCH  /api/admin/users/:id/role
PATCH  /api/admin/users/:id/suspend
PATCH  /api/admin/users/:id/reactivate
DELETE /api/admin/users/:id
POST   /api/admin/users/:id/reset-keypair

# Admin — instance config
GET    /api/admin/settings            ← includes email_configured: boolean (derived from SMTP_HOST presence)
PUT    /api/admin/settings
GET    /api/admin/audit               ← paginated, filter by event type + user
GET    /api/admin/invites             ← all pending invites (admin view)
```

---

### Group Key Rotation (background job)

Triggered automatically when a member is removed (`DELETE /api/groups/:id/members/:uid`).

```
1. Server deletes WrappedGroupKey for removed user immediately — access revoked.
2. Server enqueues BullMQ job: { groupId, triggeredBy }
   Sets Group.rotation_pending=true, Group.rotation_enqueued_at=now()
3. Server emits { type: 'rotation.pending', groupId } to Soketi channel
   `private-group.{groupId}` — all connected group members receive it immediately.
   On next vault unlock (for members not connected at that moment): client checks
   GET /api/groups/:id/rotation-status as fallback.
   A persistent "Security action required — key rotation pending" banner appears.
4. When any member's vault is unlocked and rotation is pending, that client executes:
   (Every member holds a valid WrappedGroupKey → can decrypt current group_key → rotate)
   a. Generate new group_key (CSPRNG, 256-bit)
   b. Re-encrypt all group vault entries with new group_key (client-side)
   c. Re-wrap new group_key for each remaining member (ECDH)
   d. POST /api/groups/:id/vault/rotate  ← atomic transaction
5. Server marks rotation complete (Group.rotation_pending=false); polling returns { pending: false }
```

**Rotation write path:** `POST /api/groups/:id/vault/rotate` must NOT go through `VaultService.update()`. That method always snapshots a `VaultEntryVersion` row — 10 rotations would evict all real edit history. Rotation uses a dedicated `VaultService.rotateBatch(entries, newCiphertext[], newWrappedKeys[])` method that overwrites ciphertext in-place without creating version snapshots.

**Deferral:** if all members' vaults are locked when rotation is enqueued, rotation defers until next unlock. The removed user's wrapped key is already deleted — they cannot decrypt new entries written after removal. Rotation closes the window on their cached group_key from before removal.

---

### Suspend and Delete

**Suspend (reversible):**
```
1. User.status = 'suspended'
2. All refresh tokens revoked (immediate logout)
3. Login blocked at AuthService.completeLogin()
4. GroupMembership rows kept (fast reactivation, no re-wrap needed)
Reactivate: User.status = 'active'
```

**Delete (destructive):**
```
Pre-condition check: if user is Group.owner_id on any groups, the admin UI requires
resolution before confirming delete:
  - Transfer ownership to another member (POST /api/groups/:id/transfer-ownership)
  - OR force-delete the group (admin confirms data loss)
Blocking on this prevents orphaned groups with no rotation executor.

1. All refresh tokens revoked
2. WrappedGroupKey rows deleted (all groups)
3. GroupMembership rows deleted
4. Personal vault entries cascade-deleted (ZK — admin never had access)
5. UserKeyPair deleted
6. Groups where created_by = deleted user retain the row (immutable history);
   their owner_id was already transferred in the pre-condition step above.
```

**Ownership transfer:**
```
POST /api/groups/:id/transfer-ownership { target_uuc }
  → target must be an active GroupMembership member of the group
  → updates Group.owner_id (created_by is unchanged — immutable history)
  → only callable by current owner_id, or admin (for orphaned groups)
```

**Keypair reset (admin-triggered):**
```
1. UserKeyPair row deleted
2. All WrappedGroupKey rows for this user deleted (all groups)
3. User.keypair_reset_required = true
4. On next login: client detects flag → generates new keypair → POST /api/keypair
5. Group owners see a "needs re-enrollment" indicator on this member
6. Group owner re-adds the user (re-wraps group key for new public key)
```

---

### Audit Log Events (V2 additions)

```
GROUP_CREATE          groupId, name, createdBy
GROUP_RENAME          groupId, oldName, newName, by
GROUP_DELETE          groupId, name, by
GROUP_MEMBER_ADD      groupId, targetUserId, by
GROUP_MEMBER_REMOVE   groupId, targetUserId, by
GROUP_KEY_ROTATION    groupId, status: 'started'|'complete', by
GROUP_OWNERSHIP_TRANSFER groupId, oldOwnerUserId, newOwnerUserId, by
INVITE_CREATE         inviteId, recipientEmail, by
INVITE_CANCEL         inviteId, by
INVITE_ACCEPT         inviteId, newUserId
USER_SUSPEND          targetUserId, by
USER_REACTIVATE       targetUserId, by
USER_DELETE           targetUserId, by
USER_ROLE_CHANGE      targetUserId, oldRole, newRole, by
USER_KEYPAIR_RESET    targetUserId, by
SETTINGS_UPDATE       changedFields[], by
```

---

### Notifications & Realtime

Three delivery mechanisms, each for a different context. All dispatched from a single `NotificationService.dispatch(target, event, payload)`.

**Soketi — WebSocket (primary, web + foreground mobile):**
Soketi is a self-hosted Pusher-compatible WebSocket server running as a separate Docker container. NestJS pushes events via HTTP API (fire-and-forget, no persistent WS connection from the server). Frontend uses `pusher-js`. Works identically in the Capacitor WebView (mobile foreground) because the app origin is HTTPS.

```yaml
# docker-compose.prod.yml
soketi:
  image: quay.io/soketi/soketi:1.6-16-debian
  restart: unless-stopped
  environment:
    SOKETI_DEFAULT_APP_ID: adyton
    SOKETI_DEFAULT_APP_KEY: ${SOKETI_APP_KEY}
    SOKETI_DEFAULT_APP_SECRET: ${SOKETI_APP_SECRET}
    SOKETI_DEFAULT_APP_USER_AUTHENTICATION: "true"
```

Traefik routes `wss://ws.${DOMAIN}` → `soketi:6001`.

Channel model:

| Channel | Subscribers | Events |
|---|---|---|
| `private-user.{userId}` | authenticated user | `keypair.reset` |
| `private-group.{groupId}` | group members | `rotation.pending`, `rotation.complete`, `member.added`, `member.removed` |
| `private-admin` | role=owner\|admin | `rotation.failed` |

Channel auth: `POST /api/ws/auth` — Soketi calls this when a client subscribes to a private channel. NestJS validates JWT + GroupMembership and returns channel token. No vault data ever flows through Soketi — only event type + IDs.

**BullMQ — background jobs:**
Runs on the existing Redis instance. No new container.

| Queue | Trigger | Job |
|---|---|---|
| `group-key-rotation` | member removed | set `rotation_pending=true`, emit `rotation.pending` via Soketi |
| `group-key-rotation-retry` | rotation failed after 5 attempts | emit `rotation.failed`, send admin email alert |

**Email — async admin alerts:**
Uses `SmtpEmailNotifier` (already in V1). Configured via env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) — **not stored in DB**. Credentials managed via Coolify secrets UI. `GET /api/admin/settings` exposes `email_configured: boolean` (derived from `SMTP_HOST` presence) so apps/admin can guide the operator. No in-app SMTP configuration — env vars only.

Events that trigger admin email: `rotation.failed` (BullMQ retry exhausted).

**Mobile push — future scope (post-V2):**
Not needed in V2. No real use case identified — all V2 notification events are either handled by Soketi (foreground) or are non-urgent (user sees state on next unlock). When needed post-V2: Web Push VAPID for Android (no Firebase SDK, uses `web-push` npm package, self-hosted keys), APNs via `@capacitor/push-notifications` for iOS (mandatory, no alternative on iOS). Firebase is an option that abstracts both but adds a Google project dependency.

**New packages:**
```
pnpm --filter @adyton/api add pusher bullmq
pnpm --filter @adyton/web add pusher-js
```

---

### packages/ui — Shared Component Library

`apps/admin` is a separate Nuxt app. Shared UI primitives live in `packages/ui` to avoid duplication.

**Workspace:** `packages/ui`
**Exports:** headless Vue components + Tailwind class compositions. Consumers supply their own NuxtUI + `main.css` (color tokens travel via CSS custom properties, not hard-coded values).

Components to extract from `apps/web` + new:
- `SettingsGroup.vue` + `SettingRow.vue`
- `OtpInput.vue`
- `ConfirmModal.vue`
- `DataTable.vue` (new — sortable, filterable, paginated rows)
- `StatusBadge.vue` (active / suspended / owner / admin / pending)

`apps/admin` declares `@adyton/ui` as a workspace dependency and imports a thin `packages/ui/styles.css` that re-exports the `--color-brand-*` / `--color-surface-*` token definitions so both apps share the same color system.

---

### Security Analysis

**What V2 preserves from V1:**
- Personal vault: fully ZK. No one — including admin — can access personal vault entries.
- Group key: never transmitted in plaintext. ECDH wrapping is non-interactive.
- Master password / Vault PIN: never stored, never transmitted.

**New attack surfaces:**
- **EC private keys at rest:** `x25519_private_key_enc` and `ed25519_private_key_enc` stored on server, encrypted with `personal_vault_key`. DB compromise + Argon2id brute-force = potential private key recovery → group key access. Mitigation: Argon2id parameters are load-bearing (m=65536, t=3, p=1).
- **WrappedGroupKey rows on server:** all wrapped group keys stored server-side. An attacker who compromises DB + cracks one user's master password can access that user's group keys. Same threat model as personal vault.
- **Invite token as entry point:** a leaked invite link allows an unauthorized person to join the instance. Mitigation: single-use tokens, 7-day TTL, inviter can cancel. Admin can set `allow_member_invites=false` for stricter control.
- **Ownerless groups:** resolved by ownership transfer requirement in the delete flow. Admin UI blocks user deletion until owned groups are transferred or deleted. Groups retain a valid `owner_id` at all times; rotation can always fire (any member can execute it — see Group Key Rotation §).
- **Group key rotation window:** between member removal and rotation completion, removed member may have a cached group_key. Window closes when any remaining member's vault is next unlocked (not just owner). Acceptable risk — removed user's access to new entries is blocked immediately.
- **Master password change coupling (future scope):** both EC private keys (`x25519_private_key_enc`, `ed25519_private_key_enc`) are sealed with `personal_vault_key`. A future master password change feature must re-encrypt these two blobs atomically alongside personal vault entries. Omitting this would leave EC keys undecryptable post-change, silently breaking all group access. This coupling must be in scope when master password change is implemented.

**What V2 explicitly does not provide:**
- Admin vault content recovery. Irrecoverable by design.
- Cross-instance sharing. V3.
- SSO. V3.

---

### Migration from V1

1. Deploy V2 image.
2. New migrations: `user_key_pairs`, `invites`, `groups`, `group_memberships`, `wrapped_group_keys`, `instance_settings`, `audit_logs`; add `role`, `uuc`, `status`, `keypair_reset_required` columns to `users`; add `group_id` (nullable FK) to `vault_entries`; add `group_id` (nullable FK) to `vault_entry_versions`; `groups` includes `owner_id`, `rotation_pending`, `rotation_enqueued_at`.
3. Existing V1 user gets `role = 'owner'`, `status = 'active'`, auto-generated `uuc`.
4. `InstanceSettings` seeded with defaults (`allow_member_invites=true`, `require_2fa=false`).
5. Personal vault entries untouched — no re-encryption.
6. On first post-upgrade unlock: client detects missing keypair → generates both keypairs → `POST /api/keypair`.
7. V2 with a single user is functionally identical to V1.

---

## Implementation Plan

### Step 0 — EC Key Infrastructure

**Goals:** Land the cryptographic foundation. No group UI yet — just key primitives, entities, and API.

**Deliverables:**
- `packages/shared`: `generateX25519Keypair`, `generateEd25519Keypair`, `ecdhWrapGroupKey`, `ecdhUnwrapGroupKey`, `generateGroupKey` — all with explicit AAD as above; `GROUP_KEY_WRAP_INFO` constant for HKDF info string
- `UserKeyPair` entity + migration
- `User` migration: add `role`, `uuc` (UUID v4 auto-generated at insert), `status`, `keypair_reset_required`
- `POST /api/keypair` (first-time only — 409 if keypair already exists)
- `GET /api/keypair`
- Unit tests: round-trip wrap/unwrap, AAD binding rejection, HKDF info binding (different groupId = different wrapping_key), non-extractable invariant

**Ed25519 rationale:** Ed25519 keypair serves no V2 function (V3 cross-instance assertion signing only). It is generated here deliberately alongside X25519 — deferring it to V3 would require a second re-enrollment migration at a point when all users have already been through the keypair setup flow. Front-loading is the cheaper path. The key is stored encrypted; it adds no runtime overhead until V3 signs something with it.

**Future coupling — master password change:** both EC private keys are sealed with `personal_vault_key`. Any future implementation of master password change must re-encrypt `x25519_private_key_enc` and `ed25519_private_key_enc` in the same atomic operation as personal vault re-encryption. Failing to do so leaves group access silently broken after a password change.

---

### Step 1 — Invite-to-Join + User Management

**Goals:** Invite flow, first-user bootstrap, admin user management, instance settings.

**Deliverables:**
- `Invite` entity + migration
- `InstanceSettings` entity + migration (seeded on boot)
- `AuditLog` entity + migration (first audit events fire this step)
- First-user bootstrap: `POST /api/auth/register` open when `users` table empty, else requires `invite_token`
- Invite API: `POST /api/invites`, `GET /api/invites/:token`, `DELETE /api/invites/:token`, `GET /api/invites`
  - `POST /api/invites` response must include `{ token, url, email_delivery: boolean }`
  - `POST /api/invites` returns 409 if a pending (non-expired, non-accepted) invite for the same email exists
- `allow_member_invites` guard on `POST /api/invites`
- Admin API: user list, suspend/reactivate/delete, role change, keypair reset
- Instance settings API: `GET|PUT /api/admin/settings`; GET response includes `email_configured: boolean`
- `packages/ui` workspace created; `SettingsGroup`, `SettingRow`, `StatusBadge`, `ConfirmModal` extracted from `apps/web`
- `apps/admin` Nuxt app scaffolded with auth: uses same `POST /api/auth/login` endpoint as `apps/web`; middleware checks `user.role === 'admin' || 'owner'` before allowing access. Same JWT, same session cookie path — in dev, `NUXT_PUBLIC_API_BASE_URL` on both apps must point to the same API origin.
- Audit events: `INVITE_*`, `USER_SUSPEND`, `USER_REACTIVATE`, `USER_DELETE`, `USER_ROLE_CHANGE`, `USER_KEYPAIR_RESET`, `SETTINGS_UPDATE`
- Unit + integration tests: invite lifecycle (create, validate, consume, expire, cancel), **409 duplicate pending invite**, first-user bootstrap, `allow_member_invites` guard, suspend blocks login

---

### Step 2 — Group Vault

**Goals:** Members can create groups, add members, and share encrypted vault entries.

**Deliverables:**
- `Group`, `GroupMembership`, `WrappedGroupKey` entities + migrations
  - `Group` includes `owner_id`, `rotation_pending`, `rotation_enqueued_at` (see entity model)
- `VaultEntry` migration: add `group_id` nullable FK + index; `user_id` retained (attribution, not access control)
- `VaultEntryVersion` migration: add `group_id` nullable FK (copied from parent VaultEntry at snapshot time, used to reconstruct restore AAD)
- `VaultGuard` logic: if `entry.group_id` is set → check `GroupMembership` (caller must be member); else → check `entry.user_id === req.user.id`. These are mutually exclusive paths — a group entry is never access-controlled by user_id.
- `POST /api/groups/:id/members`: validate target user's `UserKeyPair` exists (422 if not); guard: owner only
- `GET /api/users/directory` + `GET /api/users/directory/:uuc`: include `has_keypair: boolean`
- AAD constants in `packages/shared`: `groupEntryAad(groupId, entryId)`, `groupMetaAad(groupId, entryId)`, `keyWrapAad(groupId, userId)`
- Group CRUD + group vault CRUD (full API shape above)
- `GET /api/keypair/groups` — all `WrappedGroupKey` rows for authenticated user
- User directory API: `GET /api/users/directory`, `GET /api/users/directory/:uuc`
- Version history on group entries (same 10-version rule, version AAD uses `${groupId}:${entryId}`); restore uses group_id from VaultEntryVersion row to recompute AAD
- Audit events: `GROUP_CREATE`, `GROUP_RENAME`, `GROUP_DELETE`, `GROUP_MEMBER_ADD`, `GROUP_MEMBER_REMOVE`
- `apps/admin`: group list page (name, member count, created by — no entry content)
- Unit + integration tests: group vault CRUD, membership guard (non-member cannot read), AAD binding, **add-member rejects when target has_keypair=false**, **version restore for group entry uses group AAD**, directory (no email, has_keypair in response)

---

### Step 3 — Member Lifecycle + Group Key Rotation

**Goals:** Remove members cleanly; auto-rotate group key in background.

**Deliverables:**
- `NotificationService`: unified dispatch (`pusher.trigger` for Soketi, `emailNotifier.send` for admin alerts)
- `POST /api/ws/auth` — Soketi channel auth endpoint (JWT guard + GroupMembership check)
- BullMQ queues `group-key-rotation` + `group-key-rotation-retry` (Redis already in stack)
- `GroupKeyRotationProcessor`: enqueue on member remove, set `Group.rotation_pending=true`, `rotation_enqueued_at=now()`, emit `rotation.pending` to `private-group.{groupId}` via Soketi; on retry exhaustion emit `rotation.failed` to `private-admin` + email admin
- `GET /api/groups/:id/rotation-status` — fallback polling endpoint (for reconnect / clients without active WS); primary signal is the Soketi `rotation.pending` event
- `POST /api/groups/:id/vault/rotate` — guard: any active group member (not owner-only); atomic: new ciphertext for all entries + new `WrappedGroupKey` rows for remaining members, replaces existing in one transaction; on success emits `rotation.complete` to `private-group.{groupId}`
- `VaultService.rotateBatch()` — dedicated method called by rotate endpoint; overwrites entry ciphertext in-place WITHOUT creating `VaultEntryVersion` snapshots. Normal `update()` must NOT be called for rotation — it would burn version history slots (10-rotation limit evicts all real edit history).
- `POST /api/groups/:id/transfer-ownership { target_uuc }` — owner or admin; updates `Group.owner_id`
- Admin user-delete flow: pre-condition check for owned groups; UI prompts transfer or confirm deletion of ownerless groups before proceeding
- Suspend/delete/keypair-reset flows (as specified in Suspend and Delete §)
- Audit events: `GROUP_KEY_ROTATION` (started + complete), `GROUP_OWNERSHIP_TRANSFER`, `USER_DELETE`, `USER_KEYPAIR_RESET`
- Unit + integration tests: rotation job lifecycle, removed user cannot read new entries, **any member (not just owner) can execute rotation**, **rotation does NOT create VaultEntryVersion rows**, rotation deferral when all vaults locked, transfer-ownership updates owner_id

---

### Step 4 — Tests + Security Hardening

> **Note (2026-06-26):** The original Step 4 (Admin Backoffice App — `apps/admin`, `packages/ui`, certified groups) has been **moved to V3**. See `analysis/roadmap/v3-admin.md`. Admin API endpoints (`/api/admin/*`) also move to V3. V2 ships without a dedicated admin app — group-level access control (add/remove members → rotation) is sufficient for the core team vault use case.

**Goals:** Full integration test coverage, security audit, Swagger on all new endpoints.

**Deliverables:**
- Integration tests: group vault CRUD, membership guard, AAD rejection, rotation end-to-end, admin RBAC (member cannot call admin endpoints), invite expiry, `allow_member_invites=false` blocks member invites, directory returns no email
- `@ApiTags`, `@ApiOperation`, `@ApiResponse` + `*.response.dto.ts` files for all V2 endpoints
- `pnpm audit --audit-level=high` clean
- Security invariant tests: server cannot decrypt group vault entry; suspended user session invalidated immediately; invite token single-use
- README update: V2 section, `apps/admin` setup, `packages/ui`

---

### Effort Estimate

| Step | Component | Complexity |
|---|---|---|
| 0 | EC key infrastructure (shared + API) | M |
| 1 | Invite flow + user management API | M |
| 2 | Group vault (entities + API + ECDH crypto + GroupMembership roles) | L |
| 3 | Member lifecycle + rotation + NotificationService + Soketi + BullMQ | L |
| 4 | Tests + hardening | M |
| **Total** | | **L** |

*Admin backoffice (`apps/admin`, certified groups, admin API endpoints) → V3.*

Step 2 is the highest-risk step — AAD discipline and ECDH wrapping must be correct from first write. Retroactive correction requires full group vault re-encryption.
