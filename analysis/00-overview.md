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

