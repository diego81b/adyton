## 3. Security Architecture

### 3.1 Zero-Knowledge Model

"Zero-knowledge" in this system means the server is architecturally incapable of recovering vault contents, not merely contractually prohibited from doing so. The distinction matters: contractual guarantees depend on trust and enforcement; architectural guarantees depend on cryptography.

Concretely, the server stores the following:

| Item | Stored Form | Notes |
|------|-------------|-------|
| Secret content | AES-256-GCM ciphertext + IV + auth tag (encrypted with `groupKey`) | Opaque to server |
| Group key (`groupKey`) | AES-256-GCM ciphertext encrypted with `userKey` → stored as `encryptedGroupKey` per membership | Server holds encrypted groupKey; cannot decrypt without userKey |
| User vault key (`userKey`) | Never transmitted | Derived client-side from master password via Argon2id |
| Master password | Never stored | Not transmitted |
| Authentication credential | Argon2id hash of a separate auth password | Distinct from master password if desired |
| Refresh token | SHA-256 hash of random bytes | Token itself set as httpOnly cookie |
| kdfSalt | Plaintext 16-byte hex string | Non-secret; required by client for key derivation |
| TOTP secret | AES-256-GCM encrypted (server-held key) | Not zero-knowledge for 2FA secrets; accepted trade-off |
| WebAuthn credentials | Public key + credential ID | No private key material server-side |

**Key hierarchy:**
```
Master password
    └─ Argon2id (client-side) → userKey (never leaves client)
           └─ AES-256-GCM decrypt(encryptedGroupKey) → groupKey (never transmitted)
                  └─ AES-256-GCM decrypt(secret.encryptedData) → plaintext secret
```

This two-level key hierarchy enables future group sharing: when a second user is invited to a group, the owner re-encrypts `groupKey` with the new member's `userKey` and stores a new `GroupMembership` row. No secret re-encryption required.

**Metadata Leakage.** Zero-knowledge encryption does not eliminate all information leakage. The server observes and stores:

- `labelHash`: A SHA-256 hash of the entry label. An attacker with the hash and a dictionary of common service names could reverse common labels. This is a known, accepted trade-off — `labelHash` enables server-side search without plaintext exposure.
- `secretType`: Stored in plaintext (`PASSWORD` or `FILE`). Leaks the coarse type distribution of a vault. Password subtypes (login vs. credit card vs. note) are encoded in the encrypted payload — server cannot distinguish them.
- `encryptedMetadata`: Encrypted with `groupKey` (AES-256-GCM). Filename, domain, environment tag are server-opaque from V1. Domain matching for extension autofill is performed client-side from an in-memory decrypted metadata cache built after group key unlock.
- `createdAt` / `updatedAt`: Timestamps leak activity patterns and vault size growth over time.
- `encryptedSize`: The byte length of the ciphertext is visible.

These leakages are acceptable in a personal self-hosted context where the operator is the user.

**DB Breach Scenario.** An attacker who exfiltrates the full PostgreSQL database obtains: ciphertext blobs, per-entry IVs, Argon2id hashes of authentication credentials, SHA-256 hashes of refresh tokens, and TOTP secrets encrypted with a server-held key (if the server key is also compromised, TOTP secrets are exposed). They cannot decrypt vault entries without the master password. Their attack path is offline dictionary attack against the Argon2id authentication hash. At m=65536, t=3, p=1, a single Argon2id verification requires ~64MB RAM and measurable CPU time, making large-scale GPU cracking economically impractical for a strong master password.

### 3.2 Client-Side Encryption

**Key Derivation with Argon2id**

The master password is processed through Argon2id with the following parameters:

```
m = 65536  (64 MB memory)
t = 3      (3 iterations)
p = 1      (1 thread)
tagLength = 32  (256-bit output)
```

The memory parameter (m=65536) is the primary defense against GPU and ASIC attacks. A GPU with 10,000 cores cannot run 10,000 parallel Argon2id instances at these parameters because each requires 64MB of RAM — a GPU with 24GB VRAM can run at most ~384 instances simultaneously, compared to billions of parallel MD5 or SHA-256 hashes.

These parameters derive from OWASP's 2023 recommendations and are calibrated to produce a ~1-2 second derivation on a modern consumer device — slow enough to frustrate brute force, fast enough to be imperceptible to a user unlocking their vault.

The `kdfSalt` is a 16-byte cryptographically random value generated at registration, stored in the database in plaintext, and delivered to the client in the login response. It is non-secret: its purpose is to ensure that the same master password produces different derived keys across different users (and across re-registrations).

**AES-256-GCM Encryption**

Each vault entry is encrypted independently using AES-256-GCM with a fresh random 96-bit (12-byte) IV. The choice of AES-256-GCM over ChaCha20-Poly1305 is deliberate: AES-NI hardware acceleration is present in all x86-64 processors since ~2010 and in ARM processors since ~2011. Additionally, ChaCha20-Poly1305 is not exposed by the Web Crypto API at all (as of 2025), making it a non-option for native browser crypto.

The 128-bit authentication tag provides integrity verification: decryption fails (throws) if the ciphertext has been tampered with, ensuring the system detects any server-side modification of stored blobs.

The serialized format stored per entry:

```json
{
  "iv": "<base64url(12 bytes)>",
  "ciphertext": "<base64url(variable + 16-byte tag appended by WebCrypto)>"
}
```

**Key Lifecycle**

The `CryptoKey` object is created with `extractable: false`, meaning `crypto.subtle.exportKey()` on it will throw. The key is cleared from the Pinia store on:
- Explicit logout
- Browser tab close (in-memory store does not survive page reload)
- Inactivity timeout (default 15 minutes) via a debounced timer
- Extension service worker termination (MV3 service workers do not persist)

Master password change triggers a full vault re-encryption: all entries are decrypted with the old key, re-encrypted with the new key (derived from the new password + a freshly generated kdfSalt), and the entire vault is replaced in a single atomic database transaction.

**Master Password Strength Enforcement**

The master password is the single point of failure for the entire encryption model. The Argon2id parameters (m=65536, t=3) are calibrated to make offline cracking expensive — but "expensive" is relative to the attacker's resources and the password's entropy. A dictionary word processed through Argon2id at these parameters falls to a 100-GPU cluster in seconds. The system therefore enforces hard requirements on master password quality, client-side at registration and on every vault re-unlock prompt.

Requirements enforced (all must pass simultaneously):

| Requirement | Rationale |
|-------------|-----------|
| Minimum 12 characters | Below 12 chars, even random passwords have insufficient entropy against motivated attackers |
| zxcvbn score = 4 ("Very Strong") | zxcvbn models realistic cracking: dictionary attacks, l33t-speak substitutions, keyboard patterns, reversed words, date patterns. Score 4 requires estimated crack time > centuries on a fast offline attack. Score 3 ("Strong") is insufficient — it still permits dictionary-word combinations |
| No detected dictionary word (any language) | zxcvbn flags dictionary matches from 30,000+ word lists across multiple languages. If any token in the password matches a dictionary word with score contribution, reject |
| No keyboard walk patterns | zxcvbn detects `qwerty`, `asdfgh`, `12345`, `zxcvbn`, etc. Any spatial pattern contribution → reject |
| No repeated character sequences | `aaabbb`, `111222` — zxcvbn `repeat` match → reject |
| Not found in breach corpus (HaveIBeenPwned) | k-anonymity API check: send SHA-1 prefix (5 hex chars) to HIBP, check if full hash suffix is returned. Runs client-side — server never sees the password |
| Minimum 3 of 4 character classes | Uppercase · lowercase · digits · symbols. Pure alphabetic or pure numeric passwords are rejected regardless of length |

**HaveIBeenPwned k-anonymity check (client-side):**

```typescript
// packages/shared/src/password-validation.ts
export async function isBreachedPassword(password: string): Promise<boolean> {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  const prefix = hashHex.slice(0, 5);
  const suffix = hashHex.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const text = await response.text();
  return text.split('\n').some(line => line.startsWith(suffix));
}
```

Only the first 5 hex characters of the SHA-1 hash are sent to the HIBP API. The HIBP server returns all hashes sharing that prefix (typically ~400–600 entries). The match check runs locally. The password itself and the full hash never leave the browser. This is the k-anonymity model described in the HIBP API specification.

**Validation function in `packages/shared`:**

```typescript
export interface PasswordStrengthResult {
  valid: boolean;
  score: number;             // 0-4 (zxcvbn)
  crackTimeSec: number;      // offline fast hash, worst-case
  feedback: string[];        // user-facing rejection reasons
  breached: boolean;         // found in HIBP corpus
}

export async function validateMasterPassword(
  password: string
): Promise<PasswordStrengthResult> {
  const result = zxcvbn(password);
  const feedback: string[] = [];

  if (password.length < 12)
    feedback.push('Minimum 12 characters required.');

  if (result.score < 4)
    feedback.push('Password is too predictable. Avoid words, phrases, keyboard patterns, and substitutions like @ for a.');

  // zxcvbn match sequence: reject if any match is a dictionary word or spatial/repeat pattern
  const hasWeakMatch = result.sequence.some(
    m => ['dictionary', 'spatial', 'repeat'].includes(m.pattern)
  );
  if (hasWeakMatch)
    feedback.push('Password contains a recognizable word, pattern, or repeated sequence.');

  const charClasses = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];
  const classCount = charClasses.filter(rx => rx.test(password)).length;
  if (classCount < 3)
    feedback.push('Use at least 3 character types: uppercase, lowercase, numbers, symbols.');

  const breached = await isBreachedPassword(password);
  if (breached)
    feedback.push('This password has appeared in a known data breach. Choose a different password.');

  return {
    valid: feedback.length === 0,
    score: result.score,
    crackTimeSec: result.crack_times_seconds.offline_fast_hashing_1e10_per_second as number,
    feedback,
    breached,
  };
}
```

The `PasswordInput` component in the Nuxt frontend displays the `PasswordStrengthResult` in real time: a four-segment strength bar, estimated crack time in human-readable form ("Centuries" vs "3 minutes"), and all rejection reasons listed below the field. The "Register" and "Change Password" buttons are disabled until `valid === true`.

The HIBP check is debounced (500ms after last keystroke) to avoid excessive API calls during typing. It runs only when the password meets the minimum length and zxcvbn score thresholds — no point querying HIBP for a password that fails local validation first.

### 3.3 Encryption & Decryption Lifecycle (Step-by-Step)

This section walks through the complete lifecycle of a vault entry from user input to server storage and back, making every cryptographic operation explicit.

#### 3.3.1 Registration — KDF Salt Generation

When a new user registers, the server generates a unique `kdfSalt`:

```
Server:
  kdfSalt = crypto.randomBytes(32)   // 256-bit random, non-secret
  store in User.kdfSalt (plaintext)
  return kdfSalt to client in registration response
```

The `kdfSalt` is not a secret. Its purpose is to ensure the same master password produces a different encryption key for different users (and across re-registrations). It is delivered to the client in the login response so the client can derive the key without a separate round-trip.

#### 3.3.2 Two-Phase Model: Authentication vs. Vault Unlock

The system enforces a deliberate separation between two operations that are superficially similar but cryptographically distinct:

| Phase | What it proves | Where it happens | Server involvement |
|-------|----------------|------------------|--------------------|
| **Phase 1 — Authentication** | Identity (you are the registered user) | Client → Server | Server validates Argon2id hash + issues JWT |
| **Phase 2 — Vault Unlock** | Knowledge of the encryption key | Client only | Server never involved — key never leaves client |

This separation is not cosmetic. Even if an attacker steals a valid JWT session (e.g. via MITM on a misconfigured network or a physical session hijack), the vault remains locked. The JWT grants API access; it does not grant vault decryption capability. The attacker can call `GET /vault` and receive encrypted blobs, but cannot derive the AES-256-GCM key without the master password.

The UX makes this separation explicit via a two-step flow:

```
Step 1 — Login screen (identity verification)
  ┌──────────────────────────────────────┐
  │  Email:     [ alice@example.com    ] │
  │  Password:  [ ●●●●●●●●●●●●●●●●●● ] │
  │             [ Login ]               │
  └──────────────────────────────────────┘
     ↓ Server validates, issues JWT + sets refresh cookie
     ↓ kdfSalt returned in response

Step 2 — Vault Unlock screen (key derivation, client-only)
  ┌──────────────────────────────────────┐
  │  🔒 Vault Locked                     │
  │                                      │
  │  Enter master password to unlock:    │
  │  [ ●●●●●●●●●●●●●●●●●●●●●●●●●●●● ] │
  │             [ Unlock Vault ]         │
  │                                      │
  │  Your password never leaves          │
  │  this device.                        │
  └──────────────────────────────────────┘
     ↓ Argon2id runs in Web Worker (64MB, ~1-2 sec)
     ↓ CryptoKey stored in useCryptoStore (memory only)
     ↓ Vault entries fetched and decrypted client-side
```

In practice the authentication password and master password are the same string for a single-user self-hosted deployment. Internally, they are used for two completely independent Argon2id derivations with different salts and different purposes:

```
masterPassword (same string)
    │
    ├─ Argon2id(masterPassword, authSalt)   → authHash   → stored in DB (server)
    │  Purpose: prove identity to server
    │  authSalt: random, generated server-side at registration
    │
    └─ Argon2id(masterPassword, kdfSalt)   → CryptoKey  → never leaves client
       Purpose: derive AES-256-GCM encryption key
       kdfSalt: random, generated server-side at registration, delivered to client on login
```

The two Argon2id invocations are independent. Cracking the `authHash` from the database gives authentication access. It does not yield the vault decryption key, because that key is derived with a different salt (`kdfSalt`) through an independent Argon2id call that runs client-side and is never transmitted.

The Vault Unlock screen also appears on:
- Page refresh (in-memory `CryptoKey` is lost)
- Auto-lock after 15 minutes of inactivity
- Explicit "Lock Vault" action
- Browser tab close and reopen

This behavior is analogous to a smartphone requiring PIN re-entry after screen lock — possession of the unlocked device (active JWT) is insufficient to access protected content (vault data).

#### 3.3.3 Login — Key Derivation

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT (browser)                                                   │
│                                                                     │
│  1. User types master password on Step 2 Vault Unlock screen        │
│                                                                     │
│  2. kdfSalt retrieved from useCryptoStore                           │
│     (was delivered by server during Step 1 login)                   │
│                                                                     │
│  3. Argon2id key derivation (runs in Web Worker):                   │
│                                                                     │
│     masterPassword + kdfSalt                                        │
│            │                                                        │
│            ▼                                                        │
│     argon2id(m=65536, t=3, p=1)          ← ~1-2 sec, 64MB RAM     │
│            │                                                        │
│            ▼                                                        │
│     rawKeyBytes[32]                       ← 256-bit raw key        │
│            │                                                        │
│            ▼                                                        │
│     SubtleCrypto.importKey(               ← Web Crypto API         │
│       'raw', rawKeyBytes,                                           │
│       { name: 'AES-GCM' },                                         │
│       extractable: false,                 ← KEY CANNOT BE READ     │
│       ['encrypt', 'decrypt']                                        │
│     )                                                               │
│            │                                                        │
│            ▼                                                        │
│     CryptoKey (opaque handle)             ← stored in Pinia        │
│                                             useCryptoStore         │
└─────────────────────────────────────────────────────────────────────┘
```

The master password and raw key bytes exist in memory for less than a millisecond before the `CryptoKey` object is created. Once `importKey` completes, only the opaque `CryptoKey` handle remains — the raw bytes are garbage collected. Even a debugger cannot read the key via `crypto.subtle.exportKey()` because `extractable: false` causes it to throw.

#### 3.3.3 Write — Encrypting a Vault Entry

When the user saves a new or edited entry:

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT (browser)                                                   │
│                                                                     │
│  plaintext = JSON.stringify({                                       │
│    label: "GitHub",                                                 │
│    username: "alice@example.com",                                   │
│    password: "hunter2",                                             │
│    url: "https://github.com",                                       │
│    notes: ""                                                        │
│  })                                                                 │
│                                                                     │
│  iv = crypto.getRandomValues(new Uint8Array(12))                    │
│       └─ 96-bit random nonce, unique per entry per save             │
│                                                                     │
│  { ciphertext } = await SubtleCrypto.encrypt(                       │
│    { name: 'AES-GCM', iv },                                         │
│    cryptoKey,               ← from useCryptoStore (never leaves)   │
│    TextEncoder(plaintext)                                           │
│  )                                                                  │
│  └─ ciphertext includes 128-bit auth tag appended by WebCrypto      │
│                                                                     │
│  labelHash = SHA-256(label.toLowerCase())                           │
│  └─ allows server-side search without seeing the label             │
│                                                                     │
│  POST /vault {                                                      │
│    encryptedData: base64(ciphertext),   ← opaque to server         │
│    iv:            base64(iv),           ← 12 bytes, non-secret     │
│    authTag:       base64(tag),          ← 16 bytes, integrity      │
│    entryType:     "LOGIN",                                          │
│    labelHash:     hex(SHA-256(label))   ← non-reversible*          │
│  }                                                                  │
│        ───────────────────────────────────────────────────────────► │
│                                                                     │
│  Server stores row in vault_entries.                                │
│  Server CANNOT read encryptedData — it is AES-256-GCM ciphertext.  │
│  Returns: { id, entryType, labelHash, createdAt }                  │
│        ◄─────────────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────────┘

* labelHash is SHA-256. Common labels (e.g. "github.com") could be
  reversed by dictionary attack. For high-security entries, use
  non-obvious labels or disable server-side search in settings.
```

#### 3.3.4 Read — Decrypting a Vault Entry

When the user opens the vault or navigates to an entry:

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT (browser)                                                   │
│                                                                     │
│  GET /vault (or GET /vault/:id)                                     │
│        ───────────────────────────────────────────────────────────► │
│                                                                     │
│  Server returns:                                                    │
│  {                                                                  │
│    id, entryType, labelHash,                                        │
│    encryptedData: "base64...",  ← opaque blob                      │
│    iv:            "base64...",                                      │
│    authTag:       "base64..."   ← integrity tag                    │
│  }                                                                  │
│        ◄─────────────────────────────────────────────────────────── │
│                                                                     │
│  plaintext = await SubtleCrypto.decrypt(                            │
│    { name: 'AES-GCM', iv: base64Decode(iv) },                      │
│    cryptoKey,                   ← from useCryptoStore              │
│    base64Decode(encryptedData)  ← includes auth tag                │
│  )                                                                  │
│                                                                     │
│  IF auth tag is invalid → decrypt throws DOMException              │
│  └─ means server tampered with data or IV/key mismatch             │
│     → UI shows "Integrity check failed" error, entry not shown     │
│                                                                     │
│  entry = JSON.parse(TextDecoder(plaintext))                         │
│  └─ { label, username, password, url, notes }                      │
│                                                                     │
│  Stored in useVaultStore.entries (Vue reactive ref, in memory)      │
│  Rendered in component — passwords masked by default               │
│  Clipboard write triggers 30-second auto-clear                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.3.5 What the Server Sees (Summary)

| Data | What server stores | Can server recover plaintext? |
|------|-------------------|-------------------------------|
| Vault entry content | AES-256-GCM ciphertext | No — would need `CryptoKey` |
| Vault entry IV | 12-byte random nonce | Stored but useless without key |
| Auth tag | 16-byte GCM tag | Only proves integrity, not content |
| Label | SHA-256 hash | No — hash is one-way |
| Entry type | Plaintext enum | Yes — category only, not content |
| Master password | Never stored/transmitted | N/A |
| Derived key | Never transmitted | N/A |

A full database dump is cryptographically useless to an attacker. The only path to plaintext is offline brute-force against the Argon2id hash of the **authentication** password (stored in `User.passwordHash`). At m=65536, t=3, p=1, this takes ~1-2 seconds per attempt per CPU core — GPU parallelism is limited to RAM per GPU core, making large-scale cracking economically impractical for any strong master password.

---

### 3.4 Authentication Flow (JWT RS256)

**RS256 Rationale**

JWT signing with RS256 uses an asymmetric key pair. The API server holds the private key and signs tokens; any consumer (including the browser extension) can verify tokens using only the public key, which can be embedded at build time. HS256 would require the extension to hold the shared secret, granting it token-forging capability — an unacceptable security property for code distributed in an extension package.

**Access Token**

The access token is a signed JWT with the following claims:

```json
{
  "sub": "<userId>",
  "email": "<email>",
  "twoFactorPassed": true,
  "iat": "<issued-at>",
  "exp": "<issued-at + 900>"
}
```

It has a 15-minute lifetime. The web app and extension store it exclusively in Pinia / service worker memory — never in `localStorage` or `sessionStorage`.

**Refresh Token**

The refresh token is a cryptographically random 256-bit value generated server-side. It is delivered as an `httpOnly; Secure; SameSite=Strict` cookie, making it inaccessible to JavaScript entirely. The server stores only the SHA-256 hash of the token alongside a `familyId` (UUID) and `expiresAt` timestamp.

On each `POST /auth/refresh`:
1. The httpOnly cookie is read server-side.
2. The submitted token is hashed and looked up in the database.
3. If valid and unexpired: the old token record is deleted, a new access token and refresh token are generated, the new refresh token hash is stored (same `familyId`), and both are returned.
4. If the token hash is not found but the `familyId` exists and has other tokens: this indicates a stale token was submitted (replay or theft). The entire family is immediately revoked (all sessions terminated).

**kdfSalt Delivery**

The `kdfSalt` is included in the `/auth/login` success response alongside the access token. This is the earliest point at which the client has confirmed the user's identity and can safely begin Argon2id derivation.

### 3.5 Two-Factor Authentication

**TOTP**

Time-based One-Time Passwords are implemented via `otplib`, generating a standard TOTP URI (compatible with Google Authenticator, Aegis, and all RFC 6238-compliant apps). The setup flow:

1. Server generates a 160-bit random TOTP secret, encrypts it with a server-held AES-256-GCM key, and stores the ciphertext in the user record.
2. A QR code (data URI) is generated from the `otpauth://` URI and returned to the client (not persisted — if the user fails to scan it, they restart setup).
3. The client must submit a valid TOTP code to confirm setup, preventing lockout from incorrect QR scanning.

On login: after password verification, if TOTP is enabled, the server returns `{ requiresMfa: true, mfaToken }`. The client prompts for the TOTP code; on correct submission, the full token pair is issued.

**WebAuthn / Passkeys**

WebAuthn is implemented via `@simplewebauthn/server`. Registration stores the credential public key, credential ID, counter, and AAGUID. Authentication verifies the assertion using the stored public key.

WebAuthn's phishing resistance is structural: the authenticator cryptographically binds the credential to the relying party origin (`rpId`). A phishing site at a different origin cannot receive a valid WebAuthn assertion for the legitimate site's credential. This property makes WebAuthn categorically superior to TOTP for phishing threats.

Both methods are supported simultaneously. WebAuthn is the preferred path, surfaced first in the UI. TOTP serves as a registered fallback for contexts where hardware authenticators are unavailable.

**Recovery Codes**

Eight one-time recovery codes are generated at 2FA enrollment. Each code is formatted as `xxxxx-xxxxx-xxxxx-xxxxx` (20 hex characters). All eight are hashed with Argon2id (lower cost parameters: m=19456, t=2, p=1 — sufficient for high-entropy codes) and stored. On use, the matching hash is deleted. Recovery codes can be regenerated (invalidating all previous codes), and their use is logged.

### 3.6 Security Headers

The following headers are applied to all responses:

**Content Security Policy** (NestJS `@fastify/helmet` + nginx):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self';
  frame-ancestors 'none';
  form-action 'self';
  base-uri 'self';
  upgrade-insecure-requests;
```

`'wasm-unsafe-eval'` is required for Argon2id WASM. `'unsafe-inline'` on `style-src` is required by Tailwind's runtime class injection.

**Additional Headers** (nginx):

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

HSTS with a 2-year max-age and `preload` ensures browsers never make plaintext HTTP connections to the domain. `Referrer-Policy: no-referrer` prevents the browser from leaking the current URL in cross-origin requests — important for a password manager where URLs in the referrer could reveal which services a user accesses.

### 3.7 Rate Limiting Strategy

Rate limiting is implemented via `@nestjs/throttler` backed by Redis, using atomic counter operations. All limits are enforced per IP + (where applicable) per email to prevent both volumetric abuse and credential stuffing.

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `POST /auth/login` | 5 requests | 15 minutes | IP + email |
| `POST /auth/refresh` | 20 requests | 15 minutes | IP |
| `POST /auth/register` | 3 requests | 1 hour | IP |
| `POST /auth/2fa/verify` | 5 requests | 15 minutes | IP + userId |
| `GET /groups/:id/secrets` | 60 requests | 1 minute | userId |
| All other endpoints | 100 requests | 1 minute | userId |

**X-Forwarded-For Trust.** The nginx reverse proxy sets `X-Real-IP` and `X-Forwarded-For` headers from the actual client IP. The NestJS application is configured with `trustProxy: true` in Fastify server options. Direct access to the NestJS port (bypassing nginx) is blocked at the firewall level.

### 3.8 Threat Model

| Threat | Impact | Primary Mitigation | Secondary Mitigation |
|--------|--------|-------------------|---------------------|
| Database breach (full dump) | High | AES-256-GCM ciphertext is computationally opaque without master password; Argon2id slows offline cracking of auth hashes | Strong master password requirement; kdfSalt per user prevents rainbow tables |
| XSS in web app | High | `CryptoKey` is non-extractable; CSP blocks inline scripts and external script sources | httpOnly refresh token cookie is inaccessible to JS; Pinia store reset on inactivity |
| CSRF | Medium | SameSite=Strict on refresh token cookie; all mutating endpoints require Bearer token in Authorization header (not auto-sent by browser) | CSRF token not required given SameSite=Strict + Authorization header pattern |
| Brute force (login) | High | 5 req/15min per IP+email rate limit; Argon2id cost makes each attempt expensive server-side | fail2ban at VPS level parsing nginx logs |
| Refresh token theft | High | httpOnly cookie prevents JS access; family-based rotation detects reuse and revokes entire session family | 7-day expiry limits window; HSTS prevents downgrade interception |
| Access token theft | Medium | 15-minute TTL limits window; RS256 means stolen token cannot be extended | In-memory storage (no localStorage); no network access without valid refresh |
| MITM / network interception | High | HSTS with preload + 2-year max-age prevents cleartext connections; TLS 1.2+ enforced at nginx | Let's Encrypt certificate with OCSP stapling |
| Insider threat (operator) | Low (self-hosted) | Operator is the user; no third-party access to infrastructure | Full disk encryption on VPS OS volume as additional layer |
| Master password guess | High | Argon2id m=65536 makes offline attacks expensive; no server-side hint about KDF output | No master password recovery path (intentional); zxcvbn score check at registration |
| Extension compromise | High | Extension shares `packages/shared` crypto code (no separate implementation to backdoor) | MV3 limits background page persistence; pinned dependency hashes |
| Supply chain attack | Medium | pnpm lockfile with content-addressed hashing; `pnpm audit` in CI | Minimal third-party crypto dependencies (Web Crypto API used for core ops) |
| Server-side code execution | Critical | Vault contents encrypted before reaching server; code execution grants access only to ciphertext | Principle of least privilege on DB user (no DDL permissions in production) |

The most consequential residual risk is a weak master password combined with a database breach. The Argon2id parameters provide strong protection against a well-chosen master password, but cannot compensate for a master password that appears in a credential dictionary. An enforced minimum entropy check (zxcvbn score = 4 (maximum)) at registration is the practical mitigation.

---

### 3.9 Encryption Hardening Roadmap

Encryption improvements ordered by version. V1 items have zero or near-zero additional implementation cost relative to building the feature from scratch. V2+ items require dedicated engineering effort and are deferred to avoid premature complexity.

#### V1 — Shipped in initial implementation

| # | Improvement | Mechanism | Cost | Why now |
|---|---|---|---|---|
| 1 | **AEAD AAD binding** | Include `groupId:secretId` as Additional Authenticated Data in every AES-256-GCM encrypt/decrypt call | Zero — one parameter addition | Prevents ciphertext transplant attack (moving a blob to a different entry/group decrypts as garbage rather than succeeding silently). Must be consistent from day one; retroactive addition requires re-encryption of all secrets. |
| 2 | **Encrypted metadata** | `metadata` field encrypted with `groupKey` instead of plaintext JSONB. Stored as `encryptedMetadata` (base64 AES-GCM) + `metadataIv`. Decrypted client-side after groupKey is available. | Low — entity field change + client decrypt step | Removes last plaintext information visible to server: filenames, environment tags, domains. Domain matching for extension done client-side from in-memory decrypted cache. |
| 3 | **Group key rotation on member removal** | When a member is removed: (a) generate new `groupKey2` client-side; (b) re-encrypt all group secrets with `groupKey2`; (c) re-encrypt `groupKey2` for each remaining member; (d) send atomic batch to server. Server applies in single transaction. Removed member's `GroupMembership` row deleted. | Medium — rotation logic + batch API endpoint | **Critical for enterprise use.** Without rotation, a removed employee retains the old `groupKey` and can decrypt all secrets created before their removal. If this is a commercial product, shipping without rotation would be a compliance failure (SOC 2, ISO 27001 require cryptographic access revocation). |

**AAD binding implementation:**

```typescript
// packages/shared/src/crypto.ts

export async function encryptSecret(
  groupKey: CryptoKey,
  plaintext: string,
  aad: string, // e.g. `${groupId}:${secretId}`
): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedAad = new TextEncoder().encode(aad);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encodedAad },
    groupKey,
    new TextEncoder().encode(plaintext),
  );
  // AES-GCM output = ciphertext || authTag (last 16 bytes)
  const data = new Uint8Array(encrypted);
  const ciphertext = data.slice(0, -16);
  const authTag = data.slice(-16);
  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    authTag: toBase64(authTag),
  };
}

export async function decryptSecret(
  groupKey: CryptoKey,
  ciphertext: string,
  iv: string,
  authTag: string,
  aad: string, // must match exactly what was used during encrypt
): Promise<string> {
  const data = new Uint8Array([...fromBase64(ciphertext), ...fromBase64(authTag)]);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv), additionalData: new TextEncoder().encode(aad) },
    groupKey,
    data,
  );
  return new TextDecoder().decode(decrypted);
}
```

**Group key rotation flow:**

```
Client (vault owner / admin)
─────────────────────────────
1. Remove member M from group G
   → generate groupKey2 = crypto.getRandomValues(32 bytes) → importKey()
2. For each secret S in group G:
   a. decrypt(groupKey, S.encryptedData, S.iv, S.authTag, `${G.id}:${S.id}`)
   b. encrypt(groupKey2, plaintext, `${G.id}:${S.id}`) → new { encryptedData, iv, authTag }
3. For each remaining member R (not M):
   a. encrypt(R.userKey, groupKey2_raw) → new { encryptedGroupKey, groupKeyIv }
4. POST /groups/:id/rotate-key
   body: {
     removedMemberId: M.id,
     updatedSecrets: [{ id, encryptedData, iv, authTag }],  // all secrets
     updatedMemberships: [{ userId, encryptedGroupKey, groupKeyIv }]  // remaining members
   }

Server
──────
5. Begin transaction:
   - DELETE GroupMembership WHERE groupId = G AND userId = M
   - UPDATE each Secret (bulk)
   - UPDATE each GroupMembership.encryptedGroupKey (remaining members)
   - COMMIT
```

Server validates: only OWNER or ADMIN can call rotate-key; `updatedSecrets` count must match current secrets count for group; each secretId must belong to group.

**New API endpoint:**

```
POST /groups/:id/rotate-key    JWT + 2FA (OWNER or ADMIN role)
```

---

#### V2 — Next major version

| # | Improvement | Mechanism | Prerequisite | Notes |
|---|---|---|---|---|
| 4 | **Per-secret key layer** | Each Secret gets a random `secretKey` encrypted with `groupKey`. Secrets re-keyed independently. | V1 shipped, groups stable | Enables individual secret delegation (share one credential without sharing the group). Cost: third key layer, larger payload per secret. |
| 5 | **OPAQUE authentication protocol** | Replace `Argon2id(authPassword) → server` with OPAQUE (IETF RFC 9497 draft). Server stores an OPAQUE record, never receives any function of the password. Offline dictionary attack against DB dump becomes computationally infeasible even without Argon2id. | Significant backend + frontend refactor | Libraries: `opaque-wasm` (browser), `@cloudflare/opaque-ts`. Auth flow changes completely. Zero Argon2id auth hash in DB. |

---

#### V3 / Future

| # | Improvement | Notes |
|---|---|---|
| 6 | **Proactive key ratcheting** | Periodic rotation of group keys independent of membership changes. Defense against long-term key compromise. |
| 7 | **Zero-knowledge search (SSE)** | Replace `labelHash` with a structured encryption scheme (OXT, SEAL) allowing server-side search over encrypted indexes without revealing plaintext. Eliminates the SHA-256 label hash as a dictionary attack surface. |
| 8 | **Threshold cryptography (M-of-N)** | Vault opens only if M out of N registered devices approve. Key shares via Shamir's Secret Sharing. Built-in recovery without paper phrase. |

---

#### Enterprise readiness assessment

If PwdSecure becomes a commercial product, V1 already covers the primary enterprise requirements. The critical difference from a personal vault is item 3 (group key rotation): without it, cryptographic access revocation is impossible and the product cannot pass a security audit for SOC 2 Type II or ISO 27001.

| Requirement | V1 | V2 |
|---|---|---|
| Encrypted at rest | ✅ AES-256-GCM | — |
| Key isolation per tenant/group | ✅ Per-group key | — |
| Cryptographic access revocation | ✅ Group key rotation | — |
| Brute-force resistance | ✅ Argon2id m=65536 | — |
| No plaintext credential on server | ✅ Zero-knowledge model | — |
| No auth hash in DB | ❌ Argon2id hash present | ✅ OPAQUE |
| Individual secret delegation | ❌ Group-level only | ✅ Per-secret key |
| Audit log | ✅ Full action log | — |
| Role-based access | ✅ OWNER/ADMIN/MEMBER/VIEWER | — |

---

### 3.10 DDoS Mitigation & Trusted Device Model

#### 3.10.1 Defense Layers (in depth)

Multiple independent layers — each one stops a class of attack that bypasses the previous layer:

| Layer | Technology | Stops |
|---|---|---|
| **1. VPS firewall** | UFW — allow only 80, 443, SSH (non-standard port) | Port scanning, direct access to NestJS/Postgres/Redis |
| **2. nginx connection control** | `limit_conn_zone`, timeouts, body size limits | Slow HTTP attacks (Slowloris), connection floods, oversized payloads |
| **3. nginx rate limiting** | `limit_req_zone` per IP — strict on auth, looser on API | Volumetric brute-force from single IP |
| **4. fail2ban** | Parses nginx access logs; bans IP after threshold of 401/429 | Distributed slow brute-force (1 req/min over many minutes) |
| **5. NestJS throttler (Redis)** | Per-IP + per-user rate limits; awareness of authenticated context | Rate limits survive nginx bypass (direct container access blocked by UFW) |
| **6. Progressive login delay** | Redis-tracked attempt counter per `ip:email` | Slow brute-force that stays under nginx rate limit |
| **7. Trusted device model** | `device_id` httpOnly cookie; new device = email alert + extra friction | Unauthorized access from new device detected and alerted immediately |
| **8. Proof of Work (optional)** | SHA-256 hashcash challenge per login attempt | Bot farms — PoW is cheap for a browser (< 200ms), expensive at 1000 RPS scale |

No single layer is sufficient. Each assumes the previous can be bypassed.

---

#### 3.10.2 nginx Rate Limiting & Connection Hardening

```nginx
# Production nginx — rate limit zones (http block)
limit_req_zone  $binary_remote_addr  zone=z_auth:10m     rate=5r/m;    # login + 2FA
limit_req_zone  $binary_remote_addr  zone=z_register:10m rate=3r/h;    # register only
limit_req_zone  $binary_remote_addr  zone=z_refresh:10m  rate=20r/m;   # token refresh
limit_req_zone  $binary_remote_addr  zone=z_api:10m      rate=120r/m;  # all other API
limit_conn_zone $binary_remote_addr  zone=z_conn:10m;

# Slow HTTP / oversized payload protection
client_max_body_size    2m;     # .env files ≤ 1MB; crypto overhead gives ~1.4x; 2MB is safe ceiling
client_body_timeout     10s;    # close if body not fully received (Slowloris body variant)
client_header_timeout   10s;    # close if headers not fully received
send_timeout            30s;
keepalive_timeout       65s;
keepalive_requests      100;

# Return 429 (not 503) on rate limit — signals "slow down", not "server down"
limit_req_status  429;
limit_conn_status 429;

# Auth endpoints — strict
location ~ ^/api/auth/(login|2fa) {
    limit_req  zone=z_auth burst=5 nodelay;
    limit_conn z_conn 5;
    proxy_pass http://api/;
    # ... standard proxy headers
}

# Register
location /api/auth/register {
    limit_req  zone=z_register burst=2 nodelay;
    limit_conn z_conn 3;
    proxy_pass http://api/;
}

# Token refresh
location /api/auth/refresh {
    limit_req  zone=z_refresh burst=10 nodelay;
    limit_conn z_conn 10;
    proxy_pass http://api/;
}

# All other API
location /api/ {
    limit_req  zone=z_api burst=40 nodelay;
    limit_conn z_conn 20;
    proxy_pass http://api/;
}
```

`burst` allows a short spike above the rate (absorbs legitimate rapid clicks) without dropping the request — requests queue for up to burst slots, then `nodelay` means they are not delayed, they receive 429 immediately once burst is exhausted.

---

#### 3.10.3 fail2ban Rules

```ini
# /etc/fail2ban/filter.d/nginx-pwdsecure.conf
[Definition]
failregex = ^<HOST> .* "POST /api/auth/login.*" (401|429) .*$
            ^<HOST> .* "POST /api/auth/2fa.*" (401|429) .*$
ignoreregex =

# /etc/fail2ban/jail.d/nginx-pwdsecure.conf
[nginx-pwdsecure]
enabled   = true
port      = http,https
filter    = nginx-pwdsecure
logpath   = /var/log/nginx/access.log
maxretry  = 10
findtime  = 600     # 10 minutes
bantime   = 3600    # 1 hour initial ban
banaction = ufw
```

Escalating bans: fail2ban supports `bantime.increment = true` + `bantime.multiplier = 2` — first ban 1h, second 2h, third 4h, etc. A persistent attacker's ban time doubles each time.

---

#### 3.10.4 Application Layer: Progressive Login Delays

`@nestjs/throttler` handles hard rate limits. A separate mechanism in `AuthService` tracks login failures per `ip:email` combination in Redis and applies progressive server-side delays before returning a response — expensive for an attacker, invisible to legitimate users.

```typescript
// auth.service.ts — login failure tracking
const ATTEMPTS_KEY = (ip: string, email: string) => `login_fail:${ip}:${sha256(email).slice(0, 16)}`;

async function recordFailedAttempt(ip: string, email: string): Promise<number> {
  const key = ATTEMPTS_KEY(ip, email);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 900); // 15-min window
  return count;
}

async function getLoginDelay(ip: string, email: string): Promise<number> {
  const count = parseInt(await redis.get(ATTEMPTS_KEY(ip, email)) ?? '0');
  if (count <= 2) return 0;
  if (count <= 4) return 2000;   // 2s
  if (count <= 6) return 5000;   // 5s
  return 10000;                  // 10s — hard cap, still under client timeout
}

// In login handler:
const delay = await getLoginDelay(ip, email);
if (delay) await new Promise(resolve => setTimeout(resolve, delay));
// ... then validate credentials
// On success: DEL key
// On failure: increment + check if >= 10 → lock account + notify email
```

Account soft-lock at 10 failures: sets `user.lockedUntil = now + 30min`. Unlock happens automatically on expiry or via email verification link. Does not lock on IP alone — only when `ip:email` pair hits threshold, preventing DoS against arbitrary accounts.

---

#### 3.10.5 Proof of Work on Auth Endpoints (Optional, No Third Party)

PoW makes each login attempt computationally non-trivial — a browser solves it in < 200ms invisibly in a Web Worker. A bot attempting 1000 logins/second now needs to solve 1000 SHA-256 puzzles/second, which requires significant CPU and defeats casual flooding without CAPTCHA or any external service.

```
GET /auth/challenge → { challenge: "hex-64-chars", difficulty: 4, expiresAt: now+120s }
// Server stores { challenge, expiresAt } in Redis (TTL 120s, single-use)

POST /auth/login body includes: { ..., powChallenge: "...", powNonce: "..." }
// Server verifies: SHA-256(challenge + nonce).startsWith("0000") (difficulty 4 = 4 leading zero hex chars)
// Then deletes challenge from Redis (single-use)
```

```typescript
// packages/shared/src/pow.ts — runs in Web Worker in browser
export async function solvePoW(challenge: string, difficulty: number): Promise<string> {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    const input = challenge + nonce.toString();
    const hash = await sha256hex(input); // crypto.subtle.digest('SHA-256', ...)
    if (hash.startsWith(target)) return nonce.toString();
    nonce++;
  }
}
```

Difficulty 4 requires on average ~65,536 hash iterations (~50-150ms on modern hardware). Difficulty 5 requires ~1M iterations (~500ms-2s) — too much user friction. Keep at 4.

PoW is **optional** — activates only when `ENABLE_POW=true` in config. For a small self-hosted team, nginx rate limits + fail2ban may be sufficient. PoW adds value only when facing a determined distributed attacker with many IPs.

---

#### 3.10.6 Trusted Device Model

A "trusted device" is a browser or app instance that has previously authenticated successfully. New device detection enables two critical security behaviors: (a) user is immediately notified of unauthorized access attempts from unknown devices; (b) unrecognized devices face additional authentication friction.

**TrustedDevice entity:**

```typescript
@Entity({ tableName: 'trusted_devices' })
export class TrustedDevice {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  user!: User;

  // SHA-256 of the raw device_id cookie value (never stored plaintext)
  @Property({ unique: true, length: 64, hidden: true })
  deviceIdHash!: string;

  @Property({ length: 512 })
  userAgent!: string;

  @Property({ length: 255, nullable: true })
  friendlyName: string | null = null; // e.g. "Chrome on MacBook Pro" — derived from UA

  @Property({ length: 45 })
  registeredIp!: string;

  @Property({ length: 45 })
  lastSeenIp!: string;

  @Property()
  lastSeenAt: Date = new Date();

  @Property({ nullable: true })
  revokedAt: Date | null = null;

  @Property()
  registeredAt: Date = new Date();
}
```

**Device trust flow:**

```
New device login:
  1. No device_id cookie, or deviceIdHash not in trusted_devices for this user
  2. Credentials validate → JWT issued as normal
  3. Response includes: { ..., newDevice: true, deviceToken: "one-time-uuid" }
  4. Email sent asynchronously: "New login from Chrome on MacBook Pro (IP: x.x.x.x). Was this you?"
     Email includes: [Yes, this was me — trust this device] [No, revoke all sessions]
  5. Client shows: "New device detected. Register this device as trusted?"
     [Trust this device] → POST /auth/devices/register { deviceToken }
     → server creates TrustedDevice + sets device_id cookie (httpOnly, SameSite=Strict, 365-day expiry)
  6. Future logins from same device_id: no friction. Device silently recognized.

Vault unlock on new device:
  → 2FA required even if user has no 2FA enrolled (prompts for email OTP instead)
  → Prevents: attacker who stole session cookie from new device opening vault immediately
```

**New-device IP analysis:** If `registeredIp` country differs significantly from `lastSeenIp` (optional GeoIP enrichment), flag as higher-risk and require 2FA regardless of device trust status.

**Device management endpoints:**

```
GET  /auth/devices                # List trusted devices for current user
POST /auth/devices/register       # Register current device as trusted (consumes one-time deviceToken)
DELETE /auth/devices/:id          # Revoke specific trusted device
DELETE /auth/devices              # Revoke all trusted devices (emergency)
```

Device revocation is immediate — `revokedAt` set, device_id cookie treated as unknown on next request. Combined with session revocation (`DELETE /auth/sessions`), this provides full remote wipe of a compromised device.

---

