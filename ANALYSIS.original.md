# PwdSecure — Complete Technical Analysis

> Zero-knowledge self-hosted password manager + environment secrets vault with browser extension.
> Stack: NestJS 10 + Fastify · MikroORM 6 · PostgreSQL 16 · Redis 7 · Nuxt 4 · NuxtUI 4 · Pinia · MV3 Extension · Docker Compose

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Security Architecture](#3-security-architecture)
   - 3.1 Zero-Knowledge Model
   - 3.2 Client-Side Encryption (Argon2id + AES-256-GCM)
   - **3.3 Encryption & Decryption Lifecycle (Step-by-Step)** ← detailed flow
   - 3.4 Authentication Flow (JWT RS256)
   - 3.5 Two-Factor Authentication
   - 3.6 Security Headers
   - 3.7 Rate Limiting
   - 3.8 Threat Model
4. [Backend Architecture (NestJS 10 + Fastify)](#4-backend-architecture-nestjs-10--fastify)
5. [Database Layer (MikroORM 6 + PostgreSQL 16)](#5-database-layer-mikroorm-6--postgresql-16)
6. [Frontend Architecture (Nuxt 4 + NuxtUI 4 + Pinia)](#6-frontend-architecture-nuxt-4--nuxtui-4--pinia)
   - **6.7 Environment Secrets Management** ← ENV_FILE + SECRET entry types
7. [Browser Extension (Manifest V3)](#7-browser-extension-manifest-v3)
8. [Shared Package (`packages/shared`)](#8-shared-package-packagesshared)
9. [Infrastructure and DevOps](#9-infrastructure-and-devops)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Security Guarantees & Assurance Level](#11-security-guarantees--assurance-level)
12. [Attack Vectors — How an Attacker Could Steal Data](#12-attack-vectors--how-an-attacker-could-steal-data)
13. [Penetration Testing Plan](#13-penetration-testing-plan)
14. [UX Design — Mobile First](#14-ux-design--mobile-first)
15. [PWA vs Desktop App (Tauri) — Trade-off Analysis](#15-pwa-vs-desktop-app-tauri--trade-off-analysis)

---

## 1. Executive Summary

This document describes the architecture, security model, and implementation strategy for a self-hosted, zero-knowledge password manager. The system is designed for personal use with a strong emphasis on verifiable security properties: at no point does the server have access to plaintext credentials, master passwords, or derived encryption keys. All sensitive data is encrypted client-side before transmission, and the server operates exclusively on opaque ciphertext.

The term "zero-knowledge" in this context carries a specific, grounded meaning: the server's knowledge is bounded by what is mathematically necessary to perform its coordination role. It stores encrypted blobs, authentication artifacts, and non-sensitive metadata. Even an operator with full database access cannot recover vault contents without the user's master password, which never leaves the client.

### Why Zero-Knowledge Matters

Hosted password managers present an architectural trust problem. When a third-party service stores your credentials, you are trusting not only their security posture but their honesty, their supply chain, and the integrity of every person with database access. Breaches at LastPass (2022), where encrypted vaults were exfiltrated alongside iteration counts low enough to enable offline cracking, demonstrated that vendor-side encryption with server-held KDF parameters is insufficient. A properly implemented zero-knowledge architecture renders a database breach informationally useless to an attacker: they obtain ciphertext with no path to plaintext short of compromising the user's master password directly.

Self-hosting eliminates the vendor trust surface entirely. The operator and the user are the same person. Threat modeling shifts from "can I trust this company" to "can I secure my own infrastructure," which is a tractable problem for a technically capable individual.

### Key Differentiators

Compared to Bitwarden, the dominant open-source alternative, this system differs in scope and design philosophy. Bitwarden's self-hosted deployment carries significant operational overhead (multiple services, SQL Server historically, organizational complexity). This system targets a single-user deployment on a personal VPS, optimized for low resource consumption and operational simplicity via Docker Compose. The extension ships from day one as a first-class client, not an afterthought.

Compared to 1Password, which uses a dual-key derivation model (master password + per-account secret key), this system's security model is simpler but sufficient for a personal deployment. 1Password's Secret Key addresses the risk of weak master passwords in a multi-tenant environment; in a personal self-hosted context, physical infrastructure control provides an equivalent mitigation.

The browser extension uses Manifest V3, the current and future-required extension platform for both Chrome and Firefox. Many competing open-source tools still ship MV2 extensions facing imminent deprecation. The extension shares cryptographic logic with the web application through a shared package in the monorepo, ensuring a single, auditable implementation of all security-critical code.

### Scope

This is a personal-use system: one user, self-hosted, with full control over the deployment environment. It is not designed for team vaults, organizational access control, or multi-user sharing. The constraints this imposes (no server-side re-encryption delegation, no key escrow, no admin recovery) are features: they eliminate entire attack surfaces.

---

## 2. System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│                                                                 │
│  ┌──────────────────┐          ┌──────────────────────────────┐ │
│  │ Browser Extension│          │      Web App (Nuxt 4)        │ │
│  │  (MV3 Chrome/FF) │          │  Pinia · NuxtUI · Tailwind   │ │
│  └────────┬─────────┘          └─────────────┬────────────────┘ │
│           │  HTTPS (JWT Bearer)               │  HTTPS           │
└───────────┼──────────────────────────────────┼─────────────────┘
            │                                  │
            ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    nginx (reverse proxy)                        │
│          TLS termination · Security headers · Real-IP forwarding│
└──────────────────────────────┬──────────────────────────────────┘
                               │  HTTP (internal)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  NestJS 10 API (Fastify adapter)                 │
│   Auth · Vault · 2FA · AuditInterceptor · ThrottlerGuard        │
└──────────┬───────────────────────────────────┬──────────────────┘
           │  MikroORM 6                        │  ioredis
           ▼                                   ▼
┌─────────────────────┐             ┌──────────────────────┐
│   PostgreSQL 16      │             │      Redis 7          │
│  Encrypted blobs     │             │  Rate-limit counters  │
│  Hashed auth tokens  │             │  (no vault data)      │
│  TOTP / WebAuthn     │             └──────────────────────┘
└─────────────────────┘
```

### Technology Stack and Rationale

| Component | Choice | Rationale |
|-----------|--------|-----------|
| API Framework | NestJS 10 + Fastify | NestJS provides a structured, module-based architecture that prevents the sprawl common in plain Express projects. Fastify delivers measurably higher throughput than Express (2–3x req/s) and has superior TypeScript integration. Fastify's schema-based serialization reduces the risk of leaking unexpected fields in JSON responses. |
| ORM | MikroORM 6 | MikroORM's Unit of Work pattern provides transactional consistency guarantees that are critical when atomically updating a vault entry alongside its IV and auth tag. Prisma's query engine is a separate binary (operational overhead, cold start on constrained VPS). Drizzle lacks the UoW abstraction. MikroORM's code-first approach means entities are the source of truth, eliminating schema drift. |
| Database | PostgreSQL 16 | JSONB support, mature full-text capabilities, row-level locking, and battle-tested reliability. PostgreSQL's WAL-based durability and concurrency model are preferable for a persistent service even at small scale. |
| Cache / Rate Limiting | Redis 7 | Provides atomic increment operations (INCR + EXPIRE) for rate-limit counters via a single RTT. No vault data ever enters Redis. |
| Auth | JWT RS256 | Asymmetric signing means the private key lives only on the API server. The public key can be embedded in the browser extension at build time, enabling offline token verification without a network round-trip. HS256 would require sharing the secret with any consumer, granting it token-forging capability. |
| Password Hashing / KDF | Argon2id | Winner of the Password Hashing Competition (2015). Argon2id combines Argon2i's side-channel resistance with Argon2d's GPU attack resistance. Bcrypt and PBKDF2 are significantly weaker against modern GPU-based offline attacks at equivalent cost. |
| Frontend | Nuxt 4 + NuxtUI 4 | Nuxt's file-system routing and hybrid SSR reduce boilerplate. NuxtUI 4 provides accessible, composable components with Tailwind CSS integration. Pinia is Nuxt's recommended state manager and is used for in-memory key storage. |
| Extension | MV3 (Chrome + Firefox) | MV3 is mandatory for new Chrome extensions and imminent for Firefox. Building on MV3 from the start avoids a future forced migration. |
| Crypto | Web Crypto API (browser) | Native browser implementation, hardware-accelerated on supported platforms, non-extractable `CryptoKey` objects prevent key exfiltration via JavaScript. No third-party crypto library required for AES-GCM operations. |

### Monorepo Structure

The project uses pnpm workspaces with the following layout:

```
/
├── apps/
│   ├── api/          # NestJS 10 application
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   ├── vault/
│   │   │   ├── users/
│   │   │   └── common/
│   │   └── test/
│   ├── web/          # Nuxt 4 application (PWA — Android, browser, desktop browser)
│   │   └── app/
│   │       ├── pages/
│   │       ├── components/
│   │       └── stores/       # Pinia (key storage, auth)
│   ├── mobile/       # Capacitor wrapper (iOS primary, Android optional)
│   │   ├── ios/              # Xcode project (WKWebView + native plugins)
│   │   ├── android/          # Android Studio project
│   │   └── capacitor.config.ts
│   ├── desktop/      # Tauri wrapper (macOS / Windows / Linux)
│   │   └── src-tauri/        # Rust: keychain, screen lock, global shortcut
│   └── extension/    # MV3 extension (Chrome + Firefox autofill)
│       ├── background/
│       ├── popup/
│       └── content/
├── packages/
│   └── shared/       # Shared across ALL apps — single source of truth for crypto
│       ├── crypto/           # Argon2id + AES-GCM wrappers
│       ├── types/            # Vault entry schemas, message bus types
│       └── validation/       # validateMasterPassword, isBreachedPassword
├── docker-compose.yml
├── docker-compose.prod.yml
└── pnpm-workspace.yaml
```

The `packages/shared` package is the most security-sensitive artifact in the repository. All cryptographic operations — key derivation, encryption, decryption — are implemented once here and consumed by both the web app and extension. This eliminates the risk of divergent crypto implementations between clients.

### Data Flow: Master Password to Encrypted Blob

When a user creates or updates a vault entry, the following sequence executes entirely on the client before any data is transmitted:

1. The user enters their master password during login. The application fetches the user's `kdfSalt` from the login response (a 16-byte random value generated at registration, stored in plaintext in the DB, non-secret).

2. Argon2id derives a 256-bit `masterKey` from `masterPassword + kdfSalt` using the configured parameters. This operation runs in the browser and produces a raw key buffer.

3. The raw buffer is imported into the Web Crypto API as an `AES-GCM` `CryptoKey` with `extractable: false`. This key object cannot be read back from JavaScript — it lives in the browser's crypto subsystem and can only be used for encrypt/decrypt operations.

4. The `CryptoKey` is stored in Pinia's in-memory store. It persists only for the session lifetime and is cleared on logout or inactivity lock.

5. When saving a vault entry, a 96-bit (12-byte) random IV is generated via `crypto.getRandomValues()`. The plaintext entry JSON (URL, username, password, notes) is encrypted with `AES-256-GCM` using the `masterKey` and the fresh IV, producing a ciphertext and 128-bit authentication tag.

6. The ciphertext, IV, and auth tag are serialized and transmitted to the API as a JSON payload. The server stores the blob opaquely — it performs no inspection of the content.

7. On retrieval, the reverse path executes: the server returns the ciphertext, the client decrypts it using the in-memory `CryptoKey`, and the plaintext is rendered.

The server never sees the master password, the derived key, or any plaintext vault content.

---

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

## 4. Backend Architecture (NestJS 10 + Fastify)

### 4.1 NestJS + Fastify Adapter

NestJS ships with Express as its default HTTP platform, but the Fastify adapter is the correct choice for a security-sensitive application that demands both throughput and a disciplined plugin architecture. Fastify benchmarks consistently show 20–35% higher requests-per-second versus Express under identical workloads, primarily because its request/response lifecycle avoids the middleware chain overhead and leverages JSON schema-based serialization through `fast-json-stringify`.

Bootstrap configuration registers four core Fastify plugins before the application starts listening:

```typescript
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ logger: true }),
);

await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      objectSrc: ["'none'"],
    },
  },
});

await app.register(fastifyCors, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [],
  credentials: true,
});

await app.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET,
});

await app.register(fastifyRateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis: redisClient,
});
```

`@fastify/cors` is configured with an explicit allowlist rather than a wildcard, enforcing `credentials: true` to permit the httpOnly refresh token cookie to flow across the frontend origin. `@fastify/rate-limit` is backed by Redis so rate limit state is shared across all application instances.

### 4.2 Module Structure

The application is composed of six top-level feature modules plus one infrastructure provider module.

**AuthModule** is the most complex module in the system. It exposes endpoints for account registration, login, token refresh, logout, and two second-factor flows: TOTP and WebAuthn. Login is a multi-step flow: credentials are validated, then if a second factor is enrolled, the endpoint returns a short-lived challenge token scoped only to the 2FA verification endpoint rather than issuing a full access token. This prevents partial authentication states from being exploited.

**VaultModule** manages the encrypted entry lifecycle. Entries arrive from the client already encrypted; the server stores ciphertext, IV, authentication tag, and a label hash. CRUD operations are scoped strictly to the authenticated user's entries — no cross-user access is architecturally possible because all queries are parameterized by `userId` extracted from the validated JWT.

**UsersModule** exposes profile read and update, the active session list (derived from non-expired `RefreshToken` rows), and account deletion. Deletion is a hard delete that cascades through FK constraints to vault entries, refresh tokens, WebAuthn credentials, and audit logs.

**AuditModule** is not a feature module with its own routes. Instead, it exports `AuditInterceptor`, registered globally, which captures every mutating HTTP request. The interceptor resolves the authenticated `userId`, the target endpoint, the outcome (success or failure), and the client IP address. These are written to the `AuditLog` entity through a separate forked `EntityManager` to avoid contaminating the request's Unit of Work with audit concerns.

**HealthModule** exposes a single `/health` endpoint that performs both a liveness check (process is alive) and a readiness check (PostgreSQL query succeeds, Redis `PING` returns `PONG`).

**CryptoModule** is a pure provider module with no controllers. It exports `CryptoService`, which wraps `argon2` (for server-side password hashing) and `crypto` (Node built-ins for SHA-256 token hashing). The server never touches vault encryption keys — Argon2id here applies only to the authentication password.

### 4.3 Guards and Interceptors

**JwtAuthGuard** extends NestJS's `AuthGuard('jwt')` and uses `@nestjs/passport` with `passport-jwt` configured for RS256 signature verification. The public key is loaded from the environment at startup and cached. On successful verification, the guard extracts `userId` and `email` from the token payload and attaches them to `request.user`. Token expiry is enforced by the JWT library; the guard performs no database lookup on the hot path.

**RefreshGuard** handles the token rotation flow. It reads the `refreshToken` cookie, computes its SHA-256 hash, and queries `RefreshToken` where `tokenHash = hash AND expiresAt > now AND revokedAt IS NULL`. Family-based rotation detection is also implemented here: if a previously rotated token is presented, the entire family is revoked.

**TwoFactorGuard** is applied selectively on endpoints requiring a fully authenticated session. It reads `twoFactorPassed: boolean` from the JWT payload. If the user has TOTP or WebAuthn enabled and the flag is false, the guard rejects the request with 403.

**AuditInterceptor** implements `NestInterceptor` and uses `rxjs` `tap` to observe both the successful response and any thrown exception. Writing audit records in `tap` keeps audit logic decoupled from business logic.

**TransformInterceptor** strips `@Property({ hidden: true })` fields that MikroORM would otherwise serialize, ensuring fields like `passwordHash`, `totpSecretEncrypted`, and `tokenHash` never appear in any API response.

### 4.4 REST API Endpoint Design

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | None | Register new account, return access token + set refresh cookie |
| POST | `/auth/login` | None | Credential validation, return challenge token if 2FA enrolled |
| POST | `/auth/2fa/totp/verify` | Challenge token | Verify TOTP code, issue full access + refresh tokens |
| POST | `/auth/2fa/totp/setup` | JWT | Generate TOTP secret, return QR URI |
| POST | `/auth/2fa/totp/enable` | JWT | Confirm setup with valid code, set `totpEnabled = true` |
| POST | `/auth/2fa/totp/disable` | JWT + 2FA | Disable TOTP, revoke all sessions |
| POST | `/auth/webauthn/register/begin` | JWT | Return WebAuthn registration options (challenge) |
| POST | `/auth/webauthn/register/complete` | JWT | Verify and store credential |
| POST | `/auth/webauthn/authenticate/begin` | None | Return authentication options for a given email |
| POST | `/auth/webauthn/authenticate/complete` | None | Verify assertion, issue tokens |
| POST | `/auth/refresh` | Refresh cookie | Rotate refresh token, issue new access token |
| POST | `/auth/logout` | JWT | Revoke current refresh token |
| POST | `/auth/logout/all` | JWT + 2FA | Revoke all refresh tokens for user |
| GET | `/groups` | JWT | List user's groups (owned + member of) |
| POST | `/groups` | JWT | Create group — client sends `encryptedGroupKey` + `groupKeyIv` (groupKey generated client-side) |
| GET | `/groups/:id` | JWT | Group detail + member list |
| PATCH | `/groups/:id` | JWT + 2FA | Update group name/color/icon |
| DELETE | `/groups/:id` | JWT + 2FA | Delete group and all its secrets |
| GET | `/groups/:id/secrets` | JWT + 2FA | List secrets in group (cursor paginated; filter by `secretType`) |
| POST | `/groups/:id/secrets` | JWT + 2FA | Create secret (PASSWORD or FILE) |
| GET | `/groups/:groupId/secrets/:id` | JWT + 2FA | Get single secret |
| PUT | `/groups/:groupId/secrets/:id` | JWT + 2FA | Full update — increments `version`, snapshots old blob |
| PATCH | `/groups/:groupId/secrets/:id` | JWT + 2FA | Partial update (metadata only, e.g. environment tag) |
| DELETE | `/groups/:groupId/secrets/:id` | JWT + 2FA | Delete secret (cascades to versions) |
| GET | `/groups/:groupId/secrets/:id/versions` | JWT + 2FA | List version metadata (no encrypted content) |
| GET | `/groups/:groupId/secrets/:id/versions/:v` | JWT + 2FA | Get specific encrypted version blob |
| POST | `/groups/:groupId/secrets/:id/restore/:v` | JWT + 2FA | Restore version v (creates new head, history retained) |
| POST | `/groups/:id/rotate-key` | JWT + 2FA (OWNER/ADMIN) | Remove member + atomic re-key: new groupKey, all secrets re-encrypted, remaining memberships updated |
| GET | `/auth/challenge` | None | Issue PoW challenge (optional, when ENABLE_POW=true) |
| GET | `/auth/devices` | JWT | List trusted devices for current user |
| POST | `/auth/devices/register` | JWT | Register current browser as trusted device (consumes one-time token) |
| DELETE | `/auth/devices/:id` | JWT | Revoke specific trusted device |
| DELETE | `/auth/devices` | JWT + 2FA | Revoke all trusted devices (emergency) |
| GET | `/users/me` | JWT | Get profile (email, kdfSalt, 2FA status) |
| PATCH | `/users/me` | JWT + 2FA | Update email or auth password |
| GET | `/users/me/sessions` | JWT | List active refresh token sessions |
| DELETE | `/users/me/sessions/:id` | JWT | Revoke specific session |
| DELETE | `/users/me` | JWT + 2FA | Delete account and all associated data |
| GET | `/health` | None | Liveness + readiness check |

Key request/response shapes:

```typescript
// POST /groups — Request (client generates groupKey, encrypts it with userKey)
{
  "name": "Work",
  "color": "#6366f1",
  "icon": "briefcase",
  "encryptedGroupKey": "base64-aes-gcm-ciphertext",
  "groupKeyIv": "base64-12-bytes"
}

// POST /groups/:id/secrets — Request
// AAD for encryptedData:     `${groupId}:${secretId}` (use server-assigned ID from 201 response; or client-generated UUID)
// AAD for encryptedMetadata: `${groupId}:${secretId}:meta`
{
  "encryptedData": "base64-aes-gcm-ciphertext",   // AES-GCM(groupKey, plaintext, aad=`groupId:secretId`)
  "iv": "base64-12-bytes",
  "authTag": "base64-16-bytes",
  "secretType": "PASSWORD",                        // or "FILE"
  "labelHash": "sha256-hex",
  "encryptedMetadata": "base64-aes-gcm-ciphertext", // AES-GCM(groupKey, metadata, aad=`groupId:secretId:meta`)
  "metadataIv": "base64-12-bytes"                   // null if no metadata
}

// POST /groups/:id/secrets — Response 201
{
  "id": "uuid",
  "secretType": "PASSWORD",
  "labelHash": "sha256-hex",
  "version": 1,
  "metadata": { "domain": "github.com" },
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z"
}

// GET /groups/:id/secrets?cursor=base64cursor&limit=50&type=PASSWORD — Response 200
{
  "data": [ /* array of secret summaries (no encryptedData) */ ],
  "nextCursor": "base64-encoded-next-cursor | null",
  "hasMore": true
}
```

### 4.5 Validation Pipeline

All incoming data passes through NestJS's `ValidationPipe` registered globally with strict settings:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }),
);
```

`whitelist: true` strips any properties not declared in the DTO. `forbidNonWhitelisted: true` rejects requests that include undeclared properties with a 400 — this prevents parameter pollution attacks.

```typescript
export class CreateVaultEntryDto {
  @IsNotEmpty()
  @IsBase64()
  encryptedData: string;

  @IsNotEmpty()
  @IsBase64()
  @MaxLength(24) // 12 bytes base64-encoded
  iv: string;

  @IsNotEmpty()
  @IsBase64()
  @MaxLength(24) // 16 bytes base64-encoded
  authTag: string;

  @IsEnum(EntryType)
  entryType: EntryType;

  @IsNotEmpty()
  @IsBase64()
  @MaxLength(64)
  labelHash: string;
}
```

### 4.6 Error Handling

A global exception filter normalizes all errors into a consistent response envelope:

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message ?? message;
      }
    }

    // In production, never expose exception details for 5xx errors
    if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
      message = 'Internal server error';
    }

    response.status(statusCode).send({ statusCode, message });
  }
}
```

For authentication failures the server returns identical 401 responses for "user not found" and "wrong password" to prevent user enumeration.

---

## 5. Database Layer (MikroORM 6 + PostgreSQL 16)

### 5.1 MikroORM 6 — Unit of Work Pattern

The Unit of Work pattern is the conceptual core of MikroORM's design and the primary reason it was chosen over Prisma or Drizzle for this project. MikroORM tracks all entities loaded or created within the scope of a request through an identity map — a per-request registry that maps entity identity to a single in-memory instance. Mutations to those instances are tracked as "dirty" diffs. Only when `EntityManager.flush()` is called does MikroORM compute the minimal set of SQL statements required to synchronize in-memory state to the database, wrapping them in a single transaction.

For a password manager backend, this behavior has concrete benefits. A login flow that loads a `User`, updates `lastLoginAt`, creates a `RefreshToken`, and potentially writes an `AuditLog` produces exactly one transaction on `flush()`, with all four operations atomic.

The comparison with alternatives is instructive: Prisma operates on a query-builder model where each call is a discrete database operation, offering no identity map or automatic change tracking. Drizzle is a thin SQL-builder DSL with no ORM semantics at all. MikroORM's explicit transaction API makes it the most appropriate choice for a domain with strict data integrity requirements.

In NestJS, `EntityManager` is scoped per request using `@mikro-orm/nestjs`'s request context middleware:

```typescript
// main.ts — register MikroORM request context middleware
app.use((req, res, next) => {
  RequestContext.create(orm.em, next);
});
```

### 5.2 Entity Definitions

```typescript
// user.entity.ts
@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ unique: true, length: 320 })
  email!: string;

  @Property({ hidden: true, length: 255 })
  passwordHash!: string; // Argon2id hash of auth password

  @Property({ length: 64 })
  kdfSalt!: string; // hex-encoded 32 bytes, non-secret, sent to client for vault key derivation

  @Property({ nullable: true, hidden: true, length: 512 })
  totpSecretEncrypted: string | null = null; // AES-256-GCM encrypted TOTP secret

  @Property({ default: false })
  totpEnabled: boolean = false;

  @OneToMany(() => Group, (g) => g.owner, { cascade: [Cascade.REMOVE] })
  ownedGroups = new Collection<Group>(this);

  @OneToMany(() => GroupMembership, (m) => m.user, { cascade: [Cascade.REMOVE] })
  groupMemberships = new Collection<GroupMembership>(this);

  @OneToMany(() => RefreshToken, (t) => t.user, { cascade: [Cascade.REMOVE] })
  refreshTokens = new Collection<RefreshToken>(this);

  @OneToMany(() => WebAuthnCredential, (c) => c.user, { cascade: [Cascade.REMOVE] })
  webAuthnCredentials = new Collection<WebAuthnCredential>(this);

  @OneToMany(() => TrustedDevice, (d) => d.user, { cascade: [Cascade.REMOVE] })
  trustedDevices = new Collection<TrustedDevice>(this);

  @OneToMany(() => AuditLog, (a) => a.user, { cascade: [Cascade.REMOVE] })
  auditLogs = new Collection<AuditLog>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
```

```typescript
// refresh-token.entity.ts
@Entity({ tableName: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  user!: User;

  @Property({ unique: true, length: 64, hidden: true })
  tokenHash!: string; // SHA-256 hex of the raw refresh token

  @Property({ type: 'uuid' })
  familyId!: string; // Groups token rotation chain; full family revoked on reuse detection

  @Property({ nullable: true })
  revokedAt: Date | null = null;

  @Property()
  expiresAt!: Date; // now + 7 days at issuance

  @Property({ length: 45 })
  ipAddress!: string;

  @Property({ length: 512 })
  userAgent!: string;

  @Property()
  createdAt: Date = new Date();
}
```

```typescript
// group.entity.ts
@Entity({ tableName: 'groups' })
export class Group {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  owner!: User;

  @Property({ length: 255 })
  name!: string; // plaintext — group names are non-sensitive folder labels

  @Property({ nullable: true, length: 7 })
  color: string | null = null; // hex color, e.g. '#6366f1'

  @Property({ nullable: true, length: 64 })
  icon: string | null = null; // icon identifier for UI

  @OneToMany(() => GroupMembership, (m) => m.group, { cascade: [Cascade.REMOVE] })
  memberships = new Collection<GroupMembership>(this);

  @OneToMany(() => Secret, (s) => s.group, { cascade: [Cascade.REMOVE] })
  secrets = new Collection<Secret>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
```

```typescript
// group-membership.entity.ts
export enum GroupRole {
  OWNER  = 'OWNER',
  ADMIN  = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

@Entity({ tableName: 'group_memberships' })
@Unique({ properties: ['group', 'user'] })
export class GroupMembership {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => Group, { onDelete: 'cascade' })
  group!: Group;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  user!: User;

  @Enum(() => GroupRole)
  role: GroupRole = GroupRole.MEMBER;

  // Group key encrypted with this member's vault key (AES-256-GCM).
  // Decrypted client-side: userKey → groupKey → secrets.
  // On member invite: owner re-encrypts groupKey with invitee's key.
  @Property({ type: 'text' })
  encryptedGroupKey!: string; // base64 AES-256-GCM ciphertext

  @Property({ length: 24 })
  groupKeyIv!: string; // base64 12-byte nonce for encryptedGroupKey

  @Property()
  joinedAt: Date = new Date();
}
```

```typescript
// secret.entity.ts
export enum SecretType {
  PASSWORD = 'PASSWORD', // login creds, credit card, note, identity — subtype encoded in encrypted payload
  FILE     = 'FILE',     // .env file, certificate, binary — filename/env in metadata (plaintext)
}

@Entity({ tableName: 'secrets' })
export class Secret {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => Group, { onDelete: 'cascade' })
  group!: Group;

  @Property({ type: 'text' })
  encryptedData!: string; // Base64 AES-256-GCM ciphertext encrypted with groupKey

  @Property({ length: 24 })
  iv!: string; // Base64 12-byte nonce

  @Property({ length: 24 })
  authTag!: string; // Base64 16-byte GCM auth tag

  @Enum(() => SecretType)
  secretType!: SecretType;

  @Property({ length: 64 })
  labelHash!: string; // SHA-256 hex of plaintext label (server-side search, no plaintext)

  // Metadata encrypted with groupKey (AES-256-GCM, same AAD: `${groupId}:${secretId}:meta`).
  // FILE payload: { filename, fileSizeBytes, mimeType?, environment? }
  // PASSWORD payload: { domain?, favicon? }
  // Decrypted client-side; server stores opaque blob.
  @Property({ type: 'text', nullable: true })
  encryptedMetadata: string | null = null; // base64 AES-GCM ciphertext

  @Property({ length: 24, nullable: true })
  metadataIv: string | null = null; // base64 12-byte nonce; null iff encryptedMetadata is null

  @Property({ default: 1 })
  version: number = 1; // incremented on every encrypted update

  @OneToMany(() => SecretVersion, (v) => v.secret, { cascade: [Cascade.REMOVE] })
  versions = new Collection<SecretVersion>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
```

```typescript
// secret-version.entity.ts
@Entity({ tableName: 'secret_versions' })
export class SecretVersion {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => Secret, { onDelete: 'cascade' })
  secret!: Secret;

  @Property({ type: 'text' })
  encryptedData!: string;

  @Property({ length: 24 })
  iv!: string;

  @Property({ length: 24 })
  authTag!: string;

  @Property()
  version!: number;

  @Property({ length: 255, nullable: true })
  changeNote: string | null = null; // e.g. 'Rotated after prod deployment'

  @Property()
  createdAt: Date = new Date();
}
```

```typescript
// webauthn-credential.entity.ts
@Entity({ tableName: 'webauthn_credentials' })
export class WebAuthnCredential {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade' })
  user!: User;

  @Property({ unique: true, type: 'text' })
  credentialId!: string; // Base64url-encoded credential ID from authenticator

  @Property({ type: 'text', hidden: true })
  publicKey!: string; // COSE-encoded public key, base64url

  @Property({ default: 0 })
  signCount!: number; // Monotonic counter for clone detection

  @Property({ length: 64 })
  aaguid!: string;

  @Property({ length: 255 })
  friendlyName!: string; // User-provided label, e.g. "YubiKey 5C"

  @Property({ nullable: true })
  lastUsedAt: Date | null = null;

  @Property()
  createdAt: Date = new Date();
}
```

```typescript
// audit-log.entity.ts
export enum AuditAction {
  LOGIN_SUCCESS      = 'LOGIN_SUCCESS',
  LOGIN_FAILURE      = 'LOGIN_FAILURE',
  REGISTER           = 'REGISTER',
  LOGOUT             = 'LOGOUT',
  GROUP_CREATE       = 'GROUP_CREATE',
  GROUP_UPDATE       = 'GROUP_UPDATE',
  GROUP_DELETE       = 'GROUP_DELETE',
  GROUP_MEMBER_ADD   = 'GROUP_MEMBER_ADD',
  GROUP_MEMBER_REMOVE = 'GROUP_MEMBER_REMOVE',
  SECRET_CREATE      = 'SECRET_CREATE',
  SECRET_READ        = 'SECRET_READ',
  SECRET_UPDATE      = 'SECRET_UPDATE',
  SECRET_DELETE      = 'SECRET_DELETE',
  SECRET_VERSION_RESTORE = 'SECRET_VERSION_RESTORE',
  PASSWORD_CHANGE    = 'PASSWORD_CHANGE',
  TOTP_ENABLE        = 'TOTP_ENABLE',
  TOTP_DISABLE       = 'TOTP_DISABLE',
  WEBAUTHN_REGISTER  = 'WEBAUTHN_REGISTER',
  SESSION_REVOKE     = 'SESSION_REVOKE',
  DEVICE_TRUST       = 'DEVICE_TRUST',
  DEVICE_REVOKE      = 'DEVICE_REVOKE',
  NEW_DEVICE_ALERT   = 'NEW_DEVICE_ALERT',
  ACCOUNT_DELETE     = 'ACCOUNT_DELETE',
}

@Entity({ tableName: 'audit_logs' })
export class AuditLog {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, { onDelete: 'cascade', nullable: true })
  user: User | null = null; // nullable for failed login attempts with unknown email

  @Enum(() => AuditAction)
  action!: AuditAction;

  @Property({ length: 45 })
  ipAddress!: string;

  @Property({ length: 512 })
  userAgent!: string;

  @Property({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null = null; // non-sensitive context

  @Property()
  createdAt: Date = new Date();
}
```

### 5.3 Indexes and Constraints

| Index | Type | Query it serves |
|-------|------|-----------------|
| `users.email` | Unique B-tree | Login and registration lookup |
| `refresh_tokens.tokenHash` | Unique B-tree | Every refresh request lookup (sub-ms) |
| `refresh_tokens.(familyId, userId)` | Composite B-tree | Family revocation on token reuse detection |
| `group_memberships.(groupId, userId)` | Unique composite | Membership existence check + group access guard |
| `group_memberships.(userId)` | B-tree | List all groups for a user |
| `secrets.(groupId, createdAt)` | Composite B-tree | Cursor pagination: `WHERE groupId = $1 AND createdAt > $2` |
| `secrets.labelHash` | B-tree | Label search within a group (server-side, no plaintext) |
| `secret_versions.(secretId, version)` | Composite B-tree | Version history lookup + restore |
| `audit_logs.(userId, createdAt)` | Composite B-tree | Audit history in reverse chronological order |

All foreign key relationships are defined with `ON DELETE CASCADE` at the database level. The `pgcrypto` extension provides `gen_random_uuid()`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 5.4 Migration Strategy

MikroORM's migration system generates versioned SQL files from entity diff detection:

```bash
# Generate a new migration from entity changes
npx mikro-orm migration:create --name descriptive-name

# Apply pending migrations
npx mikro-orm migration:up
```

Migration files live in `apps/api/src/migrations/` and follow the naming convention `Migration{timestamp}_{name}.ts`. Generated migrations are committed to version control and treated as immutable once applied to any non-development environment.

In development, the NestJS application runs `orm.getMigrator().up()` on startup. In production, migrations run as a pre-start step in the container entrypoint:

```sh
#!/bin/sh
set -e
echo "Running database migrations..."
npx mikro-orm migration:up
echo "Migrations complete. Starting server..."
exec node dist/main.js
```

### 5.5 Cursor Pagination for Vault

Offset-based pagination degrades in two ways for a vault workload: deep pages become increasingly expensive as the database must scan and discard rows, and concurrent writes cause rows to shift position, causing entries to be skipped or duplicated across pages.

Cursor pagination anchors page position to a stable row value. The cursor encodes the `createdAt` timestamp of the last entry on the previous page. The next-page query becomes a range predicate:

```sql
SELECT * FROM secrets
WHERE group_id = $1 AND created_at > $2
ORDER BY created_at ASC
LIMIT 51; -- fetch one extra to determine hasMore
```

The `(userId, createdAt)` composite index makes this query a single index scan regardless of vault size. Fetching 51 rows when the page size is 50 allows the API to determine whether a next page exists.

```typescript
function encodeCursor(date: Date): string {
  return Buffer.from(date.toISOString()).toString('base64url');
}

function decodeCursor(cursor: string): Date {
  return new Date(Buffer.from(cursor, 'base64url').toString('utf-8'));
}
```

---

## 6. Frontend Architecture (Nuxt 4 + NuxtUI 4 + Pinia)

### 6.1 Nuxt 4 Setup

Nuxt 4 introduces a mandatory `app/` directory convention. All pages, components, composables, stores, and assets live under `app/`, keeping the project root clean for configuration and Docker files.

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  future: { compatibilityVersion: 4 },

  modules: ['@nuxt/ui', '@pinia/nuxt'],

  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? 'http://localhost/api',
    },
  },

  app: {
    head: {
      meta: [
        {
          'http-equiv': 'Content-Security-Policy',
          content: [
            "default-src 'self'",
            "script-src 'self' 'wasm-unsafe-eval'",  // Argon2id WASM requires this
            "style-src 'self' 'unsafe-inline'",
            "connect-src 'self'",
            "img-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
          ].join('; '),
        },
      ],
    },
  },

  ssr: true,
});
```

SSR is enabled globally but vault pages opt out via `definePageMeta({ ssr: false })`. This is a security boundary: Web Crypto operations must run in the browser context where the user's key material exists. SSR rendering vault content on the server would require transmitting decrypted data to the server or bypassing encryption entirely — both unacceptable.

### 6.2 Page Structure and Routing

```
app/pages/
├── index.vue                                    # Redirects to /vault
├── auth/
│   ├── login.vue                                # Email + password, TOTP if enabled
│   ├── register.vue                             # Email + master password, KDF salt generated here
│   └── setup-2fa.vue                            # QR code display, TOTP code verification, recovery codes
├── vault/
│   ├── index.vue                                # Groups list (sidebar layout root)
│   ├── [groupId]/
│   │   ├── index.vue                            # Secrets list: search, type filter (PASSWORD/FILE), pagination
│   │   └── [secretId].vue                       # Secret detail: inline edit, reveal fields, copy, version history
│   └── new-group.vue                            # Create group modal/page
├── generator.vue                                # Standalone password generator (no auth required)
└── settings/
    ├── index.vue                                # Display name, email change
    ├── security.vue                             # 2FA management, active sessions, per-session revocation
    └── danger.vue                               # Account deletion with master password confirmation
```

`/vault/index.vue` is the application's primary working surface. It fetches the entry list (label hashes only from the server), decrypts labels client-side to populate the table, and supports real-time filtering without round-trips because all decrypted labels are held in `useVaultStore`.

`/vault/[id].vue` handles both view and edit modes in the same route. Sensitive fields (password, card number, notes) render as masked inputs by default. Each field has a copy button that writes to the clipboard and schedules a 30-second clearance via `setTimeout(() => navigator.clipboard.writeText(''), 30000)`.

`/auth/setup-2fa.vue` is a post-login flow gated by a short-lived setup token. It calls `GET /auth/2fa/setup` to receive the TOTP secret, renders it as a QR code using `qrcode` (client-side), verifies a user-provided TOTP code to confirm correct scanner setup, and displays the eight recovery codes exactly once. A mandatory acknowledgment checkbox is required before the user can proceed.

`/settings/danger.vue` requires re-entry of the master password before the account deletion API call. The master password is re-derived to verify it is correct (by attempting to decrypt one vault entry), then the deletion request is submitted.

### 6.3 Pinia Stores

```typescript
// stores/auth.ts
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<User | null>(null);
  const isAuthenticated = computed(() => accessToken.value !== null);

  async function login(email: string, password: string, totpCode?: string) {
    const data = await $fetch<AuthTokens>('/auth/login', {
      method: 'POST',
      body: { email, password, totpCode },
    });
    accessToken.value = data.accessToken;
    user.value = data.user;
  }

  async function refreshToken() {
    // Cookie is sent automatically (httpOnly, SameSite=Strict)
    const data = await $fetch<AuthTokens>('/auth/refresh', { method: 'POST' });
    accessToken.value = data.accessToken;
  }

  function logout() {
    accessToken.value = null;
    user.value = null;
    useVaultStore().clear();
    useCryptoStore().lock();
  }

  return { accessToken, user, isAuthenticated, login, logout, refreshToken };
});
```

The `accessToken` living in Pinia memory means it disappears on page refresh. The refresh token in the httpOnly cookie survives the refresh and the `auth` middleware calls `refreshToken()` on every page load if `isAuthenticated` is false but the cookie is present.

```typescript
// stores/crypto.ts
export const useCryptoStore = defineStore('crypto', () => {
  const cryptoKey = shallowRef<CryptoKey | null>(null);
  const isUnlocked = computed(() => cryptoKey.value !== null);
  let lockTimer: ReturnType<typeof setTimeout> | null = null;

  async function deriveKey(masterPassword: string, kdfSalt: string) {
    const salt = base64ToUint8Array(kdfSalt);
    cryptoKey.value = await deriveEncryptionKey(masterPassword, salt);
    resetLockTimer();
  }

  function lock() {
    cryptoKey.value = null;
    if (lockTimer) clearTimeout(lockTimer);
  }

  function resetLockTimer() {
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(lock, 15 * 60 * 1000); // 15 minutes
  }

  return { cryptoKey, isUnlocked, deriveKey, lock, resetLockTimer };
});
```

```typescript
// stores/vault.ts
export const useVaultStore = defineStore('vault', () => {
  const entries = ref<DecryptedEntry[]>([]);
  const loading = ref(false);
  const cursor = ref<string | null>(null);

  async function fetchEntries(reset = false) {
    const crypto = useCryptoStore();
    if (!crypto.isUnlocked) throw new Error('Vault is locked');
    loading.value = true;
    const raw = await apiFetch('/vault', { params: { cursor: reset ? null : cursor.value } });
    const decrypted = await Promise.all(
      raw.items.map(e => decryptEntry(e, crypto.cryptoKey!))
    );
    entries.value = reset ? decrypted : [...entries.value, ...decrypted];
    cursor.value = raw.nextCursor;
    loading.value = false;
  }

  async function createEntry(data: Omit<DecryptedEntry, 'id' | 'updatedAt'>) {
    const encrypted = await encryptEntry(data, useCryptoStore().cryptoKey!);
    const created = await apiFetch('/vault', { method: 'POST', body: encrypted });
    entries.value.unshift(await decryptEntry(created, useCryptoStore().cryptoKey!));
  }

  function clear() { entries.value = []; cursor.value = null; }

  return { entries, loading, cursor, fetchEntries, createEntry, clear };
});
```

**Important:** Pinia persistence plugins must **not** be configured for `useVaultStore` or `useCryptoStore`. Persisting these stores would write decrypted vault content or the derived key to browser storage, breaking the zero-knowledge model.

### 6.4 Client-Side Crypto Integration

The `packages/shared` crypto module is imported directly by both the web app and the extension. Key derivation happens once per session in `useCryptoStore.deriveKey`, and the resulting `CryptoKey` object (marked `extractable: false`) is reused for every encrypt/decrypt operation.

Argon2id runs via `argon2-browser` WASM. On the main thread it blocks for roughly 500ms to 2 seconds. Moving this to a Web Worker eliminates the UI freeze:

```typescript
// composables/useArgon2Worker.ts
export async function deriveKeyInWorker(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('~/workers/argon2.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.postMessage({ password, salt });
    worker.onmessage = e => { resolve(e.data); worker.terminate(); };
    worker.onerror = e => { reject(e); worker.terminate(); };
  });
}
```

The worker produces the raw key bytes, which are imported back on the main thread via `SubtleCrypto.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])`.

### 6.5 NuxtUI 4 Component Strategy

The application uses NuxtUI 4 component primitives without wrapping them in intermediate abstraction layers, keeping the component tree shallow and easy to audit.

The vault entry form uses `UForm` with a Zod schema:

```vue
<UForm :schema="vaultEntrySchema" :state="form" @submit="onSubmit">
  <UFormField label="Label" name="label">
    <UInput v-model="form.label" placeholder="e.g. GitHub" />
  </UFormField>
  <UFormField label="Password" name="password">
    <PasswordInput v-model="form.password" />
  </UFormField>
</UForm>
```

`PasswordInput` is the one custom component: a `UInput` with a trailing icon slot that toggles `type` between `password` and `text`, plus a `StrengthMeter` component that evaluates entropy using `zxcvbn` and renders a four-segment colored bar.

The vault index uses `UTable` with custom cell slots for the type badge (`UBadge`) and action dropdown (`UDropdownMenu`). Color theming is defined in `app.config.ts` using NuxtUI 4's design token overrides — dark mode first, violet accent palette.

### 6.6 Auto-Lock Behavior

The 15-minute idle timer in `useCryptoStore` is initialized on successful vault unlock and reset on any user activity:

```typescript
// composables/useAutoLock.ts
export function useAutoLock() {
  const crypto = useCryptoStore();
  const events = ['mousemove', 'keydown', 'pointerdown', 'focus'];

  function reset() { if (crypto.isUnlocked) crypto.resetLockTimer(); }

  onMounted(() => events.forEach(e => window.addEventListener(e, reset, { passive: true })));
  onUnmounted(() => events.forEach(e => window.removeEventListener(e, reset)));
}
```

This composable is called once in `app/layouts/vault.vue`. When the timer fires, `lock()` sets `cryptoKey` to null and a watcher in `vault.vue` renders a full-screen `UModal` lock overlay. The overlay contains only a master password input — submitting re-derives the key and closes the overlay without a network round-trip.

### 6.7 Environment Secrets Management

The application supports two dedicated entry types for DevOps workflows: `ENV_FILE` (entire `.env` file) and `SECRET` (single named secret). Both follow the identical zero-knowledge encryption model as regular vault entries — the server stores opaque ciphertext, the client decrypts and parses.

#### ENV_FILE Entry Type

An `ENV_FILE` entry stores the full text content of a `.env` file as a single AES-256-GCM encrypted blob. Parsing into individual key=value pairs happens **entirely on the client** after decryption — the server never sees individual variable names or values.

```
Plaintext stored in encrypted blob:
  DATABASE_URL=postgres://user:pass@host:5432/db
  REDIS_URL=redis://:secret@redis:6379
  JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEo...
  STRIPE_SECRET_KEY=sk_live_...
  SENDGRID_API_KEY=SG....
```

**UI behavior for ENV_FILE:**
- **Create/Edit**: textarea for raw `.env` paste, or file upload (`<input type="file" accept=".env,.txt">`) — content read client-side with FileReader, never sent to server unencrypted
- **View**: parsed into a two-column table (`KEY` / `VALUE`) with all values masked by default. Each row has independent reveal-toggle and copy button (clipboard cleared after 30s)
- **Export**: "Download as .env" button writes the decrypted `envContent` as a file download via `URL.createObjectURL(new Blob([content], { type: 'text/plain' }))` — no server round-trip
- **Environment tag**: badge displayed (production / staging / development / custom) — stored in `VaultEntry.environment` column (plaintext, non-secret label)
- **Version history**: `secretVersion` incremented on each save. Previous encrypted blobs retained in a `VaultEntryVersion` table (see below), allowing rollback

#### SECRET Entry Type

A `SECRET` entry stores a single named key/value pair. Use cases: individual API keys, tokens, connection strings, SSH private keys, TLS certificates, webhook signing secrets.

**UI behavior for SECRET:**
- **Create/Edit**: two fields — `secretKey` (variable name, e.g. `STRIPE_SECRET_KEY`) and `secretValue` (masked input). Optional `secretDescription` and `environment` tag.
- **View**: key shown in plaintext (it is just a variable name), value masked with reveal toggle. One-click copy.
- **Bulk import from ENV_FILE**: user can open an ENV_FILE entry and "extract" individual keys as standalone SECRET entries for granular access tracking.

#### Version History for ENV_FILE and SECRET

A companion entity stores previous versions:

```typescript
// vault-entry-version.entity.ts
@Entity({ tableName: 'vault_entry_versions' })
export class VaultEntryVersion {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => VaultEntry, { onDelete: 'cascade' })
  entry!: VaultEntry;

  @Property({ type: 'text' })
  encryptedData!: string;  // snapshot of that version's encrypted blob

  @Property({ length: 24 })
  iv!: string;

  @Property({ length: 24 })
  authTag!: string;

  @Property()
  version!: number;  // matches VaultEntry.secretVersion at time of save

  @Property({ length: 255, nullable: true })
  changeNote: string | null = null;  // optional user-supplied note

  @Property()
  createdAt: Date = new Date();
}
```

Retention policy: keep the last 10 versions per entry (enforced in the VaultService update method: after flush, delete versions where `version < currentVersion - 10`). This is configurable per instance.

**API endpoints for version history:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/vault/:id/versions` | List version metadata (no encrypted content) |
| GET | `/vault/:id/versions/:v` | Get specific version (encrypted blob) |
| POST | `/vault/:id/revert/:v` | Copy version v to current (creates new version) |

#### Vault Page Additions for ENV_FILE / SECRET

```
app/pages/vault/
├── index.vue           # Updated: filter tabs include ENV_FILE, SECRET, All
├── [id].vue            # Updated: renders ENV_FILE table or SECRET single-value view
├── env/
│   ├── new.vue         # Dedicated ENV_FILE creation (textarea + file upload)
│   └── [id]/
│       └── versions.vue # Version history browser with diff view
└── secret/
    └── new.vue          # Dedicated SECRET creation
```

The vault index gains an environment filter dropdown (production / staging / development / all) that filters client-side by the `environment` field on decrypted entries. This allows quickly finding all production secrets without a server round-trip.

#### Security Notes for ENV_FILE

- **Never log**: API must not log request bodies on endpoints that receive encrypted vault data. The `encryptedData` field is large and binary — logging it wastes space and could create log-based leakage if logs are shipped to third-party services.
- **Clipboard risk**: copying a full `.env` file to clipboard is risky. The UI should copy individual keys only, never the full file content. The "Download as .env" path is the intended full-file export.
- **SSH/TLS private keys**: multi-line PEM content is handled correctly because `envContent` is a plain string (newlines included). No special handling required — the encrypted blob stores bytes verbatim.
- **Rotation workflow**: when rotating a secret (e.g. rolling a `DATABASE_PASSWORD`), the user updates the ENV_FILE entry, the old version is automatically retained in `VaultEntryVersion`, and the environment tag makes it easy to identify which environment was updated.

---

## 7. Browser Extension (Manifest V3)

### 7.1 Architecture Overview

```
extension/
├── manifest.json
├── popup/
│   ├── main.ts              # Vue 3 createApp, Pinia
│   ├── App.vue
│   └── components/
│       ├── LoginForm.vue
│       ├── VaultList.vue
│       ├── EntryCard.vue
│       └── PasswordGenerator.vue
├── content/
│   └── content.ts           # DOM injection, form detection, autofill
├── background/
│   └── service-worker.ts    # API calls, token refresh, message routing
├── options/
│   └── options.html         # Extension settings: server URL override
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

The popup is a standalone Vue 3 SPA bundled separately from the main web app. It uses Tailwind CSS (bundled, not NuxtUI) to keep the bundle small. State shared with the service worker uses `chrome.storage.session` as the synchronization layer.

### 7.2 Manifest V3 Key Decisions

```json
{
  "manifest_version": 3,
  "name": "Adyton",
  "version": "1.0.0",
  "permissions": ["storage", "cookies", "activeTab", "clipboardWrite"],
  "host_permissions": ["https://vault.example.com/*"],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": { "48": "icons/icon-48.png" }
  }
}
```

`host_permissions` is scoped to the API domain, not `<all_urls>`. The content script needs `<all_urls>` to detect password forms on any website, but it makes no API calls itself — all API communication is proxied through the service worker via `chrome.runtime.sendMessage`. This separation means credentials never leave through the content script's execution context.

The critical MV3 difference from MV2: the background service worker is ephemeral. Chrome may terminate it after 30 seconds of inactivity. `chrome.storage.session` (available since Chrome 102) fills this gap: it persists for the browser session, is not written to disk, and is accessible from both the service worker and popup.

### 7.3 Content Script — Form Detection and Autofill

```typescript
// content/content.ts
const observer = new MutationObserver(() => detectLoginForms());
observer.observe(document.body, { childList: true, subtree: true });
detectLoginForms();

function detectLoginForms() {
  const passwordFields = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  passwordFields.forEach(field => {
    if (field.dataset.vaultKeyAttached) return;
    field.dataset.vaultKeyAttached = 'true';
    injectAutofillButton(field);
  });
}

function injectAutofillButton(passwordField: HTMLInputElement) {
  const btn = document.createElement('button');
  btn.className = 'adyton-autofill-btn';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const domain = window.location.hostname;
    const response = await chrome.runtime.sendMessage({ type: 'AUTOFILL_REQUEST', domain });
    if (response?.credentials) {
      const usernameField = findAdjacentUsernameField(passwordField);
      if (usernameField) usernameField.value = response.credentials.username;
      passwordField.value = response.credentials.password;
      // Dispatch input events so SPA frameworks detect the fill
      [usernameField, passwordField].forEach(f =>
        f?.dispatchEvent(new Event('input', { bubbles: true }))
      );
    }
  });
  document.body.appendChild(btn);
}
```

SPA navigation is handled by intercepting `history.pushState` and `history.replaceState` with a 500ms delay to allow the SPA's new DOM to render before the detection pass runs.

The username field heuristic checks inputs within the same `<form>` element first, then within a ±300px vertical radius, filtering for `type="text"`, `type="email"`, or `name` attributes containing `user`, `email`, or `login`.

### 7.4 Background Service Worker

```typescript
// background/service-worker.ts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Keep the channel open for async response
});

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await chrome.storage.session.get('accessToken');
  const res = await fetch(`https://vault.example.com/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers
    },
  });
  if (res.status === 401) {
    await silentRefresh();
    return apiFetch(path, init); // Retry once
  }
  return res.json();
}

async function silentRefresh() {
  const res = await fetch('https://vault.example.com/api/auth/refresh', {
    method: 'POST',
    credentials: 'include', // Sends the httpOnly cookie
  });
  const data = await res.json();
  await chrome.storage.session.set({ accessToken: data.accessToken });
}
```

The service worker wakes on incoming messages and sleeps again when the handler resolves. If `chrome.storage.session` contains a valid access token from a previous wake cycle, the request proceeds without re-authentication.

### 7.5 Popup Application

The popup checks `chrome.storage.session` on mount. If an `accessToken` key exists, it shows the vault view. Otherwise it renders the login form. After successful login the access token is written to `chrome.storage.session`.

The vault list in the popup shows the top five entries matching the current domain, retrieved by calling through the service worker message bus. Copy buttons run:

```typescript
async function copyAndClear(text: string) {
  await navigator.clipboard.writeText(text);
  setTimeout(() => navigator.clipboard.writeText(''), 30_000);
}
```

### 7.6 Message Bus Protocol

```typescript
// packages/shared/src/extension-messages.ts
export type ExtensionMessage =
  | { type: 'AUTOFILL_REQUEST'; domain: string }
  | { type: 'AUTOFILL_RESPONSE'; credentials: { username: string; password: string } | null }
  | { type: 'VAULT_SEARCH'; query: string }
  | { type: 'VAULT_SEARCH_RESPONSE'; entries: DecryptedEntry[] }
  | { type: 'LOCK' }
  | { type: 'UNLOCK_REQUEST'; masterPassword: string }
  | { type: 'GET_USER_INFO' }
  | { type: 'USER_INFO_RESPONSE'; user: { email: string; totpEnabled: boolean } | null };
```

All message handlers in the service worker switch on `message.type` with exhaustive matching enforced by TypeScript's discriminated union. Adding a new message type to the union without a corresponding case causes a compile error.

---

## 8. Shared Package (`packages/shared`)

### 8.1 Crypto Utilities

The shared crypto module targets the Web Crypto API, which is available in browser main threads, browser workers, and Chromium extension service workers. Node.js 18+ also exposes `globalThis.crypto.subtle`, so the same module can be unit-tested with Vitest without mocking.

The shared package exports two modules:
- `crypto.ts` — key derivation, encryption, decryption, password generation
- `password-validation.ts` — master password strength enforcement (see Section 3.3.3 for full implementation)

Key exports from `password-validation.ts`:
- `validateMasterPassword(password)` → `PasswordStrengthResult` (zxcvbn + HIBP + rules)
- `isBreachedPassword(password)` → `boolean` (HIBP k-anonymity check, client-side only)

```typescript
// packages/shared/src/crypto.ts
import argon2 from 'argon2-browser';

export interface EncryptedPayload {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
}

export async function deriveEncryptionKey(
  masterPassword: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const result = await argon2.hash({
    pass: masterPassword,
    salt,
    type: argon2.ArgonType.Argon2id,
    mem: 65536,     // 64 MiB
    time: 3,        // 3 iterations
    parallelism: 1,
    hashLen: 32,
  });
  return crypto.subtle.importKey(
    'raw',
    result.hash,
    { name: 'AES-GCM' },
    false,           // non-extractable
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(key: CryptoKey, plaintext: string): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { ciphertext, iv };
}

export async function decryptData(key: CryptoKey, payload: EncryptedPayload): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: payload.iv },
    key,
    payload.ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

export async function hashLabel(label: string): Promise<string> {
  const encoded = new TextEncoder().encode(label.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generatePassword(options: PasswordOptions): string {
  const charsets: Record<string, string> = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    symbols: '!@#$%^&*()_+-=[]{}|;:,.?',
  };
  const ambiguous = /[O0Il1]/g;
  let pool = Object.entries(charsets)
    .filter(([k]) => options[k as keyof PasswordOptions])
    .map(([, v]) => v)
    .join('');
  if (options.excludeAmbiguous) pool = pool.replace(ambiguous, '');
  const bytes = crypto.getRandomValues(new Uint8Array(options.length * 2));
  let result = '';
  for (const byte of bytes) {
    if (result.length >= options.length) break;
    // Rejection sampling to eliminate modulo bias
    if (byte < Math.floor(256 / pool.length) * pool.length)
      result += pool[byte % pool.length];
  }
  return result;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
  });
}
```

AES-GCM with a 12-byte random IV provides 96-bit IV space. For a vault that might hold 10,000 entries the collision probability is negligible (birthday bound for 96-bit nonces across 10^4 entries is approximately 3×10^-22). IV uniqueness is critical because AES-GCM authentication tag integrity breaks catastrophically on IV reuse with the same key.

The `generatePassword` function uses rejection sampling to eliminate modulo bias. The pool size rarely exceeds 90 characters, and 256 is not divisible by most pool sizes, so naive `byte % pool.length` over-represents low-index characters.

### 8.2 Type Definitions

```typescript
// packages/shared/src/types.ts
export enum VaultEntryType {
  LOGIN       = 'LOGIN',
  NOTE        = 'NOTE',
  CARD        = 'CARD',
  IDENTITY    = 'IDENTITY',
  ENV_FILE    = 'ENV_FILE',   // .env file: multi-key encrypted blob
  SECRET      = 'SECRET',     // Single named secret: API key, token, cert PEM, etc.
}

export type Environment = 'production' | 'staging' | 'development' | string;

// Base interface shared by all entry types
export interface DecryptedEntry {
  id: string;
  type: VaultEntryType;
  label: string;
  updatedAt: Date;
  secretVersion: number;
  environment?: Environment;

  // LOGIN
  username?: string;
  password?: string;
  url?: string;
  notes?: string;

  // CARD
  cardNumber?: string;
  cardExpiry?: string;
  cardCvv?: string;
  cardholderName?: string;

  // IDENTITY
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;

  // ENV_FILE — entire .env content stored as single encrypted string
  // Client parses to key=value pairs; server never sees individual keys
  envContent?: string;          // raw .env file text (newline-delimited KEY=VALUE)
  envParsed?: Record<string, string>;  // derived client-side from envContent, not stored

  // SECRET — single key/value (API key, token, certificate, SSH key, etc.)
  secretKey?: string;           // variable name / identifier, e.g. "STRIPE_SECRET_KEY"
  secretValue?: string;         // the secret value
  secretDescription?: string;   // optional human description
}

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; totpEnabled: boolean };
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}
```

These types are imported as path aliases (`@shared/types`) in the NestJS backend (type checking only — the backend never uses the crypto functions), the Nuxt frontend, and the extension. TypeScript project references in `tsconfig.json` at the workspace root ensure all packages see a consistent type surface.

---

## 9. Infrastructure and DevOps

### 9.1 Docker Compose (Development)

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: adyton
      POSTGRES_USER: adyton
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-devpassword}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U adyton"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save "" --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile.dev
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://adyton:${POSTGRES_PASSWORD:-devpassword}@db:5432/adyton
      REDIS_URL: redis://redis:6379
      JWT_PRIVATE_KEY_PATH: /run/secrets/jwt_private_key
      JWT_PUBLIC_KEY_PATH: /run/secrets/jwt_public_key
      NODE_ENV: development
    volumes:
      - ./apps/api:/app/apps/api
      - ./packages:/app/packages
      - /app/node_modules
    ports:
      - "3001:3001"
    secrets:
      - jwt_private_key
      - jwt_public_key

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile.dev
    restart: unless-stopped
    environment:
      NUXT_PUBLIC_API_BASE_URL: http://localhost/api
      NODE_ENV: development
    volumes:
      - ./apps/web:/app/apps/web
      - ./packages:/app/packages
      - /app/node_modules
    ports:
      - "3000:3000"

secrets:
  jwt_private_key:
    file: ./secrets/jwt_private.pem
  jwt_public_key:
    file: ./secrets/jwt_public.pem

volumes:
  postgres_data:
```

### 9.2 Development: Accessing Services Locally

In development, no reverse proxy is needed. Services are directly accessible on localhost:

| Service | URL |
|---------|-----|
| Nuxt frontend | `http://localhost:3000` |
| NestJS API | `http://localhost:3001` |
| PostgreSQL | `localhost:5432` (direct connection for DB tools) |

The Nuxt app calls the API directly at `http://localhost:3001`. Set `NUXT_PUBLIC_API_BASE_URL=http://localhost:3001` in the dev environment. No `/api` path prefix needed in dev — prefix is added by the production routing (Traefik).

### 9.3 Production: Hetzner VPS + Coolify + Cloudflare

**Architecture:**

```
User browser
    │
    ▼
Cloudflare (DNS proxy — orange cloud)
  · DDoS L3/L4/L7 absorption
  · WAF basic rules (free tier)
  · Bot Fight Mode
  · SSL termination (Flexible disabled — Full Strict mode)
    │
    ▼ Only Cloudflare IP ranges pass through (UFW rule)
Hetzner VPS — Ubuntu 24.04
  · UFW: port 80/443 only from Cloudflare IPs
  · fail2ban: reads Traefik logs
    │
    ▼
Coolify (Traefik built-in reverse proxy)
  · Routes by domain + path prefix
  · TLS: Cloudflare Origin Certificate (Section 9.6)
  · Real IP forwarding: CF-Connecting-IP → X-Real-IP
    │
    ├─▶ api container  (NestJS:3001) — path /api/*
    └─▶ web container  (Nuxt:3000)  — path /*
         │
         └── [internal Docker network — not reachable from outside]
               ├─▶ db    (PostgreSQL:5432)
               └─▶ redis (Redis:6379)
```

**docker-compose.yml (Coolify deployment — no nginx, no certbot):**

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: adyton
      POSTGRES_USER: adyton
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - internal
    mem_limit: 512m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U adyton"]
      interval: 15s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save "" --requirepass ${REDIS_PASSWORD} --maxmemory 64mb
    networks:
      - internal
    mem_limit: 128m

  api:
    image: ${API_IMAGE}   # built via CI and pushed to registry, or build: context in Coolify UI
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://adyton:${POSTGRES_PASSWORD}@db:5432/adyton
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      NODE_ENV: production
      JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY}   # set in Coolify env var UI (PEM, multiline)
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}
      ENABLE_POW: "true"
    networks:
      - internal
      - coolify          # Traefik-accessible network managed by Coolify
    mem_limit: 512m
    labels:
      - "traefik.enable=true"
      # Route /api/* to NestJS
      - "traefik.http.routers.adyton-api.rule=Host(`${DOMAIN}`) && PathPrefix(`/api`)"
      - "traefik.http.routers.adyton-api.entrypoints=https"
      - "traefik.http.routers.adyton-api.tls=true"
      - "traefik.http.services.adyton-api.loadbalancer.server.port=3001"
      # Strip /api prefix before forwarding to NestJS
      - "traefik.http.middlewares.strip-api.stripprefix.prefixes=/api"
      # Real IP from Cloudflare: CF-Connecting-IP → X-Real-IP
      - "traefik.http.middlewares.cf-realip.headers.customrequestheaders.X-Real-IP=CF-Connecting-IP"
      # Security headers (Cloudflare adds HSTS; Traefik adds the rest)
      - "traefik.http.middlewares.sec-headers.headers.contentTypeNosniff=true"
      - "traefik.http.middlewares.sec-headers.headers.frameDeny=true"
      - "traefik.http.middlewares.sec-headers.headers.referrerPolicy=no-referrer"
      # Basic Traefik rate limit (coarse — app-level @fastify/rate-limit handles per-endpoint)
      - "traefik.http.middlewares.api-rl.ratelimit.average=120"
      - "traefik.http.middlewares.api-rl.ratelimit.burst=50"
      - "traefik.http.middlewares.api-rl.ratelimit.period=1m"
      - "traefik.http.middlewares.api-rl.ratelimit.sourcecriterion.requestheadername=CF-Connecting-IP"
      - "traefik.http.routers.adyton-api.middlewares=strip-api,cf-realip,sec-headers,api-rl"

  web:
    image: ${WEB_IMAGE}
    restart: unless-stopped
    environment:
      NUXT_PUBLIC_API_BASE_URL: https://${DOMAIN}/api
      NODE_ENV: production
    networks:
      - coolify
    mem_limit: 256m
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.adyton-web.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.adyton-web.entrypoints=https"
      - "traefik.http.routers.adyton-web.tls=true"
      - "traefik.http.services.adyton-web.loadbalancer.server.port=3000"
      - "traefik.http.routers.adyton-web.middlewares=sec-headers"

networks:
  internal:
    driver: bridge
    internal: true    # db + redis not reachable from any external network
  coolify:
    external: true
    name: coolify     # Coolify creates this network automatically on install

volumes:
  postgres_data:
```

**Coolify deployment sequence:**

1. Install Coolify on Hetzner VPS: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
2. Open Coolify UI (`http://<vps-ip>:8000`), complete setup wizard
3. Add new project → "Docker Compose" application → paste/link the `docker-compose.yml`
4. Set environment variables in Coolify UI (never committed to git):
   - `POSTGRES_PASSWORD`, `REDIS_PASSWORD` — generate with `openssl rand -hex 32`
   - `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` — paste PEM content (multiline supported)
   - `DOMAIN` — e.g. `vault.yourdomain.com`
   - `API_IMAGE`, `WEB_IMAGE` — your container registry images
5. Set domain in Coolify UI → Coolify configures Traefik routing automatically
6. Configure TLS (see Section 9.6 — Cloudflare Origin Certificate recommended)
7. Deploy → Coolify pulls images, starts containers, Traefik routes traffic
8. Run migrations: Coolify UI → "Execute command" → `node dist/cli.js migration:run`

**RS256 keypair generation (run once, save output to Coolify env vars):**

```bash
openssl genrsa -out jwt_private.pem 4096
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
# Paste contents of jwt_private.pem → JWT_PRIVATE_KEY in Coolify UI
# Paste contents of jwt_public.pem → JWT_PUBLIC_KEY in Coolify UI
# Delete local .pem files after copying
```

---

**Attivare Cloudflare proxy (se il dominio è già registrato su Cloudflare)**

Il dominio è già su Cloudflare Registrar → DNS gestito da Cloudflare → basta abilitare il proxy. Nessun costo aggiuntivo: è incluso nel piano free.

**Passi esatti (una-tantum, ~5 minuti):**

1. Apri [dash.cloudflare.com](https://dash.cloudflare.com) → seleziona il dominio
2. **DNS → Records** → trova il record `A` che punta all'IP del VPS Hetzner
3. Clicca l'icona **nuvoletta grigia** nella colonna "Proxy status" → diventa **arancione**
4. Salva — DDoS protection e Bot Fight Mode attivi immediatamente

5. **SSL/TLS → Overview** → seleziona **Full (Strict)**
   - Coolify gestisce già Let's Encrypt automaticamente → Full (Strict) funziona senza configurazione aggiuntiva
   - *Non usare "Flexible"* — con Flexible il traffico Cloudflare → VPS viaggia in HTTP non cifrato

6. **Security → Bots** → **Bot Fight Mode → ON**

7. **Security → WAF** → **Managed Rules → ON** (regole OWASP base, gratuito)

8. **Security → WAF → Rate Limiting Rules → Create rule:**
   - URI path: `/api/auth/login`
   - Caratteristica: IP
   - Soglia: 5 richieste in 60 secondi
   - Azione: Block
   - Questa regola blocca il brute-force sul login **prima** che il traffico raggiunga il VPS

9. **SSL/TLS → Edge Certificates** → **Always Use HTTPS → ON**

Dopo questi passi, il tuo VPS è protetto da Cloudflare. Il passo successivo (opzionale ma consigliato) è aggiungere la regola UFW per accettare 80/443 solo dagli IP Cloudflare — vedere Section 9.6.

```
Prima (DNS only):   Browser → VPS Hetzner direttamente
Dopo (proxied):     Browser → Cloudflare → VPS Hetzner
                              ↑
                    DDoS assorbito qui, WAF applicato qui,
                    IP reale del VPS nascosto
```

---

### 9.4 Backup Strategy

A dedicated backup container runs `pg_dump` on a cron schedule:

```bash
# scripts/backup.sh (installed as cron entry: 0 2 * * * /backup.sh)
#!/bin/sh
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -h db -U adyton adyton | gzip > /backups/adyton_${DATE}.sql.gz

# Retention: keep 7 daily, 4 weekly
find /backups -name "*.sql.gz" -mtime +7 -not -name "*_Monday_*" -delete
find /backups -name "*_Monday_*" -mtime +28 -delete
```

For off-site replication, `rclone` syncs the `/backups` volume to Backblaze B2 after each dump completes. Restore procedure:

```bash
gunzip -c backup.sql.gz | docker compose exec -T db psql -U adyton adyton
```

### 9.5 Secrets Management

With Coolify, secrets are stored in the Coolify UI (encrypted at rest in Coolify's own database) and injected as environment variables at container startup. No `.env.prod` file exists on the VPS filesystem — nothing to accidentally expose or commit.

`.env.example` documents every required variable and is committed to the repo:

```bash
# .env.example — all values are placeholders, never real secrets
POSTGRES_PASSWORD=CHANGE_ME_32_BYTES_HEX
REDIS_PASSWORD=CHANGE_ME_32_BYTES_HEX
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nCHANGE_ME\n-----END RSA PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nCHANGE_ME\n-----END PUBLIC KEY-----
DOMAIN=vault.yourdomain.com
API_IMAGE=ghcr.io/yourorg/adyton-api:latest
WEB_IMAGE=ghcr.io/yourorg/adyton-web:latest
ENABLE_POW=true
```

The NestJS `ConfigService` reads JWT keys from environment variables directly (not file paths) — Coolify passes PEM content as a multiline env var. The PostgreSQL user used at runtime has no DDL permissions; migrations run as a one-off command via Coolify's "Execute command" UI before first start.

---

### 9.6 Cloudflare + Traefik Security Configuration

#### TLS: Cloudflare Origin Certificate (recommended)

With Cloudflare proxying traffic, Let's Encrypt is not needed — Cloudflare handles the certificate that browsers see. The connection between Cloudflare and the origin (Hetzner VPS) uses a **Cloudflare Origin Certificate**: a certificate Cloudflare issues that is valid for 15 years and trusted only by Cloudflare (not publicly trusted, which is fine because no browser ever connects directly to the VPS).

```
Browser ←→ Cloudflare: Cloudflare's public certificate (trusted by all browsers)
Cloudflare ←→ Hetzner VPS: Cloudflare Origin Certificate (trusted only by CF)
```

**Setup:**
1. In Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate → 15 years
2. Copy "Origin Certificate" (PEM) and "Private Key"
3. Add both to Coolify as environment variables: `CF_ORIGIN_CERT`, `CF_ORIGIN_KEY`
4. In Coolify Traefik config, reference these as the TLS certificate for your domain
5. Cloudflare SSL mode → **Full (Strict)** — Cloudflare verifies the origin cert

**Cloudflare SSL mode — do not use Flexible:**

| Mode | Cloudflare → Origin | Security |
|------|---------------------|----------|
| Flexible | HTTP (unencrypted!) | ❌ Traffic on VPS is plaintext |
| Full | HTTPS (any cert) | ⚠️ Self-signed accepted — MITM possible on same host |
| **Full (Strict)** | **HTTPS + valid cert** | ✅ Only Origin Certificate or Let's Encrypt accepted |

#### Cloudflare Security Settings (free tier)

Configure these in Cloudflare dashboard → Security:

| Setting | Value | Effect |
|---------|-------|--------|
| **Bot Fight Mode** | ON | Blocks known bot fingerprints — no cost, catches a large fraction of scraping/scanning bots |
| **Security Level** | Medium | Blocks IPs with bad reputation from accessing the site |
| **Browser Integrity Check** | ON | Rejects headless browsers and unusual User-Agents |
| **Challenge Passage** | 30 min | Challenged users don't get re-challenged for 30 min |
| **WAF** | Managed Rules ON (free tier) | Basic OWASP rules, SQL injection, XSS patterns |
| **Rate Limiting** | 1 rule (free tier) | Add a rule: `/api/auth/login` → 5 req/min per IP → Block |

Cloudflare's rate limiting rule on `/api/auth/login` is the first gate — it fires before the request even reaches Hetzner. The application's own progressive delay (Section 3.10.4) is the second gate for requests that pass Cloudflare.

#### UFW: Lock Origin to Cloudflare IPs Only

With Cloudflare proxying, the VPS only needs to accept traffic from Cloudflare IP ranges. Direct access to the VPS IP bypasses Cloudflare DDoS protection. Lock it down:

```bash
# Run on Hetzner VPS after Coolify install
# First: deny all on 80/443
ufw deny 80
ufw deny 443

# Allow only Cloudflare IPv4 ranges
for ip in \
  173.245.48.0/20 \
  103.21.244.0/22 \
  103.22.200.0/22 \
  103.31.4.0/22 \
  141.101.64.0/18 \
  108.162.192.0/18 \
  190.93.240.0/20 \
  188.114.96.0/20 \
  197.234.240.0/22 \
  198.41.128.0/17 \
  162.158.0.0/15 \
  104.16.0.0/13 \
  104.24.0.0/14 \
  172.64.0.0/13 \
  131.0.72.0/22; do
    ufw allow from $ip to any port 80
    ufw allow from $ip to any port 443
done

# Keep Coolify UI accessible (restrict to your own IP in production)
ufw allow from YOUR_IP to any port 8000

ufw reload
```

Result: an attacker who discovers the Hetzner VPS IP cannot connect to it on 80/443 — requests are dropped at the firewall. Only Cloudflare's infrastructure can reach the VPS. All DDoS must go through Cloudflare first.

**Update Cloudflare IP list periodically:** Cloudflare publishes current IP ranges at `https://www.cloudflare.com/ips-v4`. A cron script can refresh the UFW rules monthly.

#### Real IP Propagation

With Cloudflare proxying, the IP reaching Traefik is always a Cloudflare data center IP, not the user's IP. Cloudflare adds the real client IP in the `CF-Connecting-IP` header. The Traefik label in Section 9.3 already maps this:

```yaml
- "traefik.http.middlewares.cf-realip.headers.customrequestheaders.X-Real-IP=CF-Connecting-IP"
- "traefik.http.middlewares.api-rl.ratelimit.sourcecriterion.requestheadername=CF-Connecting-IP"
```

NestJS has `trustProxy: true` in Fastify options (already in plan) — it reads `X-Real-IP` as the client IP for rate limiting, fail2ban log entries, audit logs, and trusted device IP tracking.

**Without this**, rate limiting and fail2ban would see only Cloudflare IPs — blocking a Cloudflare IP would block all users worldwide, not just the attacker.

---

### 9.7 Coolify — Configurazione Applicazioni

#### Come Coolify si inserisce nell'architettura

Coolify è installato sul VPS Hetzner e gestisce tutto quello che sta tra il sistema operativo e le applicazioni:

```
Sistema operativo (Ubuntu 24.04)
    └── Docker (installato da Coolify)
        └── Coolify daemon
            ├── Traefik (reverse proxy — gestito automaticamente da Coolify)
            ├── Coolify UI  (porta 8000 — accessibile solo dal tuo IP)
            └── I tuoi servizi (avviati e gestiti da Coolify)
                ├── PostgreSQL
                ├── Redis
                ├── API (NestJS)
                └── Web (Nuxt)
```

Coolify fa tre cose fondamentali:
1. **Avvia e monitora** i container Docker (riavvia se crashano)
2. **Configura Traefik automaticamente** quando assegni un dominio a un'applicazione — non devi scrivere label Traefik a mano
3. **Gestisce i segreti** — env var cifrate, non in file .env sul disco

---

#### Struttura raccomandata in Coolify: Risorse separate

Coolify distingue tra **Applications** (il tuo codice) e **Services** (database, Redis — servizi predefiniti con backup e monitoraggio inclusi).

Struttura raccomandata:

```
Coolify → Project: "Adyton"
  └── Environment: "production"
      ├── Service: PostgreSQL     ← gestito da Coolify (backup UI, log, restart)
      ├── Service: Redis          ← gestito da Coolify
      ├── Application: API        ← NestJS, deploy da Docker image
      └── Application: Web        ← Nuxt, deploy da Docker image
```

Alternativa: deploy come **Docker Compose singolo** (tutto in un file). Più semplice ma aggiornare l'API riavvia anche db e Redis. Per questo motivo i servizi separati sono preferiti.

---

#### Passo 1 — Creare il progetto

1. Apri Coolify UI → `http://<IP-VPS>:8000` (accessibile solo dal tuo IP, vedi UFW)
2. **Projects → New Project** → Nome: `Adyton`
3. All'interno del progetto → **New Environment** → `production`

---

#### Passo 2 — Aggiungere PostgreSQL

1. Nel progetto Adyton → **+ New Resource → Database → PostgreSQL**
2. Versione: `16`
3. Nome servizio: `adyton-db`
4. Coolify genera automaticamente una password sicura e la mostra una sola volta — salvala
5. Il **connection string** che Coolify mostra è quello da usare in `DATABASE_URL`:
   ```
   postgresql://adyton:<password>@adyton-db:5432/adyton
   ```
   Il hostname `adyton-db` è il nome del container — tutti i servizi nello stesso progetto si raggiungono per nome
6. **Backup** → abilita backup automatico (Coolify fa `pg_dump` schedulato)
7. Deploy

---

#### Passo 3 — Aggiungere Redis

1. **+ New Resource → Database → Redis**
2. Versione: `7`
3. Nome: `adyton-redis`
4. Coolify imposta `requirepass` automaticamente — salva la password
5. Connection string: `redis://:password@adyton-redis:6379`
6. Deploy

---

#### Passo 4 — Aggiungere l'applicazione API (NestJS)

1. **+ New Resource → Application → Docker Image**
2. Docker image: `ghcr.io/tuouser/adyton-api:latest` (o il tuo registry)
3. Nome: `adyton-api`
4. **Domains** → aggiungi `vault.tuodominio.com` — path prefix `/api`
   - Coolify configura Traefik automaticamente: routing, TLS, strip del prefisso `/api`
5. **Environment Variables** → aggiungi tutti i segreti:

   | Chiave | Valore |
   |--------|--------|
   | `DATABASE_URL` | `postgresql://adyton:<pwd>@adyton-db:5432/adyton` |
   | `REDIS_URL` | `redis://:password@adyton-redis:6379` |
   | `JWT_PRIVATE_KEY` | contenuto PEM della chiave privata (multilinea supportata) |
   | `JWT_PUBLIC_KEY` | contenuto PEM della chiave pubblica |
   | `NODE_ENV` | `production` |
   | `ENABLE_POW` | `true` |

   Le env var sono **cifrate at rest** in Coolify — non appaiono in `docker inspect` e non sono nel filesystem del VPS.

6. **Ports** → porta esposta: `3001` (Coolify la usa per il routing Traefik)
7. **Health Check** → `GET /health` → atteso `200`
8. **Restart policy** → `unless-stopped`
9. Deploy

**Eseguire le migration dopo il primo deploy:**
Coolify UI → seleziona `adyton-api` → **Execute Command**:
```bash
node dist/cli.js migration:run
```

---

#### Passo 5 — Aggiungere l'applicazione Web (Nuxt)

1. **+ New Resource → Application → Docker Image**
2. Docker image: `ghcr.io/tuouser/adyton-web:latest`
3. Nome: `adyton-web`
4. **Domains** → `vault.tuodominio.com` (root, senza path prefix)
   - La regola in Traefik ha priorità più bassa di `/api` — Coolify gestisce l'ordine automaticamente
5. **Environment Variables**:

   | Chiave | Valore |
   |--------|--------|
   | `NUXT_PUBLIC_API_BASE_URL` | `https://vault.tuodominio.com/api` |
   | `NODE_ENV` | `production` |

6. **Ports** → `3000`
7. Deploy

---

#### Come Coolify configura Traefik (automaticamente)

Quando assegni un dominio a un'applicazione nel UI, Coolify:
1. Aggiunge le label Traefik al container
2. Traefik rileva le label in tempo reale (non richiede restart)
3. Crea un router con la regola `Host() && PathPrefix()` corretta
4. Richiede un certificato Let's Encrypt automaticamente (se non usi Origin Certificate CF)
5. Configura il redirect HTTP→HTTPS

Non devi scrivere label Traefik manualmente nella maggior parte dei casi. Le label mostrate in Section 9.3 sono utili solo se usi il deploy Docker Compose — con risorse separate Coolify le genera dal UI.

---

#### Deploy automatici (CI/CD)

Coolify supporta deploy automatici quando la Docker image viene aggiornata:

1. In ogni Application → **Deployments → Webhook**
2. Coolify genera un URL webhook
3. Aggiungi questo webhook alla pipeline CI (GitHub Actions, GitLab CI):
   ```yaml
   # .github/workflows/deploy.yml (frammento)
   - name: Trigger Coolify deploy
     run: |
       curl -X POST "${{ secrets.COOLIFY_WEBHOOK_API }}"
       curl -X POST "${{ secrets.COOLIFY_WEBHOOK_WEB }}"
   ```
4. Quando la CI builda e pusha una nuova immagine → Coolify riceve il webhook → pull nuova immagine → rolling restart

Il rolling restart di Coolify mantiene il vecchio container attivo finché il nuovo è healthy — zero downtime.

---

#### Rete interna: come i servizi si parlano

Coolify mette tutti i servizi dello stesso progetto/environment in una rete Docker interna. Non serve esporre porte tra i container:

```
adyton-api → si connette a → adyton-db:5432   (PostgreSQL)
adyton-api → si connette a → adyton-redis:6379 (Redis)
adyton-web → NON si connette direttamente all'API
             → il browser fa richieste a https://vault.tuodominio.com/api
             → Cloudflare → Traefik → adyton-api
```

Il frontend Nuxt non parla mai direttamente con NestJS server-side in produzione (SSR è disabilitato sulle pagine vault). Tutta la comunicazione passa via HTTPS dal browser.

---

#### Riepilogo visivo dell'architettura Coolify

```
Coolify UI (porta 8000, solo tuo IP)
    │
    ├── gestisce ──▶ Traefik
    │                   │
    │                   ├── vault.tuodominio.com/api  ──▶ adyton-api:3001
    │                   └── vault.tuodominio.com       ──▶ adyton-web:3000
    │
    ├── gestisce ──▶ adyton-db     (PostgreSQL:5432)  ─┐
    ├── gestisce ──▶ adyton-redis  (Redis:6379)        ├── rete interna
    ├── gestisce ──▶ adyton-api    (NestJS:3001)       ┤  (non esposta)
    └── gestisce ──▶ adyton-web    (Nuxt:3000)        ─┘
```

---

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

### Phase 3 — MikroORM Entities, Migrations, and Vault API | Complexity: M

**Goals:** Define the full data model and expose the vault CRUD API. Server stores and retrieves opaque blobs — no crypto knowledge required.

**Deliverables:**
- Full entity set: `User`, `RefreshToken`, `VaultEntry`, `WebAuthnCredential`, `AuditLog`
- Initial migration + seed script for development
- `GroupsModule`: full CRUD + `POST /groups/:id/rotate-key` (member removal + atomic group re-key)
- `SecretsModule`: full CRUD under `/groups/:groupId/secrets`, version history, restore
- Request DTOs with `class-validator`: structural validation only (server cannot validate encrypted content)
- **Group key rotation** — atomic transaction: delete membership + bulk update secrets + bulk update remaining memberships. Server validates secret count integrity.
- `AuditModule` global interceptor (logs `GROUP_MEMBER_REMOVE` + `SECRET_UPDATE` x n on rotate)
- E2E tests: auth flow + group CRUD + secret CRUD + rotation flow

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

**Deliverables:**
- `/vault/index.vue`: entry table, type filter tabs, real-time label search (client-side), infinite scroll cursor pagination
- `/vault/[id].vue`: entry detail, inline edit mode, field reveal, copy to clipboard with 30s clear
- `/generator.vue`: standalone password generator with all `PasswordOptions` exposed
- `/settings/security.vue`: session list with revoke buttons
- `/settings/danger.vue`: account deletion with master password confirmation
- `useVaultStore` with full encrypt/decrypt lifecycle; **no persistence plugin**
- Auto-lock composable and lock screen overlay in `vault.vue` layout
- NuxtUI theming (dark mode, violet accent)
- `PasswordInput` component with zxcvbn strength meter

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

### Phase 7 — Browser Extension (MV3) | Complexity: L

**Goals:** Ship a functional Manifest V3 extension for Chrome and Firefox with autofill, vault search, and synchronized auth state.

**Deliverables:**
- Extension scaffold with Vite build, TypeScript, Tailwind CSS (bundled, not NuxtUI)
- Popup: login form, vault list with domain matching, copy buttons with 30s clipboard clear, lock/unlock
- Content script: form detection, MutationObserver, autofill button injection, SPA navigation handling
- Service worker: API proxy, silent token refresh (via httpOnly cookie), message handlers for `AUTOFILL_REQUEST` and `VAULT_SEARCH`
- `chrome.storage.session` for access token persistence across service worker wake cycles
- `packages/shared` crypto used for decrypt-on-demand in service worker and popup
- Firefox compatibility: `browser.*` API polyfill (`webextension-polyfill`), `browser_specific_settings` in manifest
- Packaged `.crx` and `.xpi` artifacts via CI

---

### Phase 8 — Production Hardening | Complexity: M

**Goals:** Transition from development to a production-grade deployment on a VPS with SSL, automated backups, rate limiting, and a final security review pass.

**Deliverables:**
- `docker-compose.prod.yml` with SSL termination, certbot sidecar, resource limits, no exposed database ports
- Production nginx config (Section 9.6): all rate limit zones, connection limits, slow HTTP timeouts, full security headers, HSTS preload, OCSP stapling, TLS 1.2/1.3 only
- `scripts/backup.sh` with 7-daily / 4-weekly rotation policy + optional rclone remote sync
- `@nestjs/throttler` rate limits verified against all auth endpoints
- **fail2ban**: nginx-pwdsecure filter + jail (Section 3.10.3), escalating ban times (`bantime.increment = true`)
- **Progressive delay smoke test**: verify Redis counters increment and delays apply under repeated auth failures
- **Trusted device integration test**: new-device flow, email notification, registration, revocation
- Dependency audit: `pnpm audit`, resolve all high/critical findings
- Manual security review against OWASP Top 10 and ASVS Level 2
- UFW firewall rules: allow only 80, 443, and SSH on non-standard port
- Optional: enable `ENABLE_POW=true` and verify PoW challenge flow end-to-end

---

### Phase 9 — Capacitor Mobile App (iOS + Android) | Complexity: M

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

### Future Roadmap (post-Phase 9)

The following features are architecturally sound but outside current implementation scope:

| Feature | Prerequisite | Complexity |
|---------|-------------|------------|
| **Tauri desktop app** | Phase 9 complete | M — Tauri wraps same Nuxt build; adds Rust plugins for Keychain, screen-lock, global shortcut |
| **Phone-as-Key Sub-model A (enforced)** | Phase 6 (WebAuthn) | S — enforce `authenticatorAttachment: 'cross-platform'` + device-bound passkeys |
| **Phone-as-Key Sub-model B (relay)** | Tauri or Phase 9 | L — VPS relay API, Capacitor key-only app, ECDH key exchange, ntfy.sh push |
| **Emergency access (trusted contact)** | Phase 3 | M — time-locked delegated access, zero-knowledge grant flow |
| **VaultEntry sharing** | Phase 3 | L — asymmetric re-encryption for sharing between users on same instance |
| **TOTP vault entries** | Phase 5 | S — store TOTP secrets as vault entries, display live codes |
| **CLI tool** | Phase 8 | M — `@pwdsecure/cli` using shared crypto, reads/writes vault via API |

---

---

## 11. Security Guarantees & Assurance Level

### 11.1 What the System Guarantees (and What It Does Not)

The security of this system rests on a layered model. Each layer has a defined guarantee and a defined residual risk. Understanding the boundary of each guarantee is more useful than a vague claim of "high security."

#### Layer 1: Vault Content Confidentiality (AES-256-GCM)

**Guarantee:** A party with full read access to the database (PostgreSQL dump, backup theft, or database server compromise) cannot recover any vault entry content — passwords, `.env` files, secrets — without the user's master password.

**Why:** AES-256 has a keyspace of 2^256 ≈ 1.16 × 10^77. No known classical computing attack reduces this below approximately 2^128 (best-known theoretical attacks exploit algebraic structure but remain computationally infeasible). The US NSA classifies AES-256 as sufficient for TOP SECRET information. Current estimates suggest a classical computer checking 10^18 keys per second would require ≈ 10^51 years to exhaust the AES-256 keyspace.

The GCM authentication tag (128-bit) provides additional integrity: any modification to the ciphertext (including a single bit flip) causes decryption to throw an exception. The client will detect server-side tampering before rendering any content.

**Residual risk:** This guarantee holds only as long as the derived key remains secret. If the master password is weak or compromised, this guarantee collapses.

#### Layer 2: Key Derivation Hardness (Argon2id)

**Guarantee:** Even if an attacker obtains the `User.passwordHash` (Argon2id hash of the authentication password, stored in DB), offline brute-force is computationally expensive.

**Quantitative analysis at m=65536, t=3, p=1:**

| Attack platform | Throughput | Time to exhaust 10^9 candidates |
|----------------|------------|----------------------------------|
| Modern CPU (single core) | ~0.5 attempts/sec | ~63 years |
| High-end GPU (RTX 4090, 24GB VRAM) | ~370 attempts/sec* | ~86 years |
| 100-GPU cluster | ~37,000 attempts/sec | ~0.86 years |

*GPU throughput is limited by the 64MB RAM requirement per Argon2id instance. A 24GB VRAM GPU can run at most 370 parallel instances (24,576 MB / 64 MB = 384, minus overhead).

**Important qualifier:** This analysis applies to the authentication password hash. It does not directly apply to cracking the vault encryption key, because that key is derived from the master password using Argon2id client-side and never transmitted. An attacker cracking the `passwordHash` from the DB gets authentication access (ability to log in), not vault decryption access — unless the user chose the same string for both authentication password and master password (which is the expected and acceptable use case for a single-user system).

With a master password of 12 truly random characters from a 70-character set (uppercase, lowercase, digits, symbols): 70^12 ≈ 1.38 × 10^22 combinations. At 37,000 attempts/second on the 100-GPU cluster above: 1.38 × 10^22 / 37,000 ≈ 3.7 × 10^17 seconds ≈ 11.8 billion years. The master password is effectively the only thing protecting the vault.

**Residual risk:** A dictionary word, common phrase, or password reused from another breach is crackable in minutes regardless of Argon2id parameters. The user's password hygiene is the binding constraint.

#### Layer 3: Transport Security (TLS + HSTS)

**Guarantee:** Network interception of traffic between client and server is computationally infeasible when TLS 1.2/1.3 is in use with a valid certificate and HSTS is established in the browser.

**Residual risk (first visit):** Before the browser has stored the HSTS directive from a prior visit, an attacker on the same network (e.g. public Wi-Fi) can intercept the first HTTP request and redirect to a fake HTTP site (SSL stripping). After the first successful HTTPS visit, HSTS prevents this. Submitting to the HSTS preload list eliminates this first-visit window.

#### Layer 4: Session Security (JWT + httpOnly Cookie)

**Guarantee:** An XSS payload that runs arbitrary JavaScript in the browser cannot steal the refresh token (httpOnly cookie, inaccessible to JS) or the derived encryption key (`CryptoKey` with `extractable: false`, opaque to JS).

**Residual risk:** An XSS payload that runs during an active vault session could trigger API calls (read all vault entries) on behalf of the authenticated user. The ciphertext returned would be decrypted by the browser using the in-memory key — the attacker's XSS code could intercept the decrypted plaintext before it reaches the DOM. This is why the CSP policy blocking inline scripts and restricting `script-src` to `'self'` is a critical, non-negotiable control.

#### Layer 5: Two-Factor Authentication

**Guarantee (WebAuthn):** A phishing site at any domain other than the registered `rpId` cannot obtain a valid WebAuthn assertion. This property is enforced by the authenticator hardware or platform — it is cryptographic, not behavioral. An attacker cannot relay a WebAuthn assertion in real time.

**Guarantee (TOTP):** A correctly entered TOTP code proves the user has the TOTP secret. TOTP does **not** provide phishing resistance — see Section 11.2 for AiTM attacks.

### 11.2 Standards Alignment

| Standard | Assessment |
|----------|------------|
| OWASP ASVS Level 2 | Targeted and achievable with this architecture. Level 2 is appropriate for applications handling sensitive personal data. |
| OWASP Top 10 (2021) | A01 (Access Control): scoped by JWT userId. A02 (Crypto Failures): AES-256-GCM + Argon2id. A03 (Injection): MikroORM parameterized queries. A05 (Misconfiguration): Helmet + CSP. A07 (Auth Failures): rate limiting + 2FA. A09 (Logging Failures): AuditLog entity. |
| NIST SP 800-63B | Authentication Assurance Level 2 (AAL2) with 2FA enabled. AAL3 (hardware key required) with WebAuthn + hardware authenticator. |
| NIST SP 800-175B | AES-256-GCM: approved algorithm. Argon2id: recommended KDF for password hashing (2022 NIST update). RS256: approved for JWT signing. |
| GDPR / DSGVO | Encrypted at rest (Art. 25, 32). Audit logs with IP/agent (Art. 30 Records of Processing). Hard account deletion (Art. 17). |

### 11.3 What the System Explicitly Does NOT Guarantee

- **Endpoint security:** If the user's device has malware or a keylogger, the master password is captured before Argon2id. No server-side control can compensate for a compromised client.
- **Physical VPS security:** If the host provider has physical access to the VPS RAM, a DRAM cold-boot attack could extract the derived key during an active session. This is a theoretical risk for most hosting environments.
- **Post-quantum resistance:** AES-256 is considered resistant to Grover's algorithm (providing ~128 bits of security against a quantum adversary). RSA-4096 (used for JWT signing) is vulnerable to Shor's algorithm. A cryptographically relevant quantum computer does not exist today, but migration to CRYSTALS-Dilithium (post-quantum signature) for JWT signing should be planned on a 5–10 year horizon.
- **Browser extension security:** The extension has elevated permissions by design. A compromised browser (malicious extensions, compromised browser binary) can undermine all client-side security properties.

---

## 12. Attack Vectors — How an Attacker Could Steal Data

This section maps the realistic attack paths from most to least feasible, with the specific technical mechanism for each.

### 12.1 Device Compromise (Highest Risk)

**Attack:** Malware, keylogger, or a malicious browser extension runs on the user's device and captures the master password as it is typed, before Argon2id processes it.

**What the attacker gets:** The master password in plaintext. They can then derive the encryption key offline using the `kdfSalt` (retrieved from the API — unauthenticated endpoint leaks nothing, but kdfSalt is delivered on login, so attacker also needs login credentials or the DB dump).

**Full exploitation chain:**
1. Keylogger captures `masterPassword` and `authPassword` at login
2. Attacker logs in with stolen `authPassword` → receives `kdfSalt` + `accessToken`
3. Downloads all vault entries (encrypted blobs)
4. Computes `AES-256-GCM key = Argon2id(masterPassword, kdfSalt)` offline
5. Decrypts all vault entries

**Why this bypasses all server-side controls:** The server correctly validates the login. All security properties hold. The compromise is entirely on the client side.

**Mitigation:** Outside the scope of application-level controls. Device hygiene, EDR, OS-level protections. WebAuthn hardware keys help because the hardware authenticator cannot be cloned even if the device is compromised (the private key never leaves the hardware token), but the master password itself is still captured by the keylogger.

### 12.2 Weak or Breached Master Password

**Attack:** The user chose a dictionary word, common phrase, or password that appears in a breach corpus (HaveIBeenPwned). After a DB breach, the attacker runs an offline dictionary attack against `User.passwordHash` (Argon2id). On success, they replay the cracked password as the master password.

**Timeline:** A 6-word common phrase at the top of a 10M-entry wordlist → cracked in minutes even with Argon2id. A genuinely random 12-character password → not feasible (see Section 11.1).

**Mitigation in this system:** The full `validateMasterPassword()` pipeline runs client-side at registration and at every vault re-unlock prompt (Section 3.3.3): zxcvbn score = 4 required, dictionary words and keyboard patterns rejected, HaveIBeenPwned k-anonymity check against the breach corpus. Registration and unlock are hard-blocked until all conditions pass. This closes the entire class of dictionary and pattern attacks. The residual risk is a personally guessable password that passes algorithmic validation (e.g. unusual capitalisation of a private phrase) — this cannot be detected programmatically.

### 12.3 AiTM Phishing (Adversary-in-The-Middle — Session Relay)

**Attack:** This is distinct from classical MITM (network interception). In an AiTM attack, the attacker runs a reverse proxy (commonly Evilginx2, Modlishka) between the user and the real server. The phishing site at `adyton-login.attacker.com` forwards all requests to the real `vault.example.com` in real time.

**Exploitation with TOTP:**
1. User visits phishing URL (received via email/SMS)
2. Phishing proxy forwards login form to real server
3. User enters email + password + TOTP code
4. Proxy relays to real server → receives real session tokens
5. Attacker's proxy captures the access token + refresh token cookie in real time
6. Attacker uses the session before TOTP code expires (30-second window)

**Why TOTP does NOT protect against AiTM:** TOTP proves possession of the secret, not the origin of the connection. The attacker relays the code immediately to the real server — both the user and the attacker authenticate "successfully."

**Exploitation with WebAuthn:**
1. Phishing proxy forwards WebAuthn authentication options (challenge) to user
2. User's authenticator computes assertion using the challenge and the **browser's current origin** (`https://adyton-login.attacker.com`)
3. The assertion is cryptographically bound to the phishing origin
4. Proxy forwards the assertion to the real server (`vault.example.com`)
5. Real server's WebAuthn validation checks `rpId` — the origin in the assertion does not match `vault.example.com`
6. **Assertion rejected.** Authentication fails. Attacker gets nothing.

**WebAuthn is cryptographically immune to AiTM.** This is the strongest argument for WebAuthn as the primary second factor. TOTP provides a meaningfully lower security level against a sophisticated attacker who can deploy a phishing proxy.

**Mitigation in this system:** WebAuthn enforced as primary 2FA. TOTP retained as fallback (users who cannot use WebAuthn accept the AiTM residual risk). Security-conscious users should exclusively use WebAuthn and disable TOTP.

### 12.4 XSS During Active Vault Session

**Attack:** An XSS payload is injected into a page rendered by the Nuxt frontend (via a malicious vault entry label, URL, or note that is rendered without escaping).

**What the attacker can do during active session:**
1. Call `fetch('/api/vault')` with the existing session cookies/headers → server returns encrypted blobs
2. **Critically:** Access the Pinia store in memory: `window.__pinia['crypto'].cryptoKey` is a `CryptoKey` object
3. `CryptoKey` with `extractable: false` cannot be exported, but the attacker's script can call `crypto.subtle.decrypt(...)` using the existing key handle — the key is an opaque reference the script can use
4. Decrypt all vault entries in-browser → read plaintext passwords and `.env` secrets

**Why this is critical:** The XSS does not need to exfiltrate the key itself. The `CryptoKey` handle is sufficient to decrypt, and the decrypted plaintext can be exfiltrated via `fetch()` to the attacker's server.

**Mitigations:**
- CSP `script-src 'self'` blocks inline scripts and external scripts (primary defense)
- Vue's template compiler HTML-escapes all interpolated values by default (`{{ label }}` → `&amp;lt;script&amp;gt;` not executed)
- Vault entry content is never rendered as `v-html` — this must be a firm coding policy
- Nuxt's built-in XSS protection via Vue's virtual DOM
- Content script isolation: the browser extension runs in an isolated world, preventing web page JS from accessing extension context

**Residual risk:** If a CSP bypass exists (browser bug, misconfigured `unsafe-eval` not present but something equivalent), or if a developer introduces `v-html` for a vault field (a coding mistake), XSS becomes a full vault dump vulnerability.

### 12.5 Server Compromise (Code Execution on VPS)

**Attack:** Attacker exploits a vulnerability (unpatched OS, Docker escape, vulnerable npm dependency) to achieve code execution on the VPS.

**What the attacker gets from the VPS:**
- Full PostgreSQL database: all encrypted vault blobs, Argon2id hashes of auth passwords, TOTP secrets (server-encrypted)
- JWT private key (used for signing access tokens): attacker can forge access tokens indefinitely
- Server-side AES-256 key used to encrypt TOTP secrets: TOTP secrets decryptable
- Redis data: rate limit counters (non-sensitive)

**What the attacker cannot get:**
- Vault plaintext: encrypted with a key derived from the master password, which is never on the server
- Master password: never transmitted or stored

**Attack continuation after VPS compromise:**
1. Forge JWT access tokens using stolen private key
2. Call `GET /vault` → returns encrypted blobs
3. Cannot decrypt them without master password + kdfSalt combination run through Argon2id
4. Can passively wait for the legitimate user to log in and intercept the Argon2id derivation (not feasible remotely; requires implanting malicious code into the NestJS application)

**If attacker modifies server code:** A backdoored server could exfiltrate `kdfSalt` during login and wait for the user to authenticate, then initiate a known-plaintext attack or serve a modified frontend that sends the master password to an attacker endpoint.

**Mitigation:** This attack requires active server compromise, not just passive DB access. Defense: minimal attack surface (no unnecessary services exposed), Docker containers with non-root users, regular security updates, fail2ban, firewall (UFW), immutable infrastructure (redeploy from git rather than patching running containers).

### 12.6 Supply Chain Attack

**Attack:** A malicious npm package is introduced into the dependency tree, specifically targeting `packages/shared` (the crypto module). If the attacker can modify `argon2-browser`, they can exfiltrate the master password before it is hashed. If they modify the `SubtleCrypto` wrapper, they can exfiltrate the raw key bytes before `importKey` is called.

**Why this is particularly dangerous for a password manager:** The crypto package is the single most sensitive component. A backdoor here bypasses all server-side and transport-level security.

**Mitigations:**
- `pnpm-lock.yaml` with content-addressed hashes: any modification to a package changes its hash and fails installation
- `pnpm audit` in CI pipeline: catches known CVEs
- Minimal dependency count in `packages/shared`: only `argon2-browser` is a third-party crypto dependency; all AES-GCM/ECDH operations use the native Web Crypto API
- `npm pack` + manual review of `argon2-browser` on version bumps
- Subresource Integrity (SRI) for any CDN-loaded resources (none in this architecture — all bundled)

### 12.7 Classical MITM (Network Interception)

**Attack:** Attacker intercepts network traffic between client and server on the same network segment (ARP spoofing on LAN, rogue access point, compromised router).

**Against HTTPS + HSTS:** The attacker sees TLS-encrypted bytes. Without the server's private key (stored on the VPS, not accessible) or a valid certificate for the domain, they cannot decrypt the traffic. TLS 1.3's forward secrecy (ECDHE key exchange) means even recording the traffic and later compromising the server's TLS private key does not decrypt past sessions.

**SSL stripping (first visit only):** If the browser has never visited the site and HSTS is not yet cached, an attacker can respond to the initial HTTP request with a plain HTTP page and intercept credentials. After one successful HTTPS visit, HSTS in the browser prevents this for 2 years (the configured max-age).

**Certificate spoofing:** An attacker who can issue a certificate for the domain (compromised CA, CA with improper issuance practices) can present a fake but browser-trusted certificate and intercept HTTPS. Let's Encrypt certificates appear in Certificate Transparency logs, so fraudulent certificates are detectable. The `expect-ct` header (now deprecated, merged into CT enforcement) and monitoring of CT logs for unauthorized certificates is the recommended control.

**Summary of MITM risk:**

| MITM variant | Risk level | Mitigation |
|---|---|---|
| Classical network interception (active session) | Negligible | TLS 1.3 + HSTS blocks this completely |
| SSL stripping (first visit, no HSTS cached) | Low-Medium | HSTS preload list eliminates first-visit window |
| AiTM phishing (session relay via proxy) | **High with TOTP** / Negligible with WebAuthn | Use WebAuthn as primary 2FA |
| Compromised CA / certificate spoofing | Low | Let's Encrypt + CT logs + OCSP stapling |
| Corporate SSL inspection proxy | Medium | Inform users; WebAuthn domain-binding still protects |

The key distinction: classical MITM (network-level interception) is well-mitigated by TLS + HSTS. The dangerous residual risk is **AiTM phishing** (a proxy-based attack, not a wire-level attack), which bypasses TLS entirely because the victim willingly connects to the attacker's server. WebAuthn is the specific control that addresses this.

---

## 13. Penetration Testing Plan

Penetration testing for this system is divided into four categories: automated (run in CI), scheduled manual (quarterly), pre-deployment, and ongoing monitoring.

### 13.1 Automated Security Testing (CI/CD)

These run on every pull request and every merge to main:

| Tool | Category | What it tests |
|------|----------|---------------|
| `pnpm audit` | Dependency SCA | Known CVEs in npm dependencies |
| Snyk / Dependabot | Dependency SCA | Vulnerability alerts with remediation PRs |
| Semgrep (OWASP ruleset) | SAST | Common vulnerability patterns in TypeScript/Node |
| `eslint-plugin-security` | SAST | Insecure patterns: `eval`, `exec`, `innerHTML`, regex ReDoS |
| Trivy (Docker image scan) | Container | CVEs in base images (postgres:16-alpine, nginx:alpine, node) |
| `testssl.sh` | TLS | TLS version, cipher suites, HSTS, OCSP — run against staging |
| OWASP ZAP (baseline scan) | DAST | Automated crawl + passive vulnerability detection |

### 13.2 Pre-Deployment Security Checklist

Before any production deployment (initial or major version):

**Cryptographic controls:**
- [ ] Verify `extractable: false` on all `CryptoKey` objects (check `packages/shared/crypto.ts`)
- [ ] Verify no vault plaintext is logged (grep for `console.log` near `decryptData` calls)
- [ ] Verify no master password is logged at any point
- [ ] Verify `kdfSalt` is unique per user (random, not derived from email or static value)
- [ ] Verify IV is `crypto.getRandomValues()` per entry per save (not reused)
- [ ] Verify auth tag is validated before decrypted content is used (WebCrypto throws on invalid tag)
- [ ] Verify `authSalt` and `kdfSalt` are different (two independent Argon2id derivations)
- [ ] Verify Vault Unlock screen appears as a distinct step after login (not auto-bypassed)
- [ ] Verify vault remains locked after JWT refresh (key not re-derived without explicit master password entry)

**Master password enforcement:**
- [ ] Attempt registration with dictionary word → must be rejected (zxcvbn < 4)
- [ ] Attempt registration with keyboard walk (e.g. `Qwerty123!`) → must be rejected
- [ ] Attempt registration with l33t substitution (e.g. `P@ssw0rd!`) → must be rejected
- [ ] Attempt registration with known-breached password (e.g. `Summer2024!` from HIBP) → must be rejected
- [ ] Attempt registration with 11-character strong password → must be rejected (< 12 chars)
- [ ] Attempt registration with 12+ random chars, score 4, not breached → must succeed
- [ ] Verify HIBP check is client-side only (no master password transmitted to server — check network tab)
- [ ] Verify same validation runs on vault re-lock / re-unlock prompt (not only at registration)

**Authentication controls:**
- [ ] Verify JWT `alg` header is validated server-side (`none` algorithm rejection)
- [ ] Verify RS256 public key cannot be used to sign tokens (asymmetric key pair, not HMAC)
- [ ] Verify refresh token rotation invalidates old token on use
- [ ] Verify family revocation triggers on stale token reuse
- [ ] Verify 2FA enforcement on all vault endpoints (`TwoFactorGuard` applied)
- [ ] Verify rate limits trigger correctly for all auth endpoints

**Transport and headers:**
- [ ] Run SSL Labs test → target A+ rating
- [ ] Verify HSTS max-age >= 31536000 in prod nginx config
- [ ] Verify CSP header present and blocks inline scripts
- [ ] Verify `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`
- [ ] Verify cookie flags: `httpOnly`, `Secure`, `SameSite=Strict`

**Access control:**
- [ ] Verify IDOR protection: attempt to access another user's vault entry via ID manipulation (should 404 or 403)
- [ ] Verify vault endpoints reject requests from user A with user B's JWT
- [ ] Verify database user has no DDL permissions in production

**Container and infrastructure:**
- [ ] Verify no ports exposed except 80/443 (nginx) and SSH on non-standard port
- [ ] Verify all containers run as non-root user
- [ ] Verify `.env.prod` is not in the Docker image layers (`docker history` check)
- [ ] Verify JWT private key is not in environment variables (`docker inspect` check — must use Docker secrets)

### 13.3 Manual Penetration Test — Quarterly

Perform using Burp Suite Professional or OWASP ZAP + manual analysis following OWASP Testing Guide v4.2:

**Authentication module:**
- JWT algorithm confusion attack: send `alg: none` JWT, send HS256 JWT signed with the public key
- JWT expiry bypass: replay expired access token
- Refresh token replay: use the same refresh token twice (should trigger family revocation)
- Brute force: verify rate limiting triggers at 5 attempts, and that X-Forwarded-For spoofing does not bypass it
- 2FA bypass: attempt to access vault endpoints with a JWT where `twoFactorPassed: false`
- TOTP replay: use same TOTP code twice within a 30-second window (server should reject second use)
- WebAuthn counter replay: replay a WebAuthn assertion with stale `signCount` (server should reject)

**Vault module:**
- IDOR: enumerate vault entry IDs (UUIDs — not sequential, but test anyway)
- Mass assignment: send extra fields in vault create/update (should be rejected by `forbidNonWhitelisted`)
- Oversized payload: send extremely large `encryptedData` blob (should be rejected by body size limits)
- Content-type manipulation: send XML or form-encoded body where JSON expected

**Frontend / extension:**
- XSS: inject `<script>alert(1)</script>` in every input field visible after decryption (label, notes, URL)
- Stored XSS via vault entry: create an entry with XSS payload in label, verify it renders escaped
- CSP evaluation: use browser DevTools to verify CSP is correctly blocking inline scripts and external sources
- Cookie inspection: verify refresh token cookie has `httpOnly`, `Secure`, `SameSite=Strict`
- Extension permissions: verify extension cannot access tabs it did not explicitly request `activeTab` for

**Transport:**
- SSL stripping simulation: manually set `HTTP_PROXY` and attempt downgrade
- Cipher suite negotiation: verify no SSLv3, TLS 1.0, or weak ciphers (RC4, DES, export ciphers)
- HSTS preload: verify `includeSubDomains` does not break any non-HTTPS subdomains

### 13.4 Specific Test: AiTM Simulation

Set up a local Evilginx2 instance proxying the staging environment. Attempt:
1. Login with TOTP only → verify attacker's proxy receives valid session tokens
2. Login with WebAuthn → verify proxy cannot relay the assertion (expected: WebAuthn authentication fails at server because origin in assertion does not match `rpId`)

This test validates the single most important security property differentiating WebAuthn from TOTP: phishing resistance.

### 13.5 Ongoing Monitoring

- **Certificate Transparency monitoring:** Configure `certspotter` or `crt.sh` webhook to alert on any certificate issued for the domain outside of the Let's Encrypt issuance the system owns
- **fail2ban alerts:** Email notification when fail2ban blocks an IP for repeated 401/429 responses
- **Dependency alerts:** GitHub Dependabot or Snyk continuous monitoring with Slack/email alerts on new CVEs affecting direct dependencies
- **Audit log review:** Weekly review of `AuditLog` entries for anomalous patterns (unusual login times, large numbers of vault reads in short windows)
- **Docker image updates:** Monthly `docker pull` and rebuild of base images to pick up OS-level security patches in `postgres:16-alpine`, `redis:7-alpine`, `nginx:1.27-alpine`

---

## 14. UX Design — Mobile First

### 14.1 Decryption Always Happens Client-Side — UX Implications

**This is the most important UX constraint in the system.** Every operation that reveals vault content requires the `CryptoKey` to be present in memory on the device currently being used. There is no server-side decryption, no "view in browser via a link," no server-side PDF export of vault contents. This is a security property, not a limitation — but it shapes every UX decision.

Consequences for UX:
- Switching devices (e.g. from phone to laptop) requires a new vault unlock on the new device. The key is not synchronized.
- Vault entries cannot be shared via a server-rendered URL (there is no server-rendered content to share).
- Offline access requires the vault to have been fetched and decrypted during a previous online session. Cached in-memory entries are available until the browser tab closes.
- The loading experience includes an unavoidable ~1-2 second Argon2id derivation spinner. This must be designed as a positive "security ritual" rather than a perceived performance problem.

### 14.2 Mobile-First Layout System

The application uses Tailwind CSS's mobile-first breakpoint system (`sm:`, `md:`, `lg:`) starting from a 375px baseline. All components are designed for thumb reachability on a 6-inch phone screen before being adapted for tablet and desktop.

**Primary navigation — bottom bar on mobile, sidebar on desktop:**

```
Mobile (≤ 768px)                    Desktop (≥ 1024px)
┌────────────────────┐              ┌────────┬──────────────────────┐
│  🔒 Adyton       │              │ 🔒     │                      │
│                    │              │ Vault  │   Vault Entry List   │
│  [Entry list]      │              │ ─────  │   + Detail Panel     │
│                    │              │ Secrets│                      │
│                    │              │ ─────  │                      │
│                    │              │ Gen    │                      │
│                    │              │ ─────  │                      │
│                    │              │Settings│                      │
├────┬────┬────┬─────┤              └────────┴──────────────────────┘
│Vault│Env│Gen│Settings│
└────┴────┴────┴─────┘
```

Bottom navigation tabs on mobile: Vault · Env Secrets · Generator · Settings. Each tab is 25% width, 56px tall (exceeds Apple's 44px minimum tap target). Active tab uses violet accent. On desktop the same tabs become a left sidebar with icons + labels.

**Vault entry list — mobile optimized:**

```
┌────────────────────────────────┐
│ 🔍 Search...           [+] Add │
│ All · Login · Env · Secret     │  ← filter chips, horizontally scrollable
├────────────────────────────────┤
│ 🔵 GitHub                      │
│    alice@example.com    [copy] │
├────────────────────────────────┤
│ 🟣 PROD .env — api-service     │
│    Production · v3    [export] │
├────────────────────────────────┤
│ 🔑 STRIPE_SECRET_KEY           │
│    Production · sk_live_...    │
└────────────────────────────────┘
```

Swipe left on an entry reveals "Copy Password" and "Delete" actions (similar to iOS Mail). Swipe right reveals "Edit." This avoids requiring long-press menus, which have poor discoverability on mobile.

### 14.3 Vault Unlock — Mobile Biometric (No Third Parties)

The vault unlock step (Phase 2, entering the master password) can be enhanced on mobile with biometric authentication — without any third-party service, without push notifications, without Apple or Google involvement in the authentication flow.

**Mechanism: WebAuthn Platform Authenticator + Secure Enclave Key Wrapping**

The mobile device's Secure Enclave (Apple) or StrongBox (Android) can protect the derived `CryptoKey` across sessions. The flow:

```
First unlock on this device:
  1. User enters master password (full Argon2id derivation, ~1-2 sec)
  2. CryptoKey derived
  3. App generates a device-local WebAuthn credential (platform authenticator)
     Credential private key is stored in Secure Enclave / StrongBox
     Credential public key stored in the app's IndexedDB
  4. Raw AES-256-GCM key bytes are encrypted by the WebAuthn credential
     (via subtle.wrapKey using the authenticator's public key — only the Secure Enclave can unwrap)
  5. Wrapped key stored in IndexedDB alongside the WebAuthn credential ID
  6. User is prompted: "Enable Face ID / Touch ID / Fingerprint for future unlocks?" → Yes/No

Subsequent unlocks (biometric):
  1. "Unlock Vault" screen shows biometric prompt instead of password field
  2. User touches finger / looks at phone
  3. Device authenticates via platform authenticator (Face ID / Touch ID / Fingerprint)
     → WebAuthn assertion proves biometric passed and device holds the credential
  4. Secure Enclave unwraps the stored key bytes
  5. importKey() creates CryptoKey in memory
  6. Vault unlocked — no master password typed, no network request
```

**Third-party dependencies: zero.** The Secure Enclave / StrongBox is on-device hardware. The WebAuthn platform authenticator API is a W3C standard implemented in the OS browser engine. No push notification service is involved. No Apple ID or Google Account is required (non-synced, device-bound credentials).

**What happens if the device is stolen:**
- The wrapped key in IndexedDB is useless without the Secure Enclave to unwrap it
- The Secure Enclave requires biometric or device PIN to unlock
- After N failed biometric attempts, the device locks and the credential is invalidated
- The master password path always remains available as fallback (user can always re-derive from scratch)

**What "certified mobile device" means in this model:** A device is "certified" when the user has completed the first full master-password unlock on that device and opted into biometric protection. The device then holds a Secure Enclave credential + wrapped key. Revoking a device means deleting the WebAuthn credential from the registered credentials list (via `/auth/webauthn/credentials/:id DELETE`) — the wrapped key in IndexedDB on that device becomes permanently undecryptable.

**Implementation:** Uses the standard `@simplewebauthn/browser` + `SubtleCrypto.wrapKey` / `unwrapKey` API. No native mobile app required — works in Safari on iOS 16+ and Chrome on Android. The `authenticatorAttachment: 'platform'` flag in WebAuthn registration options ensures only the device's built-in authenticator (not a hardware key) is used for this flow.

**Cross-device unlock (desktop unlocked by phone approval):**
CTAP2 hybrid transport (QR code on desktop → phone scans → biometric on phone → desktop unlocks) is supported natively in Chrome/Safari/Edge without any third-party service. However, this uses Bluetooth for the secure channel — Apple Passkeys and Google Passkeys use their respective cloud services for passkey sync. For a fully third-party-free cross-device flow, the alternative is: enroll a **FIDO2 NFC hardware key** (YubiKey 5 NFC, ~€50) as a device-independent credential. Tap the key to the phone → NFC → WebAuthn assertion → vault unlock on any device. No cloud, no Bluetooth, no third party.

### 14.4 Argon2id Derivation — Mobile UX

The 1-2 second Argon2id derivation (m=65536, 64MB RAM, Web Worker) needs deliberate UX treatment on mobile. It must not feel like a loading failure.

```vue
<!-- VaultUnlockScreen.vue -->
<template>
  <div class="vault-unlock-screen">
    <div v-if="!isUnlocking">
      <!-- Biometric available -->
      <UButton v-if="hasBiometric" @click="unlockWithBiometric" size="xl" block>
        <UIcon name="i-heroicons-finger-print" class="mr-2" />
        Unlock with Face ID / Fingerprint
      </UButton>

      <!-- Password fallback -->
      <PasswordInput
        v-model="masterPassword"
        label="Or enter master password"
        :disabled="isUnlocking"
        @keydown.enter="unlockWithPassword"
      />
      <UButton @click="unlockWithPassword" :disabled="!masterPassword" block>
        Unlock Vault
      </UButton>
    </div>

    <!-- Derivation in progress -->
    <div v-else class="flex flex-col items-center gap-4">
      <div class="w-16 h-16 rounded-full border-4 border-violet-500 border-t-transparent animate-spin" />
      <p class="text-sm text-gray-400">Deriving encryption key…</p>
      <p class="text-xs text-gray-600">This takes ~1-2 seconds for your security</p>
    </div>
  </div>
</template>
```

The spinner copy "This takes ~1-2 seconds for your security" converts a perceived loading delay into a security signal. Users who understand crypto will appreciate it; users who don't will at minimum understand the delay is intentional.

### 14.5 PWA Device API Access — What Works and What Does Not

PWAs running in a browser sandbox have restricted access to device APIs. The table below maps every API relevant to this application across the main platforms:

| API | Chrome Android | Safari iOS | Chrome/Firefox Desktop | Notes |
|-----|---------------|------------|------------------------|-------|
| **Web Crypto API** (AES-GCM, ECDH) | ✅ | ✅ | ✅ | Core requirement — universally supported |
| **WebAuthn platform authenticator** (Face ID, fingerprint) | ✅ | ✅ iOS 16+ | ✅ | Biometric unlock works on all platforms |
| **Service Worker + Cache** | ✅ | ✅ (50MB quota) | ✅ | Offline app shell caching |
| **IndexedDB** (wrapped key storage) | ✅ | ⚠️ cleared after 7 days (ITP) | ✅ | iOS ITP is a real problem — see below |
| **Push notifications** | ✅ | ⚠️ iOS 16.4+ only if installed to Home Screen | ✅ | |
| **File System Access API** (file upload/download) | ✅ | ❌ Not supported | ✅ | iOS: must use `<input type="file">` workaround |
| **Clipboard read/write** | ✅ | ✅ (requires user gesture) | ✅ | |
| **Web Bluetooth** (CTAP2 hybrid cross-device) | ✅ | ❌ Not supported | ⚠️ Chrome only | Cross-device WebAuthn via phone doesn't work in Safari |
| **Web NFC** (YubiKey tap) | ✅ Android only | ❌ | ❌ | NFC in web: Android Chrome only |
| **System Keychain** | ❌ | ❌ | ❌ | Browser sandbox — requires native app (Tauri/Capacitor) |
| **Screen lock event** | ❌ | ❌ | ❌ | Requires native app |
| **Global keyboard shortcuts** | ❌ | ❌ | ❌ | Requires native app (Tauri) or extension |
| **`beforeinstallprompt`** (native install banner) | ✅ | ❌ | ✅ Chrome | iOS: user must manually use "Add to Home Screen" from Safari share menu |
| **Background sync** | ✅ | ❌ | ✅ | |

### 14.6 The iOS Reality — Why "PWA on Apple" Is Limited

The user's concern is well-founded. The iOS PWA situation has historically been poor and remains significantly inferior to Android Chrome or desktop. The specific problems for this application:

**Problem 1 — ITP storage clearing (most impactful):**
Safari's Intelligent Tracking Prevention deletes IndexedDB, service worker caches, and other storage for origins that have not been visited in 7 days. This means:
- The wrapped `CryptoKey` stored for biometric unlock → deleted after 7-day inactivity
- WebAuthn credential IDs in IndexedDB → deleted
- User must re-enter master password and re-enroll biometric
- For a password manager used infrequently (e.g. only when setting up a new server), this happens constantly

When installed as a PWA (added to Home Screen), Apple applies somewhat more lenient ITP rules — the installed app has its own storage partition. But the 7-day baseline can still apply. This is not a solvable problem within the PWA sandbox.

**Problem 2 — No `beforeinstallprompt`:**
Android Chrome shows a native "Install" banner automatically. On iOS, the user must know to tap the share icon → "Add to Home Screen." Most users never discover this. For a personal tool used by one person, this is acceptable friction.

**Problem 3 — No Web Bluetooth, No Web NFC:**
Cross-device WebAuthn (phone approves desktop login via Bluetooth QR code) does not work in Safari. YubiKey NFC tap does not work in Safari. The only WebAuthn option on iOS is the platform authenticator (Face ID/Touch ID) — which does work well.

**Problem 4 — No File System Access API:**
The ENV file import/export uses `<input type="file">` as a workaround (file picker, no drag-and-drop to arbitrary paths). This is less convenient but functional. Download of `.env` files works via `URL.createObjectURL` — Safari supports this.

**Conclusion for iOS:** The core vault operations (read, write, encrypt, decrypt, biometric unlock via Face ID) work on iOS Safari PWA. The limitations are around peripheral features and storage durability. For a single technical user, the iOS PWA is functional but not polished.

### 14.7 Capacitor — The iOS-Native Alternative

**Capacitor** (by Ionic) wraps the existing Nuxt 4 web app in a native iOS/Android shell. It is not a rewrite — the same Vue components, Pinia stores, and `packages/shared` crypto run inside a WKWebView (iOS) or Android WebView. Capacitor adds a plugin bridge to native device APIs.

```
apps/web (Nuxt 4)
    │
    └─ apps/mobile (Capacitor wrapper)
        ├── ios/           # Xcode project (Swift shell, WKWebView)
        ├── android/       # Android Studio project (Kotlin shell, WebView)
        └── capacitor.config.ts
```

Capacitor plugins that solve the iOS limitations:

| Plugin | What it provides | iOS limitation it solves |
|--------|-----------------|--------------------------|
| `@capacitor/secure-storage` | Stores key in iOS Keychain (never cleared by ITP) | ITP 7-day deletion |
| `@capacitor/biometrics` | Native Face ID / Touch ID with Keychain integration | Better than WebAuthn platform auth in WKWebView |
| `@capacitor/filesystem` | Native file picker, save to Files app | No File System Access API in Safari |
| `@capacitor/clipboard` | Clipboard access, can detect reads on newer iOS | Partial clipboard monitoring |
| `@capacitor-community/bluetooth-le` | BLE access (for future cross-device features) | No Web Bluetooth in Safari |
| `@capacitor/push-notifications` | APNs push (no iOS 16.4 restriction) | Push only from Home Screen in PWA |

With Capacitor, the Keychain integration works identically to Tauri on desktop:

```typescript
// capacitor: store derived key in iOS Keychain (never cleared by ITP)
import { SecureStorage } from '@capacitor/secure-storage';

async function storeWrappedKey(wrappedKey: ArrayBuffer): Promise<void> {
  await SecureStorage.set({
    key: 'vault-encryption-key',
    value: arrayBufferToBase64(wrappedKey),
  });
}

async function loadWrappedKey(): Promise<ArrayBuffer | null> {
  try {
    const { value } = await SecureStorage.get({ key: 'vault-encryption-key' });
    return base64ToArrayBuffer(value);
  } catch {
    return null; // First launch or user deleted app
  }
}
```

The iOS Keychain storage is protected by the device passcode and optionally by Face ID/Touch ID — the same Secure Enclave protection as the WebAuthn approach, but without the ITP clearing problem.

**Capacitor vs pure PWA — when to choose:**

| Scenario | Recommendation |
|----------|---------------|
| Personal use, infrequent iOS access | PWA — acceptable despite ITP |
| Daily iOS use, biometric unlock every day | Capacitor iOS app — Keychain storage, no ITP |
| Android primary device | PWA (Chrome Android is excellent) |
| Desktop primary use | Tauri desktop app |

**App Store distribution:** A Capacitor iOS app requires an Apple Developer account (€99/year) and App Store review. For a self-hosted personal tool this adds operational burden. Alternative: **AltStore** or **Sideloadly** for sideloading without App Store, or EU alternative marketplaces (iOS 17.4+ in EU). For a truly self-contained personal deployment, sideloading the Capacitor app is a viable option.

### 14.8 PWA Configuration

For the web and Android use cases, the PWA is configured via `@vite-pwa/nuxt`:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@vite-pwa/nuxt'],
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Adyton',
      short_name: 'Adyton',
      description: 'Zero-knowledge personal password vault',
      theme_color: '#0f172a',
      background_color: '#0f172a',
      display: 'standalone',
      orientation: 'portrait',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,wasm}'],
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/.*\/api\//,
          handler: 'NetworkOnly', // NEVER cache API responses — vault ciphertext must not sit in SW cache
        },
      ],
    },
  },
});
```

`NetworkOnly` for all `/api/` responses is non-negotiable. The service worker must never cache vault API responses — not because the ciphertext is dangerous (it is opaque), but because cached auth tokens or response metadata could leak session information.

### 14.7 UX Flows — Key Screens

**Registration:**
```
Email → Password (strength meter + HIBP check in real time)
      → Confirm password → [Create Account]
      → (auto-login) → Vault Unlock screen → (derive key) → Empty vault
      → "Add your first entry" CTA
```

**Login (returning user, no 2FA):**
```
Email → Password → [Login]
      → (server validates) → Vault Unlock screen
      → Enter master password → [Unlock] → Argon2id spinner → Vault
```

**Login (returning user, WebAuthn 2FA):**
```
Email → Password → [Login]
      → (server: requires 2FA) → "Verify your identity" → [Use Passkey]
      → Platform authenticator prompt (Face ID / fingerprint / hardware key)
      → (server issues full JWT) → Vault Unlock screen
      → (if biometric enrolled) → [Unlock with Face ID] → vault ready in <500ms
      → (if not enrolled) → master password entry → Argon2id → vault ready
```

**ENV_FILE entry — mobile create:**
```
[+] Add → ENV File → 
  Name: [api-service PROD     ]
  Environment: [Production ▾  ]
  Paste or upload .env:
  [ DATABASE_URL=postgres://... ]
  [ REDIS_URL=redis://...       ]
  [ ... multiline textarea      ]
  [Save] → encrypts → stored
```

**ENV_FILE entry — mobile view:**
```
 api-service PROD  🟢 Production  v3
 ─────────────────────────────────
 DATABASE_URL      ●●●●●●●●  [copy] [reveal]
 REDIS_URL         ●●●●●●●●  [copy] [reveal]
 STRIPE_SECRET_KEY ●●●●●●●●  [copy] [reveal]
 ─────────────────────────────────
 [Download .env]  [Version history]  [Edit]
```

All value fields masked by default. Reveal toggle shows plaintext for 30 seconds then re-masks automatically. Copy clears clipboard after 30 seconds.

---

## 15. PWA vs Desktop App (Tauri) — Trade-off Analysis

### 15.1 The Core Trade-off

A PWA running in a browser sandbox has fundamental capabilities restrictions that a native desktop app does not. For a password manager, several of these restrictions are directly relevant to security and UX quality:

| Capability | PWA (browser) | Desktop app (Tauri) |
|-----------|---------------|---------------------|
| System keychain integration | ❌ No (Web Crypto keys stay in browser memory) | ✅ Yes (macOS Keychain, Windows Credential Manager, Linux Secret Service) |
| Auto-lock on screen lock | ❌ No (browser has no screen lock event) | ✅ Yes (OS-level hook) |
| Clipboard monitoring and forced clear | ⚠️ Partial (can clear on timer; cannot detect external clipboard read) | ✅ Yes (OS clipboard API) |
| Global keyboard shortcuts | ❌ No | ✅ Yes (system-wide hotkey to open vault) |
| System tray / menubar | ❌ No | ✅ Yes (vault accessible from tray without opening full window) |
| Browser extension integration | Separate extension required | ✅ Native autofill via accessibility API |
| Offline vault access | ⚠️ Limited (service worker cache; iOS clears after 7 days) | ✅ Yes (SQLite local encrypted store) |
| Auto-update | ✅ Yes (service worker) | ✅ Yes (Tauri updater) |
| Install friction | ✅ Zero (URL-based, "Add to Home Screen") | ⚠️ Requires download + install |
| Mobile support | ✅ Yes (PWA on iOS/Android) | ❌ Tauri mobile is experimental (as of 2025) |
| Single codebase | ✅ Yes | ✅ Yes (Tauri wraps the same Nuxt frontend) |
| Binary size | N/A (no download) | ~8MB (Tauri uses OS WebView; not bundled like Electron) |
| Memory footprint | Browser tab (~150-300MB) | ~50-80MB (no Chromium bundled) |

### 15.2 Why Tauri Over Electron

If a desktop app is built, **Tauri** is unambiguously the correct choice over Electron for this project:

- **Security model:** Tauri's backend is Rust (memory-safe, no Node.js process with file system access). The frontend runs in the OS WebView (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) in an isolated sandbox. Electron runs a full Chromium browser with Node.js access — a malicious script in an Electron app has significantly larger attack surface.
- **Size:** Tauri installer ~5-8MB vs Electron ~120MB. For a security-focused self-hosted app distributed over a personal VPS, Tauri is far more appropriate.
- **Same frontend code:** The Nuxt 4 app runs inside Tauri's WebView without modification. `packages/shared` crypto works identically (WebView supports Web Crypto API). Zero frontend duplication.
- **Tauri plugins:** `tauri-plugin-stronghold` provides hardware-backed key storage using the IOTA Stronghold security protocol. Keys stored in Stronghold survive app restart but cannot be extracted from the binary or memory without the vault password. This is a significant upgrade over in-memory Pinia store.

### 15.3 Key Advantages of the Tauri Desktop App

**System Keychain Integration (most important security improvement):**

```rust
// Tauri backend (Rust): store derived key in macOS Keychain / Windows Credential Manager
use keyring::Entry;

fn store_adyton_key(key_bytes: &[u8]) -> Result<(), keyring::Error> {
    let entry = Entry::new("adyton", "vault-encryption-key")?;
    entry.set_password(&hex::encode(key_bytes))?;
    Ok(())
}

fn load_adyton_key() -> Result<Vec<u8>, keyring::Error> {
    let entry = Entry::new("adyton", "vault-encryption-key")?;
    let hex = entry.get_password()?;
    Ok(hex::decode(hex).unwrap())
}
```

On macOS, this stores the key in Keychain Access, protected by the user's login password and optionally by Touch ID. The key persists across app restarts — the user unlocks once per login session, not once per app launch. Auto-lock still applies (Tauri can hook the OS screen lock event via `tauri-plugin-screen-lock`).

**Screen Lock Auto-Lock:**

```rust
// React to screen lock event — clears the in-memory key reference
tauri::Builder::default()
    .plugin(tauri_plugin_screen_lock::init())
    .on_screen_lock(|_app| {
        // Emit event to frontend to clear Pinia store
        app.emit_all("vault:lock", ()).unwrap();
    })
```

When the OS screen locks, the frontend receives the `vault:lock` event and calls `useCryptoStore().lock()`. This is not possible in a browser PWA — the browser has no screen lock event.

**Global Keyboard Shortcut:**

```rust
app.global_shortcut_manager()
    .register("CmdOrCtrl+Shift+V", || {
        // Show vault window and focus search
        app.get_window("main").unwrap().show().unwrap();
        app.emit_all("vault:focus-search", ()).unwrap();
    })
```

`Cmd+Shift+V` opens the vault from anywhere on the OS — no need to switch to the browser, open a tab, wait for the PWA to load. For a password manager, this is a significant daily-use UX improvement.

**Clipboard Monitoring:**

```rust
// Clear clipboard after 30 seconds AND if another app reads it
use clipboard_master::{ClipboardHandler, Master};

struct VaultClipboardMonitor;
impl ClipboardHandler for VaultClipboardMonitor {
    fn on_clipboard_change(&mut self) {
        // Another app read the clipboard — if our data was there, clear immediately
        app.emit_all("vault:clipboard-read", ()).unwrap();
    }
}
```

In a browser PWA, clipboard clearing is timer-based only. A malicious app that reads the clipboard within the 30-second window gets the password. Tauri can monitor clipboard access and clear proactively when another process reads it.

### 15.4 Recommended Architecture: Layered Client Strategy

No single client type covers all use cases optimally. The recommended approach uses three client targets, all sharing the same backend API and `packages/shared` crypto:

```
                    packages/shared (crypto, types, validation)
                           │
          ┌────────────────┼───────────────────┐
          │                │                   │
    apps/web           apps/api          apps/extension
   (Nuxt 4 PWA)    (NestJS/Fastify)     (MV3 Chrome/FF)
       │   │
       │   └─ apps/mobile (Capacitor)
       │       ├── ios/   (Xcode, WKWebView + Keychain plugins)
       │       └── android/ (Kotlin, WebView — optional if PWA sufficient)
       │
       └─ apps/desktop (Tauri)
           src-tauri/  (Rust: keychain, screen lock, global shortcut)
           (frontend = same Nuxt 4 build, no duplication)
```

**Client selection by use case:**

| Use case | Recommended client | Why |
|----------|-------------------|-----|
| Daily use on iPhone | **Capacitor iOS app** | Keychain (no ITP), native Face ID, proper install |
| Daily use on Android | **PWA** (Chrome) | Chrome PWA on Android is excellent, zero install friction |
| Desktop macOS/Windows/Linux | **Tauri** | System keychain, screen-lock auto-lock, global shortcut |
| Browser autofill | **MV3 Extension** | Only client that can inject into forms |
| Occasional access any browser | **PWA** | Zero install, works everywhere |

**Deployment summary:**
- PWA + API: served by nginx on VPS
- Desktop: `.dmg` / `.msi` / `.AppImage` built via CI, hosted as GitHub release or VPS download
- iOS: Capacitor `.ipa` — sideloaded (AltStore / direct) or App Store (requires €99/year Apple Developer account)
- Android: Capacitor `.apk` — sideloaded, or Google Play (requires €25 one-time)
- Extension: `.crx` / `.xpi`

**Capacitor is a first-class deliverable, not an iOS fallback.** The decision to build `apps/mobile` with Capacitor is made from Phase 1 — it is in the monorepo from the start. The mobile app wraps the same Nuxt 4 build (zero code duplication) and adds only a thin native layer (Keychain plugin, biometric plugin, screen-lock plugin). Android can use PWA or Capacitor depending on preference; iOS requires Capacitor due to ITP.

For a strictly personal self-hosted tool: Capacitor covers iOS (and Android optionally); PWA covers Android + all desktop browsers; Tauri covers desktop with advanced OS integration; extension covers browser autofill. All clients share zero duplicated security-critical code.

### 15.5 Feature Matrix by Client Type

| Feature | Android PWA | iOS PWA (Safari) | Capacitor iOS | Tauri Desktop | MV3 Extension |
|---------|------------|------------------|---------------|---------------|---------------|
| Core vault CRUD | ✅ | ✅ | ✅ | ✅ | ✅ (read+copy) |
| AES-256-GCM encrypt/decrypt | ✅ | ✅ | ✅ | ✅ | ✅ |
| Biometric unlock | ✅ (WebAuthn) | ✅ (Face ID, iOS 16+) | ✅ (native Face ID) | ✅ (Touch ID / Windows Hello) | ❌ |
| Biometric key storage (no ITP) | ✅ IndexedDB | ⚠️ deleted after 7d | ✅ iOS Keychain | ✅ OS Keychain | ❌ |
| Auto-lock on screen lock | ❌ | ❌ | ✅ (Capacitor plugin) | ✅ (OS event hook) | ❌ |
| Global keyboard shortcut | ❌ | ❌ | ❌ | ✅ | ✅ (extension shortcut) |
| Browser autofill | ❌ | ❌ | ❌ | ❌ | ✅ |
| ENV file upload | ✅ | ⚠️ `<input>` only | ✅ native picker | ✅ native picker | ❌ |
| ENV file download (.env) | ✅ | ✅ | ✅ save to Files | ✅ native save | ❌ |
| Offline app shell | ✅ SW cache | ✅ SW cache | ✅ bundled | ✅ bundled | N/A |
| Push notifications | ✅ | ⚠️ only if installed HS | ✅ APNs | ✅ | ❌ |
| Web Bluetooth (cross-device WebAuthn) | ✅ | ❌ | ❌ Safari engine | ⚠️ Chrome only | ❌ |
| Install required | No (Add HS) | No (Add HS) | Yes (.ipa) | Yes (.dmg etc) | Yes |
| App Store required | No / Play Store | No / App Store | Optional | No | No |
| Zero frontend code duplication | ✅ | ✅ | ✅ same Nuxt | ✅ same Nuxt | ✅ shared package |

---

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
