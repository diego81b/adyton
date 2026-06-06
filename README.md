# Adyton

> ἄδυτον — the inner sanctum, accessible only to the priest.

Self-hosted, zero-knowledge password manager and `.env` / production secrets vault.
The server stores opaque ciphertext only. Encryption and decryption happen exclusively in the browser.

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
| 5 | Nuxt vault UI | In progress — list, entry detail/edit, version history, per-entry TOTP, generator + settings pending |
| 6 | 2FA (TOTP + WebAuthn) | — |
| 7 | Browser extension (MV3) | — |
| 8 | Production hardening | — |
| 9 | Capacitor mobile (iOS + Android) | — |

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
