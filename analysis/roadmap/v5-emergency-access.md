## V5 — Emergency Access (Trusted Contact)

*Decision: 2026-06-28. Added to roadmap based on design discussion. Positioned post-V4 (Federation).*

---

### Overview

Emergency Access lets a vault owner designate a trusted contact who can request access to their vault if the owner is incapacitated or permanently locked out. The server never sees vault key material — the mechanism is zero-knowledge by design.

**What V5 is NOT:** not account recovery (the server still cannot recover a lost master password), not admin access (V3 admin cannot read personal vaults), not a backup mechanism.

**Prerequisite:** V2 (EC keypairs per user, public key infrastructure) must be deployed. Emergency Access requires the trusted contact to have an EC public key on the same instance.

---

### Design Principles

1. **ZK preserved.** The server stores an encrypted emergency key (ciphertext only). The server can never decrypt it — only the designated contact can, using their private key.
2. **Owner has full control.** The owner can deny any pending request, revoke a contact at any time, and rotate their vault key to terminate an active grant.
3. **Snapshot, not live key.** The contact receives a copy of the vault as it existed at the time of grant. Owner survives by rotating vault key post-revocation — the contact's copy becomes stale.
4. **Contact must be an Adyton user on the same instance.** Emergency Access via external email (without an EC keypair in the system) would require a key escrow server-side, which breaks ZK invariant #1.
5. **Timeout is the primary defence.** The owner must have enough time to deny an illegitimate request. Default: 7 days. Configurable per-contact: 48h / 7d / 30d.

---

### Key Flow

#### Enrollment (owner enables emergency access for a contact)

```
Owner (browser)
  1. Search contact by display name / UUC
  2. Fetch contact's X25519 public key from server (same as V2 group-key flow)
  3. Generate emergency_key = raw bytes of personal_vault_key
  4. ECDH wrap:
       ephemeral_keypair = X25519.generate()
       shared_secret = X25519.sharedSecret(ephemeral_private, contact_public_key)
       encrypted_emergency_key = AES-256-GCM(
           key  = HKDF(shared_secret, info="adyton-emergency-v1:{ownerId}:{contactId}"),
           data = emergency_key,
           aad  = "{ownerId}:{contactId}:emergency"
       )
  5. POST /api/emergency-access {
         contactId,
         encryptedEmergencyKey,  // AES-GCM ciphertext
         ephemeralPublicKey,     // contact needs this to derive shared_secret
         timeout: 604800         // seconds (7 days)
     }
  Server stores: { ownerId, contactId, ciphertext, ephemeralPublicKey, timeout, status: 'accepted' }
```

#### Emergency request (contact initiates)

```
Contact → POST /api/emergency-access/{id}/request
Server  → sets status='pending', records requestedAt
Server  → sends notification to owner (email + push)
          "Your emergency contact {name} has requested access to your vault.
           You have 7 days to deny this request."

Owner window:
  - DELETE /api/emergency-access/{id}/request  → status='accepted', no action taken
  - If no action in timeout → server sets status='approved'

Contact polls or receives push → status='approved'
Contact → GET /api/emergency-access/{id}/key   → { encryptedEmergencyKey, ephemeralPublicKey }
Contact decrypts:
  shared_secret = X25519.sharedSecret(contact_private_key, ephemeralPublicKey)
  emergency_key = AES-256-GCM.decrypt(
      key  = HKDF(shared_secret, info="adyton-emergency-v1:{ownerId}:{contactId}"),
      data = encryptedEmergencyKey,
      aad  = "{ownerId}:{contactId}:emergency"
  )
Contact can now decrypt owner's vault entries using emergency_key as the vault key.
```

#### Revocation (owner terminates access)

```
Owner → DELETE /api/emergency-access/{id}
Server → deletes record (encryptedEmergencyKey gone from DB)
Owner  → rotates vault key (Settings → Vault → Rotate key)
         All vault entries re-encrypted under new key.
         Contact's copy (snapshot at time of grant) becomes permanently stale.
```

---

### Security Analysis

#### Is access permanent?

No. The design is **snapshot-based**:

- Contact decrypts the vault as it existed at grant time.
- Owner can revoke by deleting the emergency record AND rotating the vault key.
- After rotation: the contact holds decrypted copies from their session, but cannot decrypt any new or updated entries.
- Practical impact: a vault with few changes post-grant leaks old secrets. Owner should change all credentials after confirming the emergency situation is resolved.

#### Attack vectors

| Attack | What happens | Mitigation |
|--------|-------------|------------|
| Contact makes fraudulent request (owner on vacation, unreachable) | Request times out → access granted | Long timeout (7d default). Notifications multi-channel (email + push). Owner should configure trusted contacts carefully. |
| Owner email compromised → attacker blocks denial notification | Owner never sees the request, timeout fires | Push notification independent of email. Consider requiring explicit approval (not just silence) — but this breaks the incapacitation use case. |
| Contact's Adyton account compromised (password only, no vault key) | Attacker triggers request → encrypted key blob delivered → useless without contact's X25519 private key | ZK holds. Attacker needs contact's master password + biometric/device to derive contact's private key. |
| Contact's vault fully compromised (master password + device) | Attacker has contact's private key → can decrypt emergency key blob after timeout | 2FA mandatory on contact account. Require re-authentication on emergency request submission. |
| Physical coercion of contact | Contact hands over their private key | M-of-N contacts (2-of-3): requires multiple contacts to independently approve. Post-V5 hardening. |
| Server compromise: attacker initiates emergency flow | Attacker creates a fake emergency request server-side | Timeout still applies. Owner gets notified. Blob is still ciphertext — attacker needs contact's private key. |
| MITM on encryptedEmergencyKey in transit | Attacker captures ciphertext | Useless without contact's private key. TLS + ZK model together. |

#### What the server knows

- That contact C is a trusted emergency contact for owner O
- The timeout configured
- The encrypted emergency key blob (opaque ciphertext)
- The ephemeral public key used in the ECDH exchange
- Whether a request is pending/approved/denied

**The server can never recover**: the emergency key, the vault key, or any plaintext vault content. This matches V1 ZK invariants.

#### Trade-off: feature vs security

**What you gain:**
- Recovery path for incapacitation or death
- Protects against the "single point of failure" problem (one person, one device, one password — all lost)

**What you pay:**

1. **Second trust anchor.** Each designated contact is an additional attack vector. A personal vault with one emergency contact doubles the attack surface from the social engineering perspective.

2. **Contact's security posture matters.** If the contact reuses passwords, has no 2FA, and their device is unencrypted, your vault inherits their weakest link.

3. **ZK requires contact to be an Adyton user.** Cannot designate an external email address without breaking ZK (that path requires key escrow). This limits the feature to users with Adyton accounts on the same instance.

4. **Vault key rotation on revoke is mandatory, not optional.** If the owner skips rotation after revoking a contact, the contact retains a decryptable snapshot indefinitely. Users must understand this.

5. **Timeout is a zero-sum trade-off.** Short timeout (24h) → contact gets in if owner is unreachable for one day. Long timeout (30d) → useless if owner needs urgent hospital access immediately. 7 days is the pragmatic middle; configurable per-contact lets owners decide.

---

### Why Post-V4

1. **Requires V2 EC keypairs.** The X25519 ECDH wrapping reuses the same infrastructure as group key distribution (V2). Without V2, we'd need a separate key exchange mechanism.

2. **Low priority for single-user personal vault.** The use case is real but rare (once per lifetime). V1/V2/V3/V4 deliver compounding value for daily use. Emergency Access is correctness-under-edge-case.

3. **Multi-contact (M-of-N) variant is V5+.** The V5.0 design uses single contact. M-of-N Shamir splitting can be added as a V5.1 hardening pass without breaking the V5.0 enrollment flow.

---

### Implementation Steps

| Step | Content | Complexity |
|------|---------|------------|
| 0 | `EmergencyAccess` entity + migration | XS |
| 1 | Enrollment API (`POST /emergency-access`, `DELETE /emergency-access/{id}`) | S |
| 2 | Request flow + timeout job (BullMQ) + notifications | M |
| 3 | Key delivery endpoint + vault-key rotation endpoint | S |
| 4 | Frontend: contact picker, pending request banner, revoke flow | M |
| 5 | Tests + hardening | M |
| **Total** | | **M** |

**Dependency:** BullMQ (already planned for V2 key rotation queue) handles the timeout-to-approval job.

---

### Entities

```typescript
// EmergencyAccess
{
  id: UUID
  owner: User                  // whose vault
  contact: User                // trusted person
  encryptedEmergencyKey: string  // AES-256-GCM ciphertext (base64)
  ephemeralPublicKey: string     // owner's ephemeral X25519 public key (base64)
  timeout: number              // seconds until auto-approval after request
  status: 'accepted' | 'pending' | 'approved' | 'denied'
  requestedAt: Date | null
  approvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
```

AAD contract: `"{ownerId}:{contactId}:emergency"` — immutable after enrollment; changing it requires re-enrollment.

---

### Open Questions (for when V5 implementation begins)

1. **Explicit approval vs silence-as-approval.** Current design: no response = approved after timeout. Alternative: require explicit "I approve this emergency" action from owner after the timeout passes. Breaks the incapacitation use case but removes the coercion window. Decision deferred.
2. **Multiple contacts.** V5.0 allows N independent contacts (each enrolled separately). M-of-N threshold (require K contacts to independently approve) is V5.1.
3. **Contact on a different instance.** Requires V4 federation + cross-instance EC public key lookup. Out of scope V5.0.
4. **Notification channel for owner.** Email alone is insufficient if email is compromised. Push notification via the mobile app is the correct second channel. Must land before V5.
5. **Vault rotation UX.** After revoking a contact, a prominent "Rotate your vault key now" warning must appear. Rotation is non-trivial for large vaults — progress indicator needed.
