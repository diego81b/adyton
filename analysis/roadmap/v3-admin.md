## V3 — Admin Backoffice + Certified Groups

### Overview

V3 adds the governance layer on top of V2's team vault. It ships `apps/admin` (a separate Nuxt app for IT administrators), `packages/ui` (shared component library), certified groups (admin-created, central-to-peripheral invite flow), and instance-level user lifecycle management.

**Prerequisite:** V2 must be deployed. V3 is additive — V2 continues to work identically with or without V3.

**What V3 is NOT:** no federation, no SSO. V3 is a complete standalone product for organizations that need IT governance over secret distribution without cross-instance complexity.

---

### Why V3 is Separate from V2

V2 group vaults are **peer-to-peer**: any member creates a group, invites peers, all parties manage entries. This covers team-level secret sharing.

Certified groups are **central-to-peripheral**: IT admin creates a group, pushes membership to employees, employees receive read-only access to secrets without any vault management action. The admin controls what secrets employees see; employees cannot modify them.

This governance model requires a dedicated admin interface separate from the user vault (`apps/web`). Mixing it into `apps/web` conflates IT administration with end-user experience.

---

### Certified Groups

**Standard group (V2):** any member creates, all members are editors by default, peer invite flow.

**Certified group (V3):** admin creates in `apps/admin`, members receive a group invite (not an instance invite), default role is `viewer`.

**Group invite flow (central → peripheral):**

```
1. Admin creates certified group in apps/admin
   POST /api/admin/groups { name, description, type: 'certified' }

2. Admin generates group invite for a recipient
   POST /api/admin/groups/:id/invites { email, role: 'viewer' | 'editor' }
   → Response: { token, url: "/register?group_invite=<token>", email_delivery: boolean }
   → If SMTP configured: sends email
   → Otherwise: admin copies URL out-of-band

3. Recipient opens link → /register?group_invite=<token>
   → Client calls GET /api/group-invites/:token (validate, pre-fill email, show group name)
   → If already registered: redirect to login, then accept flow

4. On first vault unlock after accepting:
   → Server detects pending group membership (GroupInvite accepted but WrappedGroupKey not yet delivered)
   → Admin (or any group manager) must complete the wrap:
       fetch recipient's x25519_public_key → ECDH wrap group_key → POST WrappedGroupKey
   → Alternatively: background job notifies group managers to complete wrap

5. On next unlock after wrap is complete:
   → Client calls GET /api/keypair/groups → sees the WrappedGroupKey
   → Decrypts group key → vault shows "Groups" section with certified group entries (read-only badge for viewers)
```

**GroupInvite entity (new, distinct from V2 instance Invite):**

```
GroupInvite:
├── id: UUID (token — used in invite link)
├── group_id → Group
├── role: 'viewer' | 'editor'
├── email
├── created_by → User (admin)
├── expires_at (7 days)
├── accepted_at (null until used — single-use)
└── accepted_by → User (null until used)
```

---

### Entity Model (V3 additions)

```
Group (extended from V2):
└── type: 'standard' | 'certified'   (new)
    'certified' groups can only be created/modified via admin API

GroupInvite (new — distinct from V2 Invite):
├── id: UUID (token)
├── group_id → Group
├── role: 'viewer' | 'editor'
├── email
├── created_by → User
├── expires_at
├── accepted_at
└── accepted_by → User
```

---

### packages/ui

Shared component library used by both `apps/web` and `apps/admin`.

**Workspace:** `packages/ui`
**Exports:** headless Vue components + Tailwind class compositions. Consumers supply their own NuxtUI + `main.css` (color tokens travel via CSS custom properties).

Components extracted from `apps/web`:
- `SettingsGroup.vue` + `SettingRow.vue`
- `OtpInput.vue`
- `ConfirmModal.vue`

New components (admin-focused):
- `DataTable.vue` — sortable, filterable, paginated rows
- `StatusBadge.vue` — active / suspended / owner / admin / pending / viewer / editor / manager

---

### apps/admin

Separate Nuxt 4 app. Same JWT as `apps/web`, role-check middleware (`role === 'owner' | 'admin'`). Separate Docker service + port.

**Pages:**

```
/users          List all users (status, role, keypair status)
                Actions: suspend, reactivate, delete, role change, keypair reset
/users/:id      User detail + group memberships + audit trail

/groups         List all groups (name, type, member count, rotation status)
/groups/new     Create certified group
/groups/:id     Group detail — members, role per member, pending invites
                Actions: generate group invite, change member role, remove member

/invites        All pending group invites (admin view)

/audit          Paginated audit log (filter by event type, user, date range)

/settings       Instance settings:
                - require_2fa (boolean)
                - session_timeout_ms (null | number)
                - allow_member_invites (boolean)
                Notifications section: email_configured status (read-only, env-backed)
```

**Soketi integration:** admin subscribes to `private-admin` channel. `rotation.failed` and `rotation.failed` events surface as in-app banners.

---

### API Surface (V3 additions)

```
# Certified groups (admin only)
POST   /api/admin/groups              ← create certified group
PATCH  /api/admin/groups/:id          ← rename / change settings
DELETE /api/admin/groups/:id          ← delete (admin only)

# Group invites (admin only)
POST   /api/admin/groups/:id/invites  ← generate group invite { email, role }
DELETE /api/admin/groups/:id/invites/:token ← cancel pending
GET    /api/admin/groups/:id/invites  ← list pending invites for group

# Group invite acceptance (public — used by register/login page)
GET    /api/group-invites/:token      ← validate + get group name + pre-fill email

# Admin user management (moved from V2 spec)
GET    /api/admin/users
PATCH  /api/admin/users/:id/role
PATCH  /api/admin/users/:id/suspend
PATCH  /api/admin/users/:id/reactivate
DELETE /api/admin/users/:id
POST   /api/admin/users/:id/reset-keypair

# Admin instance config (moved from V2 spec)
GET    /api/admin/settings            ← includes email_configured: boolean
PUT    /api/admin/settings

# Audit log (moved from V2 spec)
GET    /api/admin/audit               ← paginated, filter by event type + user
```

---

### Audit Log Events (V3 additions)

```
CERTIFIED_GROUP_CREATE    groupId, name, by
CERTIFIED_GROUP_INVITE    groupId, inviteId, recipientEmail, role, by
CERTIFIED_GROUP_INVITE_ACCEPT  groupId, inviteId, userId
GROUP_MEMBER_ROLE_CHANGE  groupId, targetUserId, oldRole, newRole, by
USER_SUSPEND              targetUserId, by
USER_REACTIVATE           targetUserId, by
USER_DELETE               targetUserId, by
USER_ROLE_CHANGE          targetUserId, oldRole, newRole, by
USER_KEYPAIR_RESET        targetUserId, by
SETTINGS_UPDATE           changedFields[], by
```

---

### Security Analysis

**What V3 preserves:**
- Personal vault: ZK unchanged.
- Group key: never transmitted in plaintext. ECDH wrapping unchanged.
- Admin cannot read certified group vault content — only revoke access.

**New attack surfaces:**
- **Group invite token:** leaked link lets unauthorized person join a certified group with the pre-assigned role. Mitigation: single-use tokens, 7-day TTL, admin can cancel. Email-bound (validated at acceptance).
- **Admin role escalation:** admin can change user roles. Mitigation: audit log records all role changes; owner-only can change admin role.
- **Wrapped key delivery window:** between GroupInvite acceptance and WrappedGroupKey delivery, recipient is in the group but cannot access entries. Background job / manager notification closes this promptly.

---

### Implementation Plan

#### Step 0 — packages/ui

Extract `SettingsGroup`, `SettingRow`, `OtpInput`, `ConfirmModal` from `apps/web`. Add `DataTable`, `StatusBadge`. Wire `apps/web` to consume from `packages/ui`. Scaffold `packages/ui` workspace.

Complexity: S

#### Step 1 — apps/admin scaffold + auth

`apps/admin` Nuxt app: auth pages (login only — no register), role-check middleware, same JWT cookie. Docker service + port. `NUXT_PUBLIC_API_BASE_URL` on both apps must point to same API origin.

Complexity: S

#### Step 2 — Certified Groups + Group Invite Flow

- `Group.type` migration; `GroupInvite` entity + migration
- `POST /api/admin/groups`, `POST /api/admin/groups/:id/invites`, `GET /api/group-invites/:token`
- `/register` page: detect `group_invite` query param, pre-fill email, accept on registration
- On first unlock: detect pending group membership, notify managers to complete wrap
- `apps/admin` group pages: create certified group, generate invite, list members

Complexity: M

#### Step 3 — Instance User Management

- Admin API: suspend/reactivate/delete/role-change/keypair-reset
- `apps/admin` user pages: list, detail, actions with ConfirmModal
- Pre-condition check for owned groups before delete (transfer or force-delete)
- `AuditLog` events for all admin actions

Complexity: M

#### Step 4 — Audit Log UI + Instance Settings

- `GET /api/admin/audit` (paginated, filterable)
- `apps/admin` audit page with DataTable
- `apps/admin` settings page (require_2fa, session_timeout, allow_member_invites, email status)
- Soketi `private-admin` channel integration in apps/admin (rotation.failed banner)

Complexity: M

#### Step 5 — Tests + Security Hardening

- Integration tests: certified group invite lifecycle, role enforcement (viewer cannot write), admin RBAC, invite expiry
- Security invariant tests: admin cannot decrypt certified group entries, group invite single-use
- `pnpm audit --audit-level=high` clean
- Swagger for all V3 endpoints
- README update: V3 section, `apps/admin` setup, `packages/ui`

Complexity: M

---

### Effort Estimate

| Step | Component | Complexity |
|---|---|---|
| 0 | packages/ui extraction + scaffold | S |
| 1 | apps/admin scaffold + auth | S |
| 2 | Certified groups + group invite flow | M |
| 3 | Instance user management | M |
| 4 | Audit log UI + instance settings | M |
| 5 | Tests + hardening | M |
| **Total** | | **L** |
