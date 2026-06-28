## V4 — Federation and Cross-Instance Sharing

> **Roadmap note (2026-06-26):** This scope is now **V4** (renamed from V3). The new V3 is Admin Backoffice + Certified Groups — see `analysis/roadmap/v3-admin.md`. This document is unchanged; all content remains valid.



### Overview

V3 enables multiple independent Adyton deployments to collaborate without any third-party trust. Each company runs its own on-premise instance; a self-hosted **federation hub** (itself a full Adyton instance) acts as an identity registry and cross-organisation coordination point.

**Key invariant:** vault data never leaves its home instance. The hub holds only identity metadata (UUC, public keys, instance URLs). Cross-instance sharing is purely a key-wrapping operation over the V2 ECDH model.

**What V3 is NOT:** no vault replication, no real-time sync, no SSO (SSO is a separate V3 sub-scope not addressed here). V3 without SSO is a complete standalone product — an organisation that wants cross-instance vault sharing but uses external IdP separately can stop at V3 base.

**Prerequisite:** V2 (EC keypairs, group vault model) must be deployed on all participating instances.

---

### Design Principles

1. **Hub is identity-only.** Hub stores public keys + instance URLs. Hub never touches ciphertext, never routes vault data, never sees group keys.
2. **Key delivery is direct, not hub-proxied.** Instance A sends wrapped keys directly to Instance B. Hub is only consulted at group-setup time (identity lookup + bundle verification). Hub being offline after setup does not block vault access.
3. **Vault access is direct browser-to-remote.** User B's browser calls Instance A directly using a short-lived EdDSA assertion. No hub in the hot path.
4. **Same crypto primitives as V2.** Same ECDH wrap, same HKDF info string, same AAD conventions. V3 adds the network routing layer; it does not add new crypto algorithms.
5. **Ed25519 for signing, X25519 for wrapping.** These are distinct keys, generated in V2 Step 0. V3 is the first scope that actually uses Ed25519 (cross-instance assertions). X25519 is for ECDH key-wrapping only.
6. **Hub signing key is separate from hub instance auth key.** Hub has two EC keys: one for authenticating as an instance (X25519, like all spokes), one Ed25519 signing key for identity bundles.

---

### Key Hierarchy — V3 Extension

V2 key hierarchy is unchanged. V3 adds one new use of the existing Ed25519 key:

```
V2 hierarchy (unchanged):
  master_password → Argon2id → personal_vault_key
      ├─ decrypt x25519_private_key_enc → group key wrapping (V2 + V3)
      └─ decrypt ed25519_private_key_enc → ed25519_private_key
               └─ signs cross-instance assertions (V3, first actual use of this key)

V3 adds:
  hub_ed25519_signing_key (server-side, Hub only)
      └─ signs FederatedUser identity bundles
         spokes verify hub signature using hub's published ed25519_public_key
```

No new crypto primitives. No new client-side key derivation. V3 is a routing + attestation layer on top of V2 crypto.

---

### UUC Wire Format

V2 stores `uuc` as a plain UUID v4 in the `users` table. For federation wire calls, the UUC is prefixed with the Adyton URN namespace to prevent collision with other systems:

```
urn:adyton:user:a1b2c3d4-7f8e-4a2b-9c1d-e5f6a7b8c9d0
```

No schema change needed in V2. Spokes wrap `user.uuc` in the URN prefix when constructing federation payloads; they strip it when storing locally. The UUID portion is stable and matches the V2 `users.uuc` column.

---

### Entity Model (hub-specific tables)

These tables exist only on instances with `FEDERATION_HUB=true`. Spoke instances do not have them.

```
FederatedInstance
├── id (UUID)
├── instance_url           (unique — canonical origin of the spoke)
├── instance_x25519_public_key   (spoke's X25519 public key — for future ECDH hub routing)
├── instance_ed25519_public_key  (spoke's Ed25519 public key — for assertion verification)
├── org_name
├── admin_contact
├── status: 'pending' | 'active' | 'revoked'
├── instance_token_hash    (SHA-256 of the issued long-lived token)
└── registered_at

FederatedUser
├── uuc                      (primary key — URN string)
├── x25519_public_key        (for cross-instance ECDH group key wrapping)
├── ed25519_public_key       (for cross-instance assertion verification)
├── instance_id → FederatedInstance
├── signed_bundle: jsonb     (hub-signed identity bundle, cached — see Identity Bundle §)
├── keypair_published_at     (null until first vault unlock; spoke re-publishes on keypair reset)
└── registered_at

CrossOrgGroup
├── id (UUID)
├── name
├── home_instance_id → FederatedInstance
├── home_group_id            (group UUID on home instance — opaque to hub)
└── created_by_uuc           (UUC of admin who created the cross-org group)
```

**CrossOrgGroup purpose:** administrative record on the hub only. Used by: hub admin UI (list + manage cross-org groups), and as the validation gate on `POST /federation/inbound/wrapped-key` — the hub confirms the group_id maps to a known `CrossOrgGroup` before routing. Not in the hot path for vault access.

**Indexes:**
- `FederatedUser(instance_id)` — list all users on a spoke
- `FederatedInstance(instance_url)` unique
- `FederatedInstance(status)` — fast active-instance lookup

---

### Identity Bundle

Signed by the hub's Ed25519 signing key. Spokes verify before trusting a cross-instance identity.

```json
{
  "uuc": "urn:adyton:user:<uuid>",
  "x25519_public_key":  "base64url",
  "ed25519_public_key": "base64url",
  "instance_url": "https://adyton.clientA.com",
  "published_at": "2026-07-01T00:00:00Z",
  "hub_signature": "base64url-EdDSA-sig-by-hub-signing-key"
}
```

Hub signs the canonical JSON (deterministic key sort, no whitespace) of the above fields (excluding `hub_signature` itself) using `FEDERATION_HUB_SIGNING_KEY`. Spokes verify using the hub's published Ed25519 public key (`FEDERATION_HUB_VERIFY_KEY`).

**Two keys per user, explicit:** `x25519_public_key` is for ECDH group key wrapping only; `ed25519_public_key` is for assertion signature verification only. These must not be swapped — X25519 cannot sign.

---

### Hub Architecture

The hub is a standard Adyton V2 instance with `FEDERATION_HUB=true`. This flag activates `FederationHubModule`. All V2 functionality (personal vault, groups) is available on the hub for its own users.

**Hub-only endpoints:**

```
# Instance management
POST   /federation/instances/register     ← spoke self-registers (status = 'pending')
PATCH  /federation/instances/:id/approve  ← hub admin approves (status → 'active')
DELETE /federation/instances/:id          ← revoke spoke (hub admin)
GET    /federation/instances              ← list all instances (hub admin)

# Identity registry
GET    /federation/users/:uuc             ← resolve URN → signed identity bundle
POST   /federation/users/publish          ← spoke publishes/updates a user identity
DELETE /federation/users/:uuc             ← spoke retracts a user (on user delete)

# Cross-org group registry
GET    /federation/groups                 ← list cross-org groups (hub admin)
POST   /federation/groups                 ← register a cross-org group (home-spoke admin)
DELETE /federation/groups/:id             ← unregister (home-spoke admin or hub admin)
```

**Spoke-only endpoints (all instances with `FEDERATION_SPOKE` set):**

```
POST   /federation/inbound/wrapped-key    ← receive WrappedGroupKey from another spoke
DELETE /federation/inbound/wrapped-key/:groupId/:uuc  ← member removed from remote group
GET    /federation/outbound/status        ← connectivity check + hub identity key fetch
```

**Authentication on hub endpoints:**
- Spoke→hub calls: `Authorization: Bearer <instance_token>` (opaque, issued on registration)
- Hub admin endpoints: normal JWT of a hub user with `role = 'owner' | 'admin'`

**Realtime events (Soketi — same infrastructure as V2):**
Federation-specific events emitted to the `private-admin` channel on the hub instance:

| Event | Trigger |
|---|---|
| `federation.instance_pending` | New spoke registration awaiting approval |
| `federation.push_failed` | Remote wrapped-key push to spoke failed after all retries |
| `federation.user_deleted` | Remote spoke notified hub of a user deletion affecting local groups |

Spoke instances also receive `rotation.pending` on `private-group.{groupId}` when a remote member triggers rotation (standard V2 channel, no new channel needed).

**Mobile push (post-V3 scope):** No background mobile push needed in V3. All federation events are admin-facing; admin uses apps/admin on web. When mobile background push is added (post-V2/V3), the mechanism is Web Push VAPID (Android, no Firebase SDK) + APNs (iOS, mandatory). Firebase is an option that abstracts both at the cost of a Google project dependency.

---

### Instance Registration and Trust

```
1. Spoke admin generates two instance keypairs:
     FEDERATION_INSTANCE_X25519_KEY_PATH  (for future ECDH use)
     FEDERATION_INSTANCE_ED25519_KEY_PATH (for signing spoke-originated assertions)

2. Spoke POSTs to hub /federation/instances/register:
   { instance_url, instance_x25519_public_key, instance_ed25519_public_key,
     org_name, admin_contact }
   → status = 'pending'; no token issued yet

3. Hub admin sees pending registration in backoffice, approves.
   PATCH /federation/instances/:id/approve
   → Hub issues instance_token (opaque, SHA-256 hashed in DB)
   → Response: { instance_token }

4. Spoke stores instance_token in FEDERATION_INSTANCE_TOKEN env.
   All future spoke→hub calls: Authorization: Bearer <instance_token>

5. Spoke calls GET /federation/outbound/status to confirm connectivity
   and fetch hub's Ed25519 public signing key (FEDERATION_HUB_VERIFY_KEY).
   Spokes cache this key; it changes only on hub key rotation (rare).
```

**Instance token security:** long-lived, opaque, stored hashed. If compromised, hub admin revokes via `DELETE /federation/instances/:id`. No automated rotation in V3 — token rotation is a manual operation requiring a new token issuance (same as re-registration but status stays 'active').

**No spoke-to-spoke direct trust.** Instance A never directly trusts Instance B's assertions without hub verification. Hub is the only trust anchor.

---

### User Identity Publication

**Timing: publication happens on first vault unlock, not at registration.**

Registration creates the user with a UUC but no keypair. The keypair is generated client-side on first vault unlock (V2 Step 0 invariant). Spoke publishes to hub only after keypair exists.

```
1. User registers on adyton.clientA.com → User row created, uuc assigned, no UserKeyPair yet.
   Spoke does NOT publish to hub yet (no public keys to publish).

2. User completes first vault unlock → client POSTs UserKeyPair (POST /api/keypair).
   Server hook: after UserKeyPair is stored, spoke publishes to hub:
   POST /federation/users/publish  (Authorization: Bearer <instance_token>)
   {
     uuc: "urn:adyton:user:<uuid>",
     x25519_public_key:  "base64url",
     ed25519_public_key: "base64url",
     instance_url: "https://adyton.clientA.com"
   }

3. Hub stores FederatedUser row, signs the identity bundle, returns signed_bundle.
   Spoke stores the signed_bundle locally (UserKeyPair.federation_bundle_cache — optional optimisation).

4. On admin keypair reset (V2 flow): UserKeyPair deleted → FederatedUser deleted at hub
   (DELETE /federation/users/:uuc). User re-publishes on next first-unlock.
```

**Cross-instance add-member before publication:** if a remote user's `has_keypair=false` at their instance, they haven't been published to the hub yet. `GET /federation/users/:uuc` returns 404. The add-member UI must handle this — same "pending setup" state as local keypair window (V2 C3 fix).

---

### Cross-Instance Group Sharing

#### Setup (A wants to share group with user B on Instance B)

```
Precondition: the group must be registered as a CrossOrgGroup on the hub first.
POST /federation/groups { home_group_id, name } → CrossOrgGroup.id (hub admin or group owner)

1. A (group owner or admin) enters B's UUC.

2. Instance A queries hub:
   GET /federation/users/urn:adyton:user:<B.uuid>
   → Returns signed identity bundle for B: { uuc, x25519_public_key, ed25519_public_key,
                                              instance_url, hub_signature }

3. Instance A verifies hub_signature using FEDERATION_HUB_VERIFY_KEY (Ed25519 verify).
   If signature invalid → abort; do not proceed.

4. Instance A performs ECDH group key wrapping (IDENTICAL to V2 local flow):
   - eph_priv, eph_pub = X25519.generateKeypair()
   - shared_secret  = X25519(eph_priv, B.x25519_public_key)   ← X25519 only
   - wrapping_key   = HKDF-SHA256(shared_secret, salt=eph_pub,
                        info="adyton-group-key-wrap-v1:${groupId}:${B.userId}", len=32)
   - wrapped        = AES-256-GCM(group_key, wrapping_key,
                        AAD="${groupId}:${B.userId}:wrap")
   Note: B.userId here is B's local UUID (not the full URN), same as V2 local wrap.

5. Instance A POSTs directly to Instance B (NOT via hub):
   POST https://adyton.clientB.com/federation/inbound/wrapped-key
   Authorization: Bearer <instance_token>   ← A authenticates as a spoke to B
   {
     cross_org_group_id: "<CrossOrgGroup.id on hub>",
     home_group_id: "<group UUID on Instance A>",
     home_instance_url: "https://adyton.clientA.com",
     uuc_of_B: "urn:adyton:user:<uuid>",
     wrapped_group_key, eph_pub, iv, auth_tag
   }
   Instance B validates: cross_org_group_id exists on hub (verified via hub lookup),
   uuc_of_B maps to a local user, stores WrappedGroupKey.

6. Instance A creates a local GroupMembership row referencing B's UUC.
   eph_priv is discarded immediately after step 4.
```

**Why direct, not hub-proxied:** hub as proxy = hub as single point of failure for key delivery. After setup, vault access is already hub-independent. Key delivery should be too. Instance B authenticates A as a legitimate spoke using A's instance token (presented to B's `/federation/inbound/` endpoint, which B validates against the hub's instance registry in step 5).

#### Access (B reads entries from A's group)

```
1. B unlocks vault → personal_vault_key → x25519_private_key.

2. B calls GET /api/keypair/groups → sees a WrappedGroupKey with
   home_instance_url = "https://adyton.clientA.com".

3. B unwraps group_key (identical to V2 local flow — HKDF + AES-GCM-decrypt).

4. B's browser calls Instance A directly:
   GET https://adyton.clientA.com/api/groups/:id/vault
   Authorization: Bearer <cross-instance assertion>

5. Instance A verifies the assertion:
   - JWT algorithm: EdDSA (Ed25519)
   - Payload: { sub: "urn:adyton:user:<uuid>", aud: "https://adyton.clientA.com",
                iat, exp (60-second window), group_id }
   - Signed by B's ed25519_private_key   ← signing key, NOT X25519
   - Verified against B's ed25519_public_key from the hub-signed identity bundle
     (Instance A fetched and cached B's bundle at group setup in step 3 above)
   - Check: UUC in GroupMembership for this group + assertion not expired

6. Instance A returns encrypted entries (ciphertext only — ZK preserved).

7. B decrypts locally with group_key (AAD: "${groupId}:${entryId}").
```

**CORS requirement:** Instance A must allow cross-origin requests from browsers loading Instance B. In production: `CORS_ALLOWED_ORIGINS` on each spoke should include the URLs of all spokes it shares groups with. In V3 the cors allowlist can be derived from registered `FederatedInstance.instance_url` values on the hub (admin-approved list). Each spoke's deployment config must include origins of other spokes it shares with.

**Assertion generation:** client generates the JWT client-side, signed with `ed25519_private_key` (already in memory from vault unlock). No server round-trip needed for generation.

---

### Cross-Instance Key Rotation

When a member is removed from a group that has cross-instance members:

```
1. Standard V2 rotation flow (any member executes).

2. Rotation executor also needs to re-wrap for cross-instance members:
   - For each remote GroupMembership row: fetch fresh identity bundle from hub
     (GET /federation/users/:uuc) to get current x25519_public_key
   - ECDH-wrap new group_key for each remote member (same flow as setup step 4)
   - POST to their spoke instance: POST /federation/inbound/wrapped-key (replaces old row)

3. POST /api/groups/:id/vault/rotate payload extended:
   { new_ciphertext[], new_local_wrapped_keys[], new_remote_wrapped_keys[] }
   Server executes local updates atomically; for each remote_wrapped_key, the API
   proxies the push to the remote instance (server-side, not client) as part of the
   same logical operation. If a remote push fails, the transaction rolls back.

4. Rotation completion requires all remote pushes to succeed.
   On failure: retry with exponential backoff (BullMQ). Local rotation is not committed
   until all remotes have acknowledged.
```

**Remote member removal:**
```
DELETE /api/groups/:id/members/:uuc  (where :uuc is a remote member)
→ Server calls DELETE /federation/inbound/wrapped-key/:groupId/:uuc on remote instance
→ Remote instance deletes WrappedGroupKey row for that user
→ Rotation job enqueued (same as local removal)
```

---

### Cross-Org Group Membership Lifecycle

| Event | Who acts | What happens |
|---|---|---|
| Register cross-org group | Group owner on home spoke | POST /federation/groups; CrossOrgGroup created on hub |
| Add remote member | Group owner's client | Hub lookup → ECDH wrap → direct push to remote spoke |
| Remove remote member | Group owner's client (server proxies DELETE to remote) | WrappedGroupKey deleted remotely + rotation enqueued |
| Remote user deletes account | Remote spoke | DELETE /federation/users/:uuc to hub; home spoke notified (webhook or polling); membership cleaned up |
| Remote user keypair reset | Remote spoke re-publishes to hub | Home instance re-wraps on next rotation cycle (or admin triggers manual re-add) |
| Spoke revoked by hub | Hub admin | Hub marks 'revoked'; all local GroupMembership rows for that spoke's users should be cleaned up; home instance queried by admin |
| Group key rotation | Any local member's client (server handles remote pushes) | Re-wrap for all remaining local + remote members atomically |
| Unregister cross-org group | Home spoke admin or hub admin | DELETE /federation/groups/:id; spokes should clean up WrappedGroupKey rows on notification |

---

### Security Analysis

**What V3 preserves:**
- Vault data never leaves its home instance.
- Hub never sees vault ciphertext, group keys, or private keys.
- Group key wrapped with ECDH (same V2 invariants: HKDF info binding, AAD binding).
- Cross-instance access requires both: valid `WrappedGroupKey` AND valid short-lived EdDSA assertion.
- Assertion is audience-bound and time-limited (60 s) — replay to a different instance or after expiry is rejected.

**New attack surfaces:**
- **Hub as identity oracle:** hub compromise → attacker can publish a fake identity bundle substituting an attacker-controlled `x25519_public_key` for a victim UUC. A group owner wrapping for the victim would encrypt to the attacker's key. Mitigation: spoke admins verify UUC identity out-of-band before adding cross-instance members (the hub signature is only as trustworthy as the hub). For high-sensitivity groups, fingerprint verification is recommended.
- **Assertion replay within window:** a captured assertion can be replayed for up to 60 seconds. Mitigation: 60-second window is minimal; the assertion is group-scoped (not a general bearer). If tighter bounds are needed, a `jti` nonce + server-side seen-set can be added (V3.1 scope).
- **Hub unavailability at setup time:** new cross-instance memberships cannot be established if hub is down (identity lookup fails). Existing memberships and vault access continue unaffected — hub is not in the hot path after setup.
- **Direct inter-spoke CORS surface:** Instance A must serve group vault entries to browsers from other origins. An incorrectly broad `CORS_ALLOWED_ORIGINS` config on A could expose the vault API to unintended origins. Mitigation: allowlist should be restricted to known registered spoke origins only.
- **Instance token compromise:** a stolen `FEDERATION_INSTANCE_TOKEN` allows impersonation of a spoke at the hub and at other spokes accepting inbound wrapped keys. Mitigation: token revocation via hub admin; short-lived token rotation as a V3.1 hardening step.
- **Hub signing key compromise:** an attacker with the hub's Ed25519 signing key can forge identity bundles pointing any UUC to an attacker-controlled public key. This key must be protected at the same level as JWT RS256 private keys. Rotation requires re-signing all existing `FederatedUser.signed_bundle` records.

**What V3 explicitly does not provide:**
- Vault data replication (entries live on home instance only; remote access requires home instance to be online).
- Automatic rotation on spoke revocation (admin action required).
- Real-time membership sync (eventual consistency via hub polling/webhooks).
- SSO / external identity federation (separate scope).
- Automatic CORS allowlist management (operator-configured per deployment).

---

### Deployment Model

```
# Hub (one server, operator-controlled)
FEDERATION_HUB=true
FEDERATION_HUB_SIGNING_KEY_PATH=/secrets/hub_ed25519.key      ← signs identity bundles
FEDERATION_HUB_INSTANCE_KEY_PATH=/secrets/hub_instance_ec.key  ← hub's own instance auth key

# Spoke (each customer's server)
FEDERATION_SPOKE=https://hub.yourcompany.com
FEDERATION_INSTANCE_TOKEN=<token-issued-by-hub-on-approval>
FEDERATION_INSTANCE_ED25519_KEY_PATH=/secrets/instance_ed25519.key
FEDERATION_INSTANCE_X25519_KEY_PATH=/secrets/instance_x25519.key
FEDERATION_HUB_VERIFY_KEY=<base64url-hub-ed25519-public-key>   ← fetched on first connect
CORS_ALLOWED_ORIGINS=https://adyton.clientB.com,https://adyton.clientC.com
```

Hub PostgreSQL stores only identity metadata — small footprint (< 2 MB for 10,000 federated users). Hub does not need special hardware; a standard VPS suffices.

---

## Implementation Plan

### Step 0 — Hub Infrastructure + Identity Publication

**Goals:** Land federation module, hub signing key, instance registration, identity publication on keypair creation.

**Deliverables:**
- `FederationModule` shared infrastructure (token auth, hub verify-key fetch)
- `FederationHubModule`: `FederatedInstance`, `FederatedUser`, `CrossOrgGroup` entities + migrations
- Hub signing keypair setup (Ed25519); `scripts/gen-federation-keys.mjs`; `secrets/hub_ed25519.key` gitignored
- Instance registration endpoints: `POST /federation/instances/register`, `PATCH /federation/instances/:id/approve`, `DELETE /federation/instances/:id`, `GET /federation/instances`
- Identity publication: `POST /federation/users/publish` (called by spoke after `POST /api/keypair` succeeds), `DELETE /federation/users/:uuc` (called on user delete / keypair reset)
- `GET /federation/users/:uuc` returns hub-signed identity bundle; 404 if user hasn't published (keypair not yet generated)
- `GET /federation/outbound/status` on spokes (connectivity + hub verify-key fetch)
- Hub backoffice page (in `apps/admin`): pending instance approvals
- Unit tests: identity bundle signing + verification, bundle field ordering (deterministic), hub-key-absent rejection

---

### Step 1 — Cross-Instance Member Add + Key Delivery

**Goals:** Group owner can add a remote member; wrapped key delivered directly to remote spoke.

**Deliverables:**
- `POST /federation/groups`, `GET /federation/groups`, `DELETE /federation/groups/:id` on hub
- `POST /federation/inbound/wrapped-key` on spokes: validates `cross_org_group_id` via hub, stores WrappedGroupKey, creates GroupMembership row with remote origin flag
- `DELETE /federation/inbound/wrapped-key/:groupId/:uuc` on spokes
- `POST /api/groups/:id/members` extended: if target UUC resolves to a remote instance → hub lookup → ECDH wrap → direct POST to remote spoke
  - HKDF info: `"adyton-group-key-wrap-v1:${groupId}:${recipientUserId}"` (identical to V2)
  - AAD: `"${groupId}:${recipientUserId}:wrap"` (identical to V2)
  - Uses `x25519_public_key` from identity bundle — NOT `ed25519_public_key`
- CORS config: `CORS_ALLOWED_ORIGINS` read from env; federation-aware CORS middleware on `/api/groups/:id/vault*` routes
- Unit tests: ECDH wrap with remote public key, AAD binding, wrong-key-type rejection (ed25519 key in X25519 slot → fail fast)
- Integration tests: add remote member end-to-end, inbound wrapped-key storage, hub-signature-invalid → reject

---

### Step 2 — Cross-Instance Access + Assertions

**Goals:** Remote member B can read entries from Instance A using an Ed25519 assertion.

**Deliverables:**
- `packages/shared`: `signCrossInstanceAssertion(ed25519PrivateKey, { groupId, aud, iat, exp })` → JWT (EdDSA)
- `packages/shared`: `verifyCrossInstanceAssertion(jwt, { ed25519PublicKey, expectedAud, expectedGroupId })` → boolean
- `GET /api/groups/:id/vault` (and per-entry, per-version endpoints) extended: if caller presents a cross-instance assertion (JWT, no local session) → verify EdDSA sig against hub-cached `FederatedUser.ed25519_public_key`, check GroupMembership
- Instance A caches the identity bundle for remote members at group-setup time (stored in GroupMembership row or separate `RemoteMemberCache` table — see note below)
- `GET /federation/outbound/status` returns `hub_verify_key` so spokes can refresh their cached hub verify key
- Unit tests: assertion sign + verify, expired assertion rejected, wrong audience rejected, wrong group_id rejected, X25519 key presented as signing key → reject

**Remote member bundle cache note:** Instance A needs to verify B's assertion against B's `ed25519_public_key`. Hub is not in the hot path for access. Options: (a) store `ed25519_public_key` in the `GroupMembership` row at add-member time; (b) re-fetch from hub on each request (hub-dependent). Option (a) preferred — add `remote_ed25519_public_key: text` to `GroupMembership`, populated when a remote member is added. On keypair reset, the remote bundle is stale until the group owner re-adds the member (same flow as local keypair reset in V2).

---

### Step 3 — Cross-Instance Rotation + Lifecycle + Tests

**Goals:** Rotation re-wraps for remote members; membership lifecycle events propagate correctly.

**Deliverables:**
- `POST /api/groups/:id/vault/rotate` extended: payload includes `remote_wrapped_keys[]`; server-side proxies DELETE+POST to remote spokes as part of rotation transaction; rotation fails (rollback) if any remote push fails after retries
- BullMQ queue `federation-remote-push` (same Redis as V2); retry strategy: exponential backoff, max 5 attempts; on exhaustion emit `federation.push_failed` to Soketi `private-admin` channel + email admin alert
- Remote user delete: spoke calls `DELETE /federation/users/:uuc` → hub broadcasts to interested home instances (webhook `POST /federation/inbound/user-deleted { uuc }` on home spoke) → home instance cleans GroupMembership rows
- Spoke revocation: hub admin revokes → hub webhook to all other spokes → each cleans GroupMembership rows for that spoke's users
- `apps/admin` hub pages: instance list + approve/revoke, cross-org group list, federated user lookup
- `DELETE /api/admin/users/:id` extended: calls `DELETE /federation/users/:uuc` to hub as part of delete flow
- Integration tests: remote member rotation (re-wrap delivered to remote), rotation rollback on remote push failure, assertion verification with stale key (keypair reset → add-member required), spoke revocation cleans memberships, duplicate inbound wrapped-key overwrites cleanly

---

### Effort Estimate

| Step | Component | Complexity |
|---|---|---|
| 0 | Hub infrastructure, identity publication timing fix | M |
| 1 | Cross-instance member add, direct key delivery, CORS | M |
| 2 | EdDSA assertions, cross-instance vault access | M |
| 3 | Cross-instance rotation, lifecycle, admin pages, tests | L |
| **Total** | | **XL** |

Step 1 is highest-risk: the ECDH wrap for remote members must use the same HKDF info + AAD as V2 local wrapping. Any deviation makes cross-instance keys uninteroperable with the local key model. Review Step 1 against V2 Step 2 crypto constants before writing code.
