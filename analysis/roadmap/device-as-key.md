## 16. Phone-as-Key Architecture — Mobile Device as Hardware Security Module *(Future Roadmap — not in current implementation scope)*

### 16.1 The Concept

Instead of running the full vault UI on mobile, the phone acts exclusively as a **cryptographic key device** — an HSM (Hardware Security Module) that the user carries physically. The desktop browser is the only vault management interface. The phone is never a vault client; it is the key that enables the desktop to decrypt.

This inverts the typical password manager mental model:

```
Standard model:
  Desktop = vault UI + key (key derived on desktop from typed master password)
  Phone   = optional second client

Phone-as-Key model:
  Desktop = vault UI only (never holds the master password)
  Phone   = key holder (Secure Enclave stores master password or derived key)
             → physical presence of phone required to open vault
```

The security improvement is significant: a compromised desktop can access encrypted vault blobs and nothing else. The master password (or derived key) never exists on the desktop. An attacker who owns the desktop cannot open the vault without also physically possessing the unlocked phone.

### 16.2 Two Sub-models

#### Sub-model A: Phone as WebAuthn Roaming Authenticator (CTAP2 Hybrid)

The phone replaces the WebAuthn platform authenticator for **Phase 1** (authentication/login). The master password for **Phase 2** (vault unlock) is still typed by the user on the desktop. The phone proves physical presence; the master password provides the key material.

```
Desktop (Chrome)              Phone (Safari / Capacitor)
─────────────────────         ──────────────────────────
1. Open vault page
2. Enter email
3. Show QR code ──────────────→ Camera app scans QR
                               4. "Allow adyton.home to sign in?"
                               5. User authenticates: Face ID ✅
                               6. CTAP2 assertion via Bluetooth ←──
7. Server validates assertion
8. JWT issued
9. Vault unlock screen
10. User types master password → Argon2id → CryptoKey
11. Vault open
```

**What the phone does:** Proves physical presence and biometric identity via CTAP2 hardware attestation. The Secure Enclave holds the WebAuthn private key. Even if the desktop session is hijacked remotely, the attacker cannot complete Step 5 without the physical phone.

**Third parties required:** Zero, if using a device-bound (non-synced) passkey. A device-bound passkey is a credential stored only in the phone's Secure Enclave and not synced to iCloud or Google. It is enrolled once per physical device. This is set via the `residentKey: 'required'` + `authenticatorAttachment: 'cross-platform'` options during WebAuthn registration — the phone acts as a FIDO2 cross-platform authenticator.

**Limitation:** The master password is still typed on the desktop keyboard — vulnerable to keyloggers on the desktop. Sub-model A raises the authentication bar but does not eliminate the desktop keylogger threat.

**iOS compatibility:** Sub-model A does not encounter iOS PWA limitations (ITP, no Web Bluetooth in Safari). The phone does not run a webapp during CTAP2 hybrid authentication — it uses the native iOS passkey UI triggered by the camera app and backed by Secure Enclave. Safari and ITP are not involved. Works on iOS 16+ with zero custom app required.

#### Sub-model B: Phone as Key Distributor (Master Password Never on Desktop)

The master password is generated randomly at registration and stored **only in the phone's iOS Keychain / Android Keystore**, protected by biometric. The user never types it anywhere. The desktop never knows it.

```
Desktop (browser)                  Phone (Capacitor app — key-only)
─────────────────────              ──────────────────────────────────
1. Open vault page
2. Enter email → server validates
   → JWT issued (standard auth)
3. Display unlock challenge:
   { sessionId, nonce }  ─────────→ Push notification: "Vault unlock
                                     requested from Chrome/macOS"
                                  4. User approves: Face ID ✅
                                  5. Phone retrieves master password
                                     from iOS Keychain
                                  6. Derives key:
                                     Argon2id(masterPassword, kdfSalt)
                                  7. Encrypts CryptoKey bytes:
                                     ECDH ephemeral key exchange
                                     with desktop's public key
                                  8. Sends encrypted key to VPS relay
                                     ← encrypted key material ──
9. Desktop decrypts key material
   using its ephemeral private key
10. importKey() → CryptoKey in Pinia
11. Vault open
    Desktop never sees master password
    Key in memory only for session
```

The key exchange in Step 7-9 uses ECDH with ephemeral keys:
- Desktop generates ephemeral ECDH keypair at Step 3, sends public key in challenge
- Phone generates ephemeral ECDH keypair, performs key agreement with desktop's public key → shared secret
- Phone encrypts the raw AES key bytes with `AES-GCM(sharedSecret, rawKeyBytes)`
- Desktop performs the same ECDH agreement → derives same shared secret → decrypts raw key bytes
- Neither the VPS relay nor any interceptor can decrypt the payload (it is E2E encrypted phone→desktop)

**Third parties required:** The relay channel is the self-hosted VPS API — zero third parties. Push notification for the approval prompt requires either FCM/APNs (third party) or a self-hosted push service (ntfy.sh, Gotify). For a personal VPS, ntfy.sh self-hosted is a viable zero-third-party push solution.

### 16.3 What the Phone App Becomes

In the phone-as-key model, the phone does NOT need a vault management UI. It needs only:

```
apps/key-device/   (Capacitor, minimal)
├── Registration screen:
│   "Scan QR to register this device as a vault key"
│   → enroll WebAuthn credential
│   → generate master password (random, 32 bytes)
│   → store in iOS Keychain / Android Keystore
│   → send password hash to server for registration
│
├── Approval screen:
│   "Chrome on MacBook Pro is requesting vault access"
│   [Approve with Face ID]  [Deny]
│
└── Settings:
    "Registered devices" — list, revoke
    "Export recovery backup" — encrypted recovery phrase
    "Revoke this device"
```

No vault list. No entry management. No password generator. The entire UI is < 5 screens. This is a fundamentally simpler mobile app than the full Capacitor vault client.

### 16.4 Relay Channel Security (Sub-model B)

The VPS relay handles the key distribution channel:

```
POST /auth/unlock/challenge
  → server stores { sessionId, desktopPublicKey, nonce, expiresAt: now+2min }
  → sends push to registered phone via ntfy.sh

POST /auth/unlock/approve    (called by phone, authenticated by phone JWT)
  body: { sessionId, encryptedKeyPayload }
  → server stores payload for 30 seconds, waits for desktop to poll

GET /auth/unlock/poll/:sessionId  (polled by desktop)
  → returns encryptedKeyPayload once available, then deletes it

DELETE /auth/unlock/challenge/:sessionId  (called by phone to deny)
```

The VPS relay stores the encrypted key payload for at most 30 seconds. The payload is E2E encrypted (ECDH) — the server cannot decrypt it. After delivery or expiry, the payload is deleted. No key material persists server-side beyond the session window.

Security properties:
- **Forward secrecy**: new ephemeral ECDH keypair per unlock request — compromising one session does not compromise past or future sessions
- **Replay protection**: `nonce` per challenge, single-use, 2-minute TTL
- **Server compromise**: encrypted payload is opaque to the VPS
- **Phone theft**: attacker needs Face ID / device PIN to approve
- **Desktop compromise**: attacker receives the CryptoKey in memory for the active session — same risk as today, but master password is never exposed to keyloggers

### 16.5 Recovery — the Critical Problem

Sub-model B introduces a hard dependency: **if the phone is lost or broken, the vault is permanently inaccessible.** The master password exists only in the phone's Keychain. This is the same threat model as a hardware HSM — losing the device means losing the key.

Recovery options:

**Option 1 — Encrypted recovery phrase (recommended)**

At registration, the master password is split into a recovery phrase (BIP39, 24 words), printed or written down by the user, and stored physically offline. The recovery phrase is never digital after generation.

```typescript
// At registration (phone):
const masterPassword = crypto.getRandomValues(new Uint8Array(32));
const recoveryPhrase = toMnemonic(masterPassword); // BIP39 24 words
// Display once, require user confirmation
// Store masterPassword in iOS Keychain
// Do NOT store recoveryPhrase digitally — user must write it on paper
```

**Option 2 — Multiple registered key devices**

Register a second phone or tablet as an additional key device. Both devices hold the same master password (transferred via a one-time QR code during setup, shown only once). If one device is lost, the other can still unlock.

**Option 3 — Fallback to typed master password**

The server stores a flag `hasFallbackPassword: boolean`. If the user registered with Sub-model B but needs emergency access (phone lost), the server allows a timed fallback to typed master password mode — subject to stricter rate limiting (1 attempt/hour) and mandatory email confirmation.

### 16.6 Architecture Comparison

| Property | Standard (master password typed on desktop) | Sub-model A (phone = WebAuthn roaming auth) | Sub-model B (phone = key distributor) |
|----------|------|------|------|
| Keylogger on desktop steals master password | ✅ vulnerable | ✅ vulnerable | ✅ **immune** — master password never typed on desktop |
| Desktop compromise opens vault | ✅ if session active | ✅ if session active | ✅ if session active (key in memory during session) |
| Remote attacker (no phone) opens vault | ❌ needs master password | ❌ needs physical phone + biometric | ❌ needs physical phone + biometric |
| Lost phone = lost vault | No | No (phone is just 2FA) | **Yes** — must use recovery phrase |
| No third-party services | ✅ | ✅ device-bound passkey | ✅ with self-hosted ntfy |
| UX friction per unlock | Low (type password) | Medium (QR scan + biometric) | Medium (push approval + biometric) |
| Mobile app complexity | Full vault UI | Minimal (just a passkey) | Minimal (approval screen only) |
| Desktop-only UX possible | ✅ | ✅ | ✅ |

### 16.7 Two Distinct Usage Profiles

Phone-as-key and mobile vault are fundamentally different use cases and should not be conflated:

| Profile | Architecture | Mobile app needed | iOS problem? |
|---------|-------------|-------------------|--------------|
| **Desktop-only vault + phone as key** | Sub-model A or B | Sub-model A: No (native OS). Sub-model B: Yes (Capacitor key-only app, ~3 screens). | No — CTAP2 uses native iOS UI, not webapp |
| **Vault accessible on mobile too** | Web (Nuxt 4) + Capacitor | Yes — full Capacitor vault app | Solved by Capacitor (iOS Keychain, no ITP) |

These are not mutually exclusive long-term, but they require different implementation priorities.

### 16.8 Decision: Deferred to Future Roadmap

**Phone-as-key is not part of the current implementation scope.**

Reasons for deferral:
- Sub-model A (CTAP2 hybrid) is already covered by Phase 6 WebAuthn — the phone acts as a roaming authenticator natively once WebAuthn is shipped; no extra work needed
- Sub-model B requires a dedicated Capacitor app + VPS relay API surface + push notification infrastructure — significant added scope for a feature that benefits only the desktop-only usage profile
- The immediate priority is a web + mobile vault app that works everywhere, not a desktop-only architecture

**Current architecture decision:**
- `apps/web` (Nuxt 4) — primary vault UI, runs in browser on all platforms
- `apps/mobile` (Capacitor) — first-class iOS and Android deliverable, wraps same Nuxt 4 build, uses iOS Keychain / Android Keystore to avoid ITP
- Both are in-scope from Phase 1 (monorepo structure) with Capacitor build delivered in Phase 9

**Future roadmap (post Phase 9):**
- Sub-model A enhancement: enforce `authenticatorAttachment: 'cross-platform'` + device-bound passkeys for users who want phone-only auth
- Sub-model B: self-hosted relay, minimal phone key-device app — implement only if there is a concrete need for the desktop-only usage profile

See **Section 16.9** for full Device-as-Key roadmap, risk register, and feasibility analysis.

---

### 16.9 Device-as-Key — Full Roadmap, Risks, Opportunities

This section treats "device as key" as a general capability — not limited to phone. Any hardware that can generate or store non-extractable cryptographic material qualifies: phone Secure Enclave, hardware token (YubiKey), desktop TPM, passkey platform authenticator.

---

#### 16.9.1 Four Cryptographic Integration Models

**Model 1 — Device as authenticator only (already planned: Phase 6 WebAuthn)**

The device proves user identity but does NOT contribute to vault key derivation. The vault key remains derived exclusively from the master password.

```
master_password → Argon2id → vault_key
device          → WebAuthn  → access_token only
```

Security ceiling: if master password is compromised (phishing, keylogger), vault is fully exposed regardless of device. Device protects the session, not the vault.

This is the baseline already in scope. Everything below is additive.

---

**Model 2 — WebAuthn PRF: browser-level hardware-bound key component**

WebAuthn CTAP2.1 PRF extension: during passkey assertion, the platform authenticator (Face ID, Windows Hello, Touch ID) computes an HMAC over a caller-provided salt. Output: 32 bytes, hardware-bound, reproducible only on that specific device by that specific user.

```
PRF_output = authenticator.HMAC(secret=device_bound_key, message=PRF_salt)
vault_key_component = HKDF(PRF_output, info="adyton-vault-key")

# Option A: vault_key = PRF-derived only (master password not required after enrollment)
encrypted_vault_key = AES-GCM(vault_key_component, raw_vault_key)

# Option B: vault_key requires both (recommended — defense in depth)
vault_key_component = HKDF(
  ikm = concat(argon2id(master_password), PRF_output),
  info = "adyton-vault-key-v2"
)
```

Option B is recommended: stolen master password alone is useless, stolen device alone is useless. Both are required.

**Server-side storage per device:**
```typescript
// DeviceVaultKey entity
@Entity({ tableName: 'device_vault_keys' })
export class DeviceVaultKey {
  @PrimaryKey({ type: 'uuid' })
  id: string = uuidv4();

  @ManyToOne(() => User)
  user: User;

  @Property({ length: 64 })
  credentialId: string; // WebAuthn credential ID (base64url)

  @Property({ type: 'text' })
  wrappedVaultKey: string; // base64 — AES-GCM(PRF_output, vault_key)

  @Property({ length: 24 })
  wrapIv: string; // base64 — 96-bit IV

  @Property({ length: 32, nullable: true })
  prf_salt: string; // base64 — 16 bytes, stored per credential

  @Property()
  enrolledAt: Date = new Date();

  @Property({ nullable: true })
  lastUsedAt: Date | null = null;

  @Property({ length: 256, nullable: true })
  deviceName: string | null = null; // user-assigned
}
```

**Enrollment flow:**
1. User has active session (master password already derived vault_key in memory)
2. Client initiates WebAuthn registration with PRF extension
3. On assertion: receive `PRF_output` (32 bytes)
4. `wrapped_vault_key = AES-GCM(PRF_output, vault_key)`
5. POST `/auth/devices/prf` → store `DeviceVaultKey`

**Login with PRF (biometric, no master password typing):**
1. GET `/auth/challenge` → WebAuthn challenge + allowed credentials
2. Perform assertion → receive `PRF_output`
3. GET `/auth/devices/prf/{credentialId}` → receive `wrapped_vault_key`
4. `vault_key = AES-GCM-decrypt(PRF_output, wrapped_vault_key)` — purely client-side
5. Store in `useCryptoStore` as before

**Platform coverage:**

| Client | PRF support | Notes |
|--------|-------------|-------|
| Chrome 116+ desktop | ✅ | Windows Hello, Touch ID (Mac), PIN |
| Edge | ✅ | Windows Hello |
| Chrome Android | ✅ | Fingerprint, Face unlock |
| Safari iOS | ❌ | No PRF support as of WebKit 2026 |
| Firefox | ❌ | No PRF support as of FF 2026 |
| Capacitor (iOS) | ❌ (WebView) | Use Model 3 instead |
| Capacitor (Android) | ✅ (Chrome WebView) | Works via system WebView |
| MV3 Extension | ✅ (Chrome only) | Service worker can trigger PRF |

Safari iOS is the significant gap. ~30% of mobile users on Safari iOS fall back to master-password-only until Model 3 (Capacitor native) is implemented.

---

**Model 3 — Native Secure Enclave key wrapping (Capacitor + Tauri)**

True hardware binding: the wrapping key lives inside the Secure Enclave (iOS/macOS) or Android Keystore, and never leaves it. All cryptographic operations happen inside the hardware boundary.

```
# iOS / macOS (CryptoKit)
let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(
  accessControl: SecAccessControlCreateWithFlags(
    nil,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    [.userPresence, .biometryCurrentSet],
    nil
  )!
)
let publicKey = privateKey.publicKey

# Wrapping vault_key:
let ephemeral = P256.KeyAgreement.PrivateKey()
let sharedSecret = try privateKey.sharedSecretFromKeyAgreement(with: ephemeral.publicKey)
let wrapping_key = sharedSecret.hkdfDerivedSymmetricKey(
  using: SHA256.self,
  salt: "adyton-v3-wrap".data(using: .utf8)!,
  sharedInfo: Data(),
  outputByteCount: 32
)
let wrapped_vault_key = try AES.GCM.seal(vault_key_bytes, using: wrapping_key)
```

```kotlin
// Android Keystore
val keyPairGenerator = KeyPairGenerator.getInstance(
  KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore"
)
keyPairGenerator.initialize(
  KeyGenParameterSpec.Builder("adyton-wrap-key",
    KeyProperties.PURPOSE_AGREE_KEY
  )
  .setUserAuthenticationRequired(true)
  .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
  .build()
)
```

```rust
// Tauri — Windows DPAPI (machine + user bound, no biometric required by default)
use windows_dpapi::protect_data;
let wrapped = protect_data(&vault_key_bytes, Some(b"adyton"))?;

// Tauri — Windows Hello (requires user interaction, biometric or PIN)
// Uses Windows Web Authentication API via WinRT
```

Key property: `.biometryCurrentSet` on iOS means the key is invalidated if Face ID/fingerprint changes (e.g., new fingerprint enrolled). Forces re-enrollment — security feature, not bug.

**Implementation requires Capacitor plugin:**
```typescript
// capacitor-adyton-keystore (custom plugin, ~300 lines Kotlin + Swift)
export interface AdytonKeystorePlugin {
  generateKey(options: { keyAlias: string }): Promise<{ publicKey: string }>;
  wrapKey(options: { keyAlias: string; plaintext: string }): Promise<{ wrapped: string; iv: string }>;
  unwrapKey(options: { keyAlias: string; wrapped: string; iv: string }): Promise<{ plaintext: string }>;
  deleteKey(options: { keyAlias: string }): Promise<void>;
}
```

This plugin is ~300 lines of native code split equally between Swift and Kotlin. The Nuxt/Vue frontend calls it identically on both platforms via `@capacitor/core`.

---

**Model 4 — Shamir Secret Sharing: distributed key shards**

Split `vault_key` into N shards using Shamir's Secret Sharing (any M of N reconstruct). Designed for enterprise or high-availability scenarios.

```
vault_key → SSS(k=2, n=3) → [shard_A, shard_B, shard_C]

shard_A: device (wrapped in Secure Enclave)
shard_B: encrypted on server (rate-limited release, email confirmation required)
shard_C: recovery kit (BIP39 mnemonic)

Reconstruction: any 2 of 3
```

Server-side shard release rules:
- Max 3 release attempts per 24h per user
- Email confirmation required
- Audit log entry mandatory
- Server alone holds only 1 shard — cannot reconstruct `vault_key` unilaterally

Implementation: `secrets.js` library (well-audited SSS in JS), ~500 lines additional logic.

This model is enterprise-grade but significantly increases implementation complexity and UX surface area. Not recommended before V4.

---

#### 16.9.2 Recovery Architecture

**The fundamental tension:** true hardware binding = device loss = permanent lockout. Every recovery mechanism reduces binding strength by design. The goal is not eliminating recovery options but making the weakest recovery path still strong enough.

**Recovery Tier 1 — Recovery Kit (recommended default)**

During device-key enrollment, mandatory step before activation:

```
1. Server: generate random recovery_salt (32 bytes), store per user
2. Client: user enters or system generates 24-word BIP39 mnemonic
3. recovery_seed = BIP39.mnemonicToSeed(mnemonic)
4. recovery_key = HKDF(recovery_seed, salt=recovery_salt, info="adyton-recovery-v1", length=32)
5. recovery_wrapped_vault_key = AES-GCM(recovery_key, vault_key)
6. POST /auth/recovery/setup → store { recovery_wrapped_vault_key, recovery_salt }
7. Display mnemonic to user → user confirms "I have written this down" checkbox
8. Mnemonic NOT stored anywhere — only user copy
```

Recovery flow:
```
1. GET /auth/recovery/challenge → receive recovery_salt
2. User enters 24-word mnemonic
3. recovery_key = HKDF(BIP39.toSeed(mnemonic), recovery_salt)
4. GET /auth/recovery/vault-key → receive recovery_wrapped_vault_key
5. vault_key = AES-GCM-decrypt(recovery_key, recovery_wrapped_vault_key)
6. vault_key in memory → re-enroll new device immediately
```

Server never sees `recovery_key`. If server is compromised, `recovery_wrapped_vault_key` is useless without the mnemonic.

**Recovery Tier 2 — Backup Device Registration**

Multiple devices can each independently hold `wrapped_vault_key`. Losing one device: unlock with any other registered device. Last device: recovery kit is the only path.

- UI: Settings → Devices → "This device" + list of other registered devices
- Each device: name (user-assigned), last seen date, revoke button
- Forced re-enrollment if all devices revoked (recovery kit required)

**Recovery Tier 3 — Emergency Master Password Fallback (already in 16.5)**

Time-limited, rate-limited, email-confirmed. Only activates if both device and recovery kit are unavailable. Logs as `EMERGENCY_FALLBACK` in AuditLog.

---

#### 16.9.3 Platform Capability Matrix

| Platform | Model 1 (WebAuthn 2FA) | Model 2 (PRF) | Model 3 (Native SE) | Model 4 (Shamir) |
|----------|------------------------|----------------|----------------------|-------------------|
| Chrome desktop | ✅ V1/Phase6 | ✅ V2 | ✅ V4 (Tauri) | ✅ V5 |
| Edge | ✅ | ✅ V2 | ✅ V4 (Tauri) | ✅ V5 |
| Safari desktop | ✅ | ⚠️ macOS 15+ only | ✅ V4 (Tauri) | ✅ V5 |
| Firefox | ✅ | ❌ | ✅ V4 (Tauri) | ✅ V5 |
| Chrome Android | ✅ | ✅ V2 | ✅ V3 (Capacitor) | ✅ V5 |
| Safari iOS | ✅ | ❌ | ✅ V3 (Capacitor) | ✅ V5 |
| Capacitor iOS | ✅ | ❌ (WebView gap) | ✅ V3 | ✅ V5 |
| Capacitor Android | ✅ | ✅ | ✅ V3 | ✅ V5 |
| Tauri (all desktop) | ✅ | ✅ | ✅ V4 | ✅ V5 |
| MV3 Extension | ✅ | ✅ Chrome only | ❌ | ❌ |

---

#### 16.9.4 Implementation Roadmap V1→V5

**V1 — Current scope (Phase 1–8)**

- Master password → Argon2id → vault_key (memory only)
- WebAuthn Phase 6: device as 2FA only (Model 1)
- No hardware binding of vault key
- Full recovery: just remember master password
- Works on every browser, every platform, zero hardware requirements

**V2 — WebAuthn PRF biometric unlock (post Phase 6, ~2–3 months after launch)**

Prerequisites: Chrome 116+ (desktop and Android). Safari and Firefox users continue with master password.

New entities:
- `DeviceVaultKey` (see 16.9.1 above)
- `RecoveryKit` (`id`, `user`, `recovery_salt`, `recovery_wrapped_vault_key`, `confirmedAt`, `revokedAt`)

New endpoints:
```
POST   /auth/devices/prf/enroll   # store wrapped_vault_key after PRF assertion
GET    /auth/devices/prf           # list enrolled PRF devices
DELETE /auth/devices/prf/:id       # revoke device
POST   /auth/recovery/setup        # store recovery_wrapped_vault_key
POST   /auth/recovery/unlock       # emergency: verify recovery → return recovery_wrapped_vault_key
```

New UI flows (Settings → Security):
- "Set up biometric unlock" → WebAuthn PRF enrollment wizard
- "Recovery kit" → BIP39 mnemonic display + confirmation
- "Registered devices" → list + revoke

UX change: login page shows "Use biometric" button if credentials registered for device. Master password flow remains as fallback.

Effort estimate: ~3 weeks backend + ~2 weeks frontend.

**V3 — Native Secure Enclave (Capacitor, post Phase 9)**

Prerequisite: Capacitor app built and in app stores.

Deliverables:
- `capacitor-adyton-keystore` plugin (~300 lines Swift + Kotlin)
- iOS: Secure Enclave P-256 key agreement, `.biometryCurrentSet` access control
- Android: Android Keystore ECDH, biometric authentication required
- Nuxt composable `useHardwareKey()` — unified interface, platform-agnostic
- Graceful fallback to Model 2 (PRF) if native key unavailable

iOS users gain full hardware binding. Safari gap closed.

Effort estimate: ~3 weeks native plugin + ~1 week integration.

**V4 — Desktop hardware binding (Tauri, post V3)**

- Windows: Windows Hello or DPAPI (machine-bound, no biometric required — simpler)
- macOS: Secure Enclave via CryptoKit (same API as iOS)
- Linux: libsecret (keyring) + TPM via tpm2-tools if available
- Same `useHardwareKey()` composable, Tauri IPC bridge

All major platforms now have Model 3 hardware binding. Model 2 PRF remains available as browser fallback.

Effort estimate: ~2 weeks Rust + integration.

**V5 — Shamir key sharding (enterprise)**

Implement only when enterprise/team features are a concrete requirement (see Section 10 roadmap). Requires:
- `secrets.js` (SSS library, well-audited)
- Server-side shard storage with rate-limited release API
- Admin policy: enforce M-of-N for all users in organization
- Recovery kit for third shard
- Audit trail for every shard release request

Effort estimate: ~4 weeks including UX for shard management.

---

#### 16.9.5 Risk Register

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Device lost before recovery kit setup | Critical | High | Recovery kit enrollment mandatory before PRF activation; block enrollment if kit not confirmed |
| User loses recovery kit mnemonic | Critical | Medium | UI reminders; offer to re-generate (invalidates old) before old recovery flow is tested |
| Safari iOS not gaining PRF support | Medium | Medium (likely delayed) | V3 Capacitor closes this gap; no action needed until V3 ships |
| `.biometryCurrentSet` invalidates key on fingerprint change | Medium | Low-Medium | Show clear error "Biometric changed, re-enroll device"; recovery kit flow triggers automatically |
| Server breach exposes `wrapped_vault_key` rows | Low | Low | Useless without PRF output from hardware; AES-256 protected |
| Browser update removes/changes PRF API | Low | Very low | CTAP2.1 is FIDO Alliance standard; Chrome/Edge have committed |
| Phishing site gets PRF output | Very low | Very low | PRF output is bound to `rpId` (domain); phishing domain returns different HMAC output |
| Capacitor WebView on Android lacks PRF | Low | Low | Android system WebView is Chromium; PRF available on modern Android |
| Backup paradox: recovery reduces binding value | Always true | Always | Accepted. Defense in depth: device binding + recovery kit still stronger than master password alone |
| User registers only one device, device breaks | High | Medium | UI warning: "You have only 1 registered device. Add a backup device or verify your recovery kit." |

---

#### 16.9.6 Opportunities

**Security:**
- Stolen master password alone is insufficient (Model 2/3). Phishing, credential stuffing, dark web leaks become largely irrelevant.
- Hardware key never exposed even to memory forensics (Model 3 — Secure Enclave operations only).
- Ties vault security to physical device possession — a fundamentally stronger threat model.

**UX:**
- No master password typing after enrollment. Face ID / fingerprint = vault open.
- "I forgot my master password" becomes solvable via device + recovery kit instead of data loss.
- Biometric unlock significantly reduces friction for frequent access (extension autofill).

**Enterprise value:**
- Hardware binding satisfies MFA requirements for SOC 2 Type II, ISO 27001, NIST 800-63B (AAL2/AAL3).
- Admin-enforced policy: require hardware key enrollment within N days of account creation.
- Device revocation on offboarding: instant, cryptographically guaranteed.
- Shamir (V5): eliminates "one employee holds all the keys" single point of failure.

**Competitive differentiation:**
- Most self-hosted password managers (Vaultwarden, etc.) offer WebAuthn 2FA but not PRF vault-key binding. This is a genuine differentiator.
- Combining zero-knowledge architecture + hardware-bound vault key + group key rotation = enterprise-grade security posture with personal self-hosted simplicity.

**Recovery model improvement:**
- BIP39 recovery kit is a familiar pattern (crypto wallets). Users understand it. 24 words on a piece of paper in a fireproof envelope is a solved UX.
- Multiple registered devices = practical everyday recovery without exposing the kit.

---

#### 16.9.7 Implementation Priority Recommendation

```
V1 → V2 → V3 → V4 → V5

Priority order:
1. V2 (PRF) — highest ROI: no new app, covers Chrome/Edge/Android (~65% of users),
   enables biometric unlock which is the #1 UX friction point.
   Implement ~2-3 months after V1 launch.

2. V3 (Capacitor SE) — closes Safari iOS gap, mandatory before marketing
   the product to iOS-primary users. Implement alongside Phase 9.

3. V4 (Tauri) — desktop power users. Implement after V3 stabilizes.

4. V5 (Shamir) — only if enterprise team features are a concrete roadmap item.
   No point building shard infrastructure for a single-user personal vault.
```

---

### 16.10 Device-as-Key via QR + ECDH Relay (SPID/Duo Pattern)

This section refines Sub-model B (Section 16.2) into a concrete implementation. The phone replaces master password as the daily authentication factor. Master password becomes recovery only.

This complements — does not replace — Section 16.9. Section 16.9 describes **how the phone stores vault_key** (Secure Enclave wrapping). This section describes **how vault_key reaches the desktop** (QR + ECDH ephemeral key exchange via relay).

---

#### 16.10.1 Core Protocol — QR + ECDH Key Transfer

```
Desktop                    Server relay                  Phone
   │                            │                          │
   │── GET /auth/qr ────────────▶                          │
   │                            │                          │
   │◀── { session_id,           │                          │
   │     challenge (32 bytes),  │                          │
   │     desktop_pub (ephem),   │                          │
   │     server_sig,            │                          │
   │     ttl: 60s,              │                          │
   │     endpoints: { relay,    │                          │
   │       local? } } ──────────│                          │
   │                            │                          │
   │ display QR                 │                          │
   │ open WS connection         │                          │
   │ on /auth/qr-relay/{sid}    │                          │
   │                            │                          │
   │                            │◀── scan QR ──────────────│
   │                            │  verify server_sig       │
   │                            │  show context:           │
   │                            │   "Chrome on Windows     │
   │                            │    IP 93.x.x.x Milan"    │
   │                            │  user taps Approve       │
   │                            │  biometric → unwrap      │
   │                            │   vault_key from SE      │
   │                            │  generate phone_eph_priv │
   │                            │  shared = ECDH(          │
   │                            │    phone_eph_priv,       │
   │                            │    desktop_pub)          │
   │                            │  session_key = HKDF(     │
   │                            │    shared,               │
   │                            │    salt = challenge,     │
   │                            │    info = "adyton-qr-v1")│
   │                            │  encrypted = AES-GCM(    │
   │                            │    session_key,          │
   │                            │    vault_key,            │
   │                            │    aad = session_id)     │
   │                            │  signature = ECDSA(      │
   │                            │    phone_priv,           │
   │                            │    encrypted || session_id│
   │                            │    || challenge)         │
   │                            │                          │
   │                            │◀── POST /auth/qr-relay/  │
   │                            │     {session_id} body:   │
   │                            │     { phone_eph_pub,     │
   │                            │       encrypted,         │
   │                            │       device_id,         │
   │                            │       signature } ───────│
   │                            │                          │
   │                            │ verify signature against │
   │                            │  device_id's stored pub  │
   │                            │ relay payload over WS    │
   │                            │                          │
   │◀── WS push: { phone_eph_pub,                          │
   │     encrypted, device_id } ─│                          │
   │                            │                          │
   │ verify signature locally   │                          │
   │ shared = ECDH(             │                          │
   │   desktop_eph_priv,        │                          │
   │   phone_eph_pub)           │                          │
   │ session_key = HKDF(shared, │                          │
   │   challenge,               │                          │
   │   "adyton-qr-v1")          │                          │
   │ vault_key = AES-GCM-decrypt│                          │
   │   (session_key, encrypted, │                          │
   │    aad = session_id)       │                          │
   │ discard desktop_eph_priv   │                          │
   │ ✅ vault unlocked          │                          │
```

**Cryptographic properties:**

- `desktop_eph_priv` lives in browser memory only, never persisted, discarded after vault_key received
- `phone_eph_priv` generated fresh on phone for each auth, discarded after send
- ECDH shared secret is forward-secret: compromise of phone's stored SE key in the future does not decrypt past relay payloads
- AAD = `session_id` binds ciphertext to specific QR session — replay impossible
- Server signs QR contents → phone refuses unsigned QR → MITM injection of fake `desktop_pub` blocked
- Phone ECDSA signature over payload → relay cannot forge → server-side forgery blocked

---

#### 16.10.2 Server Relay Endpoints

```
GET    /auth/qr                       # desktop initiates: returns QR payload + server_sig
WS     /auth/qr-relay/:session_id     # desktop subscribes; relay pushes phone payload
POST   /auth/qr-relay/:session_id     # phone uploads encrypted+signature
DELETE /auth/qr-relay/:session_id     # phone or desktop cancels session
```

**Server enforcement rules:**

- `session_id` stored in Redis with TTL = 60 seconds
- Only one POST per session_id → second attempt = 410 Gone
- session_id invalidated immediately after successful relay
- Rate limit: 10 QR generations per IP per minute
- Rate limit: 30 QR scans per device_id per hour
- WS auto-closes after 60s if no payload received

**Redis schema:**

```
qr:session:{session_id} = {
  challenge: hex32,
  desktop_eph_pub: base64,
  created_at: epoch_ms,
  consumed: bool
}
TTL = 60s
```

---

#### 16.10.3 Phone Bootstrap — First Device Enrollment

Chicken-and-egg: vault_key must exist before phone can store it. Master password is the bootstrap.

```
1. Desktop login with master password (current Phase 4 flow)
2. master_password → Argon2id → vault_key (in memory)
3. User opens Settings → "Enroll phone as key"
4. Desktop shows enrollment QR:
   {
     mode: "ENROLLMENT",
     session_id, challenge, desktop_eph_pub, server_sig
   }
5. Phone (Capacitor app) scans QR → verify server_sig
6. Phone generates persistent SE keypair (stays in Secure Enclave forever):
   - iOS: SecureEnclave.P256.KeyAgreement.PrivateKey with [.userPresence, .biometryCurrentSet]
   - Android: Android Keystore EC keypair with setUserAuthenticationRequired(true)
7. Phone generates ephemeral keypair for THIS enrollment session
8. Phone POSTs to /devices/enroll:
   { device_pub_persistent, device_eph_pub, signature, device_metadata }
9. Server verifies signature, stores DeviceVaultKey row (initially without wrapped_key)
10. Server relays { device_eph_pub } to desktop via WS
11. Desktop: ECDH(desktop_eph_priv, device_eph_pub) → session_key
12. Desktop wraps vault_key for phone's PERSISTENT key:
    - Generate vault_key_wrap = random 32 bytes
    - encrypted_for_phone = AES-GCM(session_key, vault_key_wrap, aad="enrollment")
    - Phone receives → derives session_key same way → decrypts vault_key_wrap
13. Phone re-encrypts vault_key with its SE persistent key:
    - sealed_vault_key = SecureEnclave.wrap(vault_key) (key never leaves SE)
    - Stored locally on phone (encrypted file in app sandbox)
14. ❗ vault_key value transferred in plaintext-equivalent via ECDH — same model as auth flow
    (no server involvement in storing vault_key — phone holds the only copy after enrollment)
```

**After enrollment:** master password derivation can be skipped on daily auth. Master password becomes recovery only. User can also keep using master password as alternative — both paths coexist.

---

#### 16.10.4 Multi-Device — Enrollment of Additional Phones

**Modality A — Existing device authorizes new device (recommended):**

```
1. New phone B opens app → "Add this device"
2. Phone B generates persistent SE keypair + ephemeral keypair
3. Phone B displays QR with phone_B_pub_persistent + phone_B_eph_pub + challenge
4. Already-authenticated desktop (unlocked via phone A) scans phone B's QR
5. Desktop has vault_key in memory → wraps for phone B via ECDH (same as 16.10.3 step 11-13)
6. POST /devices/enroll with mode=EXISTING_DEVICE_AUTHORIZED
7. Phone B receives wrapped vault_key → stores in own SE
```

Audit log: `DEVICE_ENROLL_BY_DEVICE` with `authorizing_device_id`.

**Modality B — Master password bootstrap of new device (fallback):**

```
1. Phone B opens app → "I don't have my other device"
2. Email + master password input on phone
3. Server enforces:
   - Rate limit: 3 attempts per hour per email
   - Email confirmation: 6-digit code sent to registered email
   - Audit log entry with full context (IP, user-agent)
   - Push notification to ALL other registered devices: "New device enrollment via master password"
4. master_password → Argon2id → vault_key derived on phone B
5. Phone B wraps vault_key with own SE key → stores
6. Server records DeviceVaultKey with enrollmentMethod = MASTER_PASSWORD
```

UI surfaces this prominently in security dashboard — flagged as elevated-risk enrollment.

---

#### 16.10.5 Device Revocation Model

```
DELETE /devices/:id
  → set revokedAt
  → invalidate all active sessions originating from that device
  → invalidate all refresh tokens for that device's family
  → push notification to all other enrolled devices
  → email confirmation to user
  → audit log entry
```

**Important property:** revocation does NOT cryptographically remove vault_key from the revoked device. The device still holds `sealed_vault_key` in its own SE. Server-side block prevents new secret fetches, but secrets already cached on device remain decryptable.

**Two-tier revocation:**

| Action | Behavior | Use case |
|--------|----------|----------|
| **Standard revoke** | Server blocks device's API access. Vault_key cryptographically still in device's SE. | Device decommissioned safely (sold, traded in). |
| **Compromise revoke** | Standard + trigger full re-cipher: rotate vault_key + re-wrap for remaining devices + re-encrypt all secrets with new vault_key. | Device lost/stolen with risk of biometric bypass. |

UX on revoke:
```
[Revoke iPhone 15 Pro Diego]

Why are you revoking?
○ Device decommissioned safely (sold, traded in)
● Device lost, stolen, or compromised
  → Full re-cipher will be triggered. This may take 1-3 minutes
    depending on vault size. Continue?
```

Re-cipher pseudo-flow:
```
1. Generate new vault_key_v2 (random 32 bytes)
2. For each remaining device D:
   a. ECDH(desktop_eph_priv, D.device_pub) → session_key
   b. Phone D unwraps via persistent SE key
   c. Phone D wraps vault_key_v2 with own SE → new sealed_vault_key
   d. Phone D acks
3. For each secret in vault:
   a. Decrypt with vault_key_v1
   b. Re-encrypt with vault_key_v2 (preserving AAD = groupId:secretId)
   c. Atomic batch update
4. Increment user.vaultKeyVersion in DB
5. Old vault_key_v1 → discarded everywhere
```

Server-side: bulk operation in single transaction. Audit log per secret update.

---

#### 16.10.6 Authentication Fallback Hierarchy

```
1. Phone available + online      → QR + ECDH relay (daily)
2. Phone available + offline LAN → P2P local (V2 — deferred, see 16.10.9)
3. Phone unavailable             → Recovery kit (BIP39 mnemonic → derive recovery_key)
4. Recovery kit lost             → Master password (rate-limited, email confirm, audit)
5. All lost                      → Account locked, no data recovery possible
```

Each tier is more friction. Tier 1 is the default UX. Tiers 3-4 trigger email alerts and audit log entries with severity = HIGH.

---

#### 16.10.7 DeviceVaultKey Entity (Updated)

Refined from 16.9.1 to support QR/ECDH model:

```typescript
@Entity({ tableName: 'device_vault_keys' })
@Index({ properties: ['user', 'revokedAt'] })
export class DeviceVaultKey {
  @PrimaryKey({ type: 'uuid' })
  id: string = uuidv4();

  @ManyToOne(() => User)
  user: User;

  @Property({ length: 64, unique: true })
  publicKeyFingerprint: string; // SHA-256 hex of devicePublicKey

  @Property({ type: 'text' })
  devicePublicKey: string; // base64 SPKI — persistent P-256 public key

  @Property({ length: 32 })
  enrollmentMethod: 'master_password' | 'existing_device' | 'recovery_kit';

  @Property({ length: 256 })
  deviceName: string; // user-assigned

  @Property({ length: 32 })
  platform: 'ios' | 'android' | 'windows-tauri' | 'macos-tauri' | 'linux-tauri';

  @Property()
  enrolledAt: Date = new Date();

  @Property({ nullable: true })
  lastUsedAt: Date | null = null;

  @Property({ length: 64, nullable: true })
  lastUsedIp: string | null = null;

  @Property({ nullable: true })
  revokedAt: Date | null = null;

  @Property({ length: 32, nullable: true })
  revokedReason: 'safe' | 'compromised' | null = null;

  // For compromise revoke: track re-cipher status
  @Property({ default: false })
  reCipherCompleted: boolean = false;
}
```

**Note:** server stores `devicePublicKey` only — verifies signatures. Server NEVER stores `sealed_vault_key`. That lives exclusively on the device, inside its Secure Enclave.

---

#### 16.10.8 New API Endpoints

```
POST   /auth/qr                                # desktop initiates QR session
WS     /auth/qr-relay/:session_id              # desktop subscribes
POST   /auth/qr-relay/:session_id              # phone submits encrypted payload
DELETE /auth/qr-relay/:session_id              # cancel

POST   /devices/enroll                         # enrollment (modality A or B)
GET    /devices                                # list user's enrolled devices
PATCH  /devices/:id                            # rename
DELETE /devices/:id                            # revoke (with optional re-cipher)
POST   /devices/:id/recipher-ack               # phone acks new vault_key after re-cipher

POST   /recovery/kit/setup                     # generate + store recovery_wrapped_vault_key
POST   /recovery/kit/unlock                    # use mnemonic to derive recovery_key
```

---

#### 16.10.9 Local Network Variant — Deferred to V2

Peer-to-peer LAN bypass of relay is deferred:

- **Requires native app on desktop** (Tauri or Capacitor) — web browsers cannot bind TCP listeners
- **Complexity:** TLS server with cert pinning via QR fingerprint, network discovery, WiFi isolation handling
- **Marginal use case:** server outage is rare; relay latency is ~200ms acceptable for daily auth

If implemented in V2:

```json
QR endpoints field:
{
  "relay": "wss://vault.domain.com/auth/qr-relay",
  "local": [
    {
      "addr": "192.168.1.42:7456",
      "cert_fingerprint": "sha256-base64"
    }
  ]
}
```

Phone tries `local[*]` with 2s timeout each, falls back to relay. Same ECDH protocol, different transport.

**Decision: V1 implementation = relay-only.** Re-evaluate after launch.

---

#### 16.10.10 Implementation Phases for QR Device-as-Key

Inserted into roadmap as **Phase 10** (post Capacitor V3 / 16.9):

| Step | Effort | Deliverable |
|------|--------|-------------|
| 10.1 | 1w  | Server `/auth/qr` + Redis session store + WS relay endpoint |
| 10.2 | 2w  | Capacitor app: QR scanner, SE keypair generation, ECDH signing |
| 10.3 | 1w  | Desktop QR display + WS client + ECDH-decrypt vault_key |
| 10.4 | 1w  | Enrollment flows (Modality A + B) + DeviceVaultKey entity |
| 10.5 | 1w  | Device list UI + revocation + re-cipher flow |
| 10.6 | 1w  | Recovery kit (BIP39 mnemonic generation, storage, recovery flow) |
| 10.7 | 1w  | Security hardening: rate limits, audit logs, email alerts, replay protection |

**Total: ~8 weeks for full Phase 10.**

Prerequisite: Phase 9 (Capacitor mobile app) must be complete. The Capacitor app gains a new "Key mode" alongside its full-vault mode — same binary, different UI when launched via QR scan deep link.

---

#### 16.10.11 Risks Specific to QR Relay Model

| Risk | Severity | Mitigation |
|------|----------|------------|
| QR shoulder surfing | Medium | Server requires user-context confirmation on phone screen ("Chrome Windows, IP X, Milan") |
| Malicious QR injection (attacker tricks user to scan their QR) | High | Phone verifies `server_sig` — refuses QR not signed by enrolled server's known key |
| Relay server compromised | Low | Relay sees only ciphertext; ECDH shared secret never reaches server |
| Phone biometric bypass | Medium | SE key requires `biometryCurrentSet` — invalidated if attacker enrolls own biometric |
| First-device enrollment without confirmation | High | Email confirmation + 24h cool-down on master-password device additions |
| Relay outage = total lockout | Medium | Recovery kit (Tier 3) always available; future V2 local LAN bypass |
| Lost phone with no backup device | Critical | Mandatory recovery kit enrollment before phone-as-key activation |

---

*Generated: 2026-05-27 | Stack versions: NestJS 10, MikroORM 6, PostgreSQL 16, Redis 7, Nuxt 4, NuxtUI 4, Manifest V3, Tauri 2, Capacitor 6*
