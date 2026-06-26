## V3 — Federation and Cross-Instance Sharing

### Overview

V3 enables multiple independent Adyton deployments to collaborate without any third-party trust. Each company runs its own on-premise instance; a self-hosted **federation hub** (itself a full Adyton instance) acts as an identity registry and cross-organisation coordination point.

**Key invariant:** vault data never leaves its home instance. The hub holds only identity metadata (UUID, public keys, instance URLs). Cross-instance sharing is purely a key-wrapping operation.

**Prerequisite:** V2 (EC key pairs, group vault model) must be deployed on all participating instances.

---

### Mental Model

```
hub.yourcompany.com  (Federation Hub — FEDERATION_HUB=true)
├── Identity registry: UUID → pubkey → instance_url
├── Instance registry: which Adyton instances are federated
├── Cross-org group metadata (not vault data)
└── Its own Organisation + vault (it is a full Adyton instance)

adyton.clientA.com   (spoke, normal Adyton + FEDERATION_SPOKE=hub_url)
adyton.clientB.com   (spoke, normal Adyton + FEDERATION_SPOKE=hub_url)
adyton.clientC.com   (spoke)
```

All vault data remains on the instance that created it. The hub is a lightweight service that never touches ciphertext.

---

### Universal User Code (UUC)

Every user gets a **Universal User Code** generated at registration:

```
urn:adyton:user:a1b2c3d4-7f8e-4a2b-9c1d-e5f6a7b8c9d0
```

Properties:
- UUID v4, generated server-side at registration
- Stable: does not change if the user's email or username changes
- Contains no PII
- Paired with the user's EC public key to form a portable **identity bundle**
- Unique within a deployment; globally unique with high probability (UUID v4 collision probability is negligible)

**Identity bundle** (shareable across instances):

```json
{
  "uuc": "urn:adyton:user:a1b2c3d4-...",
  "ec_public_key": "base64url-X25519-public-key",
  "instance_url": "https://adyton.clientA.com",
  "registered_at": "2026-06-26T00:00:00Z",
  "hub_signature": "base64url-ECDSA-sig-by-hub"
}
```

The hub signs the bundle to attest that it knows about this user. Instances verify the signature before trusting a cross-instance identity.

---

### Hub Architecture

The hub is a standard Adyton instance with `FEDERATION_HUB=true`. This flag activates the `FederationHubModule`, which adds hub-specific endpoints. All other Adyton functionality (personal vault, org, groups) is available on the hub itself.

**Hub-only endpoints:**

```
POST   /federation/instances/register     ← spoke registers with hub
DELETE /federation/instances/:id           ← revoke spoke (hub admin)
GET    /federation/instances              ← list registered spokes (hub admin)

GET    /federation/users/:uuc             ← resolve UUC → identity bundle
POST   /federation/users/register         ← spoke publishes a user identity

GET    /federation/groups                 ← list cross-org group definitions
POST   /federation/groups                 ← create cross-org group (admin)
PATCH  /federation/groups/:id/members     ← add/remove cross-org members
```

**Spoke-only endpoints (all instances with FEDERATION_SPOKE set):**

```
POST   /federation/inbound/wrapped-key    ← receive a wrapped group key from another instance
GET    /federation/outbound/status        ← check federation connectivity
```

---

### Instance Registration and Trust

Before any cross-instance operation, the spoke registers with the hub:

```
1. Spoke admin generates an instance keypair (EC, stored in env/secrets).
2. Spoke POSTs to hub /federation/instances/register:
   { instance_url, instance_public_key, org_name, admin_contact }
3. Hub admin approves the registration (manual step, backoffice UI on hub).
4. Hub issues an instance_token (opaque, long-lived, revocable).
5. Spoke stores instance_token. All future spoke→hub calls use it as Bearer.
```

Instance-to-instance calls (spoke A → spoke B) are authenticated via:
- Both spokes prove identity to the hub
- Hub acts as trust anchor: "I vouch for Instance A"
- Spoke B verifies the request is from a hub-registered instance via its signed assertion

No direct spoke-to-spoke TCP trust is required. Cross-instance key delivery is always mediated via the hub routing layer (the hub forwards, but does not decrypt).

---

### User Identity Publication

When a user registers on a spoke, the spoke publishes their identity to the hub:

```
1. User registers on adyton.clientA.com → gets UUC + ec_public_key.
2. Instance A POSTs /federation/users/register to hub:
   { uuc, ec_public_key, instance_url: "https://adyton.clientA.com" }
3. Hub stores the identity bundle and signs it.
4. Hub returns signed bundle to Instance A (stored for outbound sharing).
```

The hub never receives the user's encrypted private key — only the public key.

---

### Cross-Instance Group Sharing

#### Setup

An admin on Instance A wants to share a group with User B on Instance B.

```
1. Admin enters UUC of User B (or searches by UUC in the backoffice).
2. Instance A queries hub: GET /federation/users/urn:adyton:user:<uuid>
3. Hub returns signed identity bundle for User B (pubkey + instance_url).
4. Instance A verifies hub signature on the bundle.
5. Instance A performs ECDH group key wrapping (same as V2 local flow):
   - eph_priv, eph_pub = X25519.generateKeypair()
   - shared_secret = X25519(eph_priv, B.ec_public_key)
   - wrapping_key = HKDF(shared_secret, eph_pub, "adyton-group-key-wrap-v1")
   - wrapped = AES-256-GCM(group_key, wrapping_key)
6. Instance A POSTs wrapped key to Instance B via hub routing:
   POST /federation/inbound/wrapped-key  (on Instance B, proxied by hub)
   { uuc_of_B, group_id, wrapped_group_key, eph_pub, iv, auth_tag,
     group_metadata: { name, home_instance_url } }
7. Instance B stores the wrapped key for User B.
```

#### Access

User B on Instance B accesses the cross-instance group:

```
1. User B unlocks vault → personal_vault_key → ec_private_key.
2. Client sees a WrappedGroupKey with home_instance_url = "https://adyton.clientA.com".
3. Client unwraps group_key (ECDH, same as V2).
4. Client fetches group vault entries from Instance A:
   GET https://adyton.clientA.com/api/groups/:id/vault
   Authorization: Bearer <cross-instance assertion>
5. Instance A verifies the cross-instance assertion (signed by User B's ec_private_key,
   verified against the pubkey on record from the hub registry).
6. Instance A returns encrypted entries (ciphertext only — ZK preserved).
7. Client decrypts locally with group_key.
```

**Cross-instance assertion:** a short-lived JWT signed by the user's EC private key:

```json
{
  "sub": "urn:adyton:user:<uuid>",
  "aud": "https://adyton.clientA.com",
  "iat": 1234567890,
  "exp": 1234567950,    // 60-second window
  "group_id": "<uuid>"
}
```

Instance A verifies: signature valid + UUC in their group membership + assertion not expired. No hub contact required for access (hub was contacted once at group setup).

---

### Cross-Org Group Membership Lifecycle

| Event | Action |
|---|---|
| Add cross-instance member | Hub lookup → ECDH wrap → push to remote instance |
| Remove cross-instance member | Delete WrappedGroupKey on remote instance (via hub routing) + local GroupMembership row |
| Member leaves remote instance | Remote instance notifies hub → hub notifies home instance → membership cleanup |
| Spoke revoked by hub | All cross-instance memberships for that spoke's users are invalidated |
| Group key rotation | Same as V2 but re-wrap + re-push to all cross-instance members |

---

### Hub Data Model (new tables on hub)

```
FederatedInstance
├── id (UUID)
├── instance_url
├── instance_public_key  (EC, for verifying assertions)
├── org_name
├── status: 'pending' | 'active' | 'revoked'
├── instance_token_hash  (SHA-256 of the issued token)
└── registered_at

FederatedUser
├── uuc                  (primary key)
├── ec_public_key
├── instance_id → FederatedInstance
├── signed_bundle        (hub-signed identity bundle, cached)
└── published_at

CrossOrgGroup
├── id (UUID)
├── name
├── home_instance_id → FederatedInstance
├── home_group_id        (group UUID on home instance)
└── created_by_uuc
```

---

### Device Binding (companion to V2/V3)

Each device has its own EC keypair stored in the OS keychain:

```
device_id (UUID)
device_ec_private_key  → OS Keychain (iOS) / Android Keystore
device_ec_public_key   → stored on home instance
```

Uses:
- **Trusted device unlock:** vault key can be re-wrapped for a trusted device (similar to biometric in Phase 8, but key-based rather than biometric-gated). Unlocking on a trusted device does not require the Vault PIN if the device key is present.
- **Cross-instance assertion signing:** device key can sign cross-instance access assertions (alternative to the user's EC key, with device-level revocability).
- **Admin device revocation:** kicking a device invalidates its wrapped keys without affecting other devices.

Device binding is designed as a V2 extension but its full cross-instance utility is a V3 concern.

---

### Security Analysis

**What V3 preserves:**
- Vault data never leaves its home instance.
- Hub never sees vault ciphertext.
- Group key never transmitted in plaintext (ECDH wrapping as in V2).
- Cross-instance access requires both: a valid wrapped group key AND a valid cross-instance assertion signed by the user's private key.

**New attack surfaces:**
- **Hub as identity oracle:** if the hub is compromised, an attacker can publish fake identity bundles (pointing a UUC to an attacker-controlled public key). Mitigation: spoke admins verify UUC identity out-of-band before adding cross-instance members; the hub signature is only as trustworthy as the hub.
- **Cross-instance assertion replay:** assertions are time-limited (60 seconds) and audience-bound. Replay outside the window or to a different instance is rejected.
- **Hub availability:** if the hub is down, new cross-instance group memberships cannot be established (hub lookup fails). Existing memberships continue to work (cross-instance assertions are verified locally against cached pubkeys; hub is not in the hot path for vault access).
- **Spoke trust chain:** a compromised spoke can publish malicious identity bundles to the hub for its own users. Hub admin approval on registration is a manual gate; per-user identity bundles should be verified out-of-band for sensitive cross-org groups.

**What V3 explicitly does not provide:**
- Vault data replication across instances (entries live on the home instance only).
- Automatic key rotation on spoke revocation (requires admin action).
- Real-time membership sync (eventual consistency; cross-instance membership events may take seconds to propagate via hub routing).

---

### Deployment Model

```
# Hub (one server, your control)
FEDERATION_HUB=true
HUB_INSTANCE_KEY_PATH=/secrets/hub_ec.key

# Spoke (each customer's server)
FEDERATION_SPOKE=https://hub.yourcompany.com
FEDERATION_INSTANCE_TOKEN=<token-issued-by-hub>
FEDERATION_INSTANCE_KEY_PATH=/secrets/instance_ec.key
```

The hub requires no special hardware. It is a standard Adyton deployment on a VPS. The hub's PostgreSQL stores only identity metadata — it will remain small (< 1MB for 10,000 federated users).

---

### Effort Estimate

| Component | Complexity |
|---|---|
| UUC generation + storage (V2 prerequisite, trivial add) | XS |
| Hub mode (`FederationHubModule`) | M |
| Spoke mode (`FederationSpokeModule`) | M |
| Identity publication on registration | S |
| Hub routing layer (proxied push) | M |
| Cross-instance assertion (sign + verify) | M |
| Cross-instance group membership UI (backoffice) | M |
| Device binding (V2 extension) | S |
| Tests | M |
| **Total** | **L** |

V3 is independent from V2's internal complexity — it is a thin networking + key-routing layer on top of the V2 crypto model.
