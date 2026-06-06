# Adyton

> ἄδυτον — the inner sanctum, accessible only to the priest.

Self-hosted, zero-knowledge password manager and `.env` / production secrets vault.
The server stores opaque ciphertext only. Encryption and decryption happen exclusively in the browser.

## How it works

You have one master password. You never type it anywhere except the unlock screen — it never leaves your device.

When you unlock the vault, your browser takes that password and runs it through a slow, expensive algorithm (Argon2id) to produce a secret key. It uses that key to encrypt your passwords before sending them to the server, and to decrypt them when you need to read one. The server only ever sees scrambled data — even if someone broke into the server, they could not read a single password.

When you close the browser or the vault locks automatically, the key is wiped from memory. To read anything again, you need to type the master password and derive the key again. This is by design.

**Two-factor authentication** adds a second check at login time (a 6-digit code from an authenticator app, a hardware key, or your phone's fingerprint). Once you are logged in, unlocking the vault only needs the master password — 2FA is a login gate, not a key-derivation step.

**What the server knows:** your email address, a scrambled version of your master password (for login verification), and encrypted blobs it cannot read. Nothing else.

**What the server does not know:** your master password, the key derived from it, or any plaintext secret.

## Security model

Encryption and decryption happen exclusively in the browser. The server never sees:

- The master password (not transmitted, not stored)
- The derived vault key (Argon2id → AES-256-GCM, held in browser memory only, non-extractable)
- Any plaintext secret

The server stores: Argon2id-hashed passwords, AES-256-GCM ciphertext blobs, SHA-256 hashed refresh tokens, plaintext metadata only (entry type, env tag).

See `analysis/security/` for the full threat model, attack vectors, and pentest plan.

## Stack

| Layer | Technology |
|---|---|
| Backend | NestJS 11, Fastify 5, MikroORM 6, PostgreSQL 16, Redis 7 |
| Auth | JWT RS256 — 15 min access / 7-day httpOnly refresh, Argon2id passwords |
| Frontend | Nuxt 4, NuxtUI 4, TailwindCSS, Pinia |
| Monorepo | pnpm workspaces |
| Dev infra | Docker Compose — 4 services (db, redis, api, web) |
| Production | Hetzner VPS, Coolify + Traefik + Cloudflare (Phase 8) |

## Project structure

```
apps/
  api/        @adyton/api    — NestJS backend
  web/        @adyton/web    — Nuxt 4 frontend
  extension/  reserved       — MV3 browser extension (Phase 7)
  mobile/     reserved       — Capacitor (Phase 9)
packages/
  shared/     @adyton/shared — crypto primitives + shared types (Phase 4)
analysis/     full technical design (~5000 lines) — read before changing architecture
secrets/      RS256 keypair — never committed
```

## Setup

### Prerequisites

- Node.js 22, pnpm 9, Docker + Compose v2

### Generate RS256 keys

```powershell
.\scripts\gen-keys.ps1
# or on POSIX:
./scripts/gen-keys.sh
```

### Start dev stack

```bat
run dev
```

| Endpoint | URL |
|---|---|
| Web | http://localhost:30000 |
| API | http://localhost:30001 |
| Swagger | http://localhost:30001/api-docs |
| Health | http://localhost:30001/health |

### Tests

```bash
pnpm --filter @adyton/api test:cov   # unit + coverage
pnpm --filter @adyton/api test:int   # integration (Docker required)
pnpm typecheck                        # TS check all workspaces
pnpm lint                             # ESLint flat config
```

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo scaffold, Docker, test harness | Done |
| 2 | NestJS auth (JWT, sessions, devices, PoW) | Done |
| 3 | MikroORM vault entities + migrations + vault API | Done |
| 4 | `packages/shared` crypto + Nuxt auth flows | Done |
| 5 | Nuxt vault UI | Done |
| 6 | 2FA (TOTP + WebAuthn passkeys) | Done |
| 7 | Browser extension (MV3) | — |
| 8 | Production hardening | — |
| 9 | Capacitor mobile (iOS + Android) | — |

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
