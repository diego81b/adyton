# Adyton

> ἄδυτον — the inner sanctum, accessible only to the priest.

Self-hosted, zero-knowledge password manager and `.env` / production secrets vault.
The server stores opaque ciphertext only. Encryption and decryption happen exclusively in the browser.

## How it works

Adyton is a vault. Like a physical safe, only you can open it — not the server it runs on, not anyone who breaks into that server.

**The master password is your combination.** You type it once to unlock. It never leaves your device — not over the network, not to the server, not in any log. Your browser uses it to derive a cryptographic key (Argon2id, a deliberately slow algorithm designed to resist brute force). That key scrambles every secret before it touches the network, and unscrambles it after it comes back. The server holds encrypted blobs it cannot read.

**What you can store:** passwords and usernames (with per-entry TOTP codes for sites that require them), secure notes, credit cards, identities, `.env` files, and arbitrary secrets. Each entry is encrypted individually with a different nonce.

**The server is blind.** It stores your email, a hashed password (for login), and encrypted blobs. It cannot read them, search inside them, or hand them to anyone in useful form — even under a court order, even if it gets compromised. This is the zero-knowledge property.

**When you close the tab or walk away**, the key is wiped from memory. Re-opening the vault means re-typing the master password. There is no copy of the key on disk, in the database, or on the server. This is by design.

**Two-factor authentication** adds a second check at login — a one-time code from an authenticator app, or a passkey. It protects your account if someone steals your password. It does not affect vault decryption; that is still the master password's job. Unlocking an already-open session only requires the master password.

**Passkeys** are a modern, phishing-resistant alternative to one-time codes. Your phone or laptop holds a private key; the server stores only the public half. Even a perfect copy of the login page cannot steal a passkey because it is cryptographically bound to this exact domain.

**Recovery codes** are eight single-use emergency tickets generated when you enable 2FA. If you lose your phone, one code gets you in. The server stores only their hashes — never the codes themselves. Each works exactly once.

**What the server knows:** your email, a hashed password, and ciphertext it cannot read. Nothing else.

**What the server will never know:** your master password, the key derived from it, or any plaintext secret.

> **No password recovery.** If you forget your master password, your vault cannot be recovered — not by you, not by the server, not by anyone. The server never sees or stores the master password or the key it produces. There is no reset link, no email recovery, no back door. Write your master password down and store it somewhere safe (a physical safe, a trusted person, a separate backup manager). This is not a bug; it is the zero-knowledge property.

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
| CI/CD | GitHub Actions — typecheck + unit + integration + audit on every push; deploy on `staging` push / `v*` tag |
| Production | Hetzner VPS, Coolify + Caddy + Cloudflare |

## Project structure

```
apps/
  api/        @adyton/api    — NestJS backend
  web/        @adyton/web    — Nuxt 4 frontend
  extension/  reserved       — MV3 browser extension (post-V1)
  mobile/     reserved       — Capacitor (Phase 8)
packages/
  shared/     @adyton/shared — crypto primitives + shared types
analysis/     full technical design (~5000 lines) — read before changing architecture
infra/        COOLIFY_SETUP.md — step-by-step Coolify deployment guide
scripts/      gen-keys, backup, VPS setup
secrets/      RS256 keypair + TOTP key — never committed
```

## Development setup

### Prerequisites

- Node.js 22, pnpm 9, Docker + Compose v2

### Generate dev keys

```powershell
.\scripts\gen-keys.ps1       # → secrets/dev/
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
| Mailpit (email inspector) | http://localhost:8025 |

### Tests

```bash
pnpm --filter @adyton/api test:cov   # unit + coverage
pnpm --filter @adyton/api test:int   # integration (Docker required)
pnpm typecheck                        # TS check all workspaces
pnpm lint                             # ESLint flat config
```

## Production deployment

Deployment target: Hetzner VPS running Coolify + Caddy, behind Cloudflare.

For the full step-by-step guide see **[infra/COOLIFY_SETUP.md](infra/COOLIFY_SETUP.md)**.

### VPS initial setup (once)

```bash
bash scripts/setup-vps.sh   # UFW rules, swap, sysctl hardening
# then install Coolify per https://coolify.io/docs
```

### Keys per environment

Each environment gets its own subdirectory under `secrets/`:

```powershell
.\scripts\gen-keys.ps1 staging   # → secrets/staging/
.\scripts\gen-keys.ps1 prod      # → secrets/prod/
```

### Required env vars (Coolify dashboard)

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | From Coolify-managed PostgreSQL resource |
| `REDIS_URL` | From Coolify-managed Redis resource |
| `JWT_PRIVATE_KEY` | Full PEM — `cat secrets/staging/jwt_private.pem` |
| `JWT_PUBLIC_KEY` | Full PEM — `cat secrets/staging/jwt_public.pem` |
| `TOTP_ENC_KEY` | 64 hex chars — `cat secrets/staging/totp_enc.key` |
| `WEBAUTHN_RP_ID` | Frontend domain, e.g. `adyton.diegobaldeschi.dev` |
| `WEBAUTHN_ORIGIN` | Frontend full origin, e.g. `https://adyton.diegobaldeschi.dev` |
| `ALLOWED_ORIGINS` | Frontend origin (CORS), e.g. `https://adyton.diegobaldeschi.dev` |
| `NUXT_PUBLIC_API_BASE_URL` | API origin, e.g. `https://api-adyton.diegobaldeschi.dev` (no `/api` suffix) |
| `RUN_MIGRATIONS` | `true` on staging; unset on prod (apply SQL manually) |
| `TOTP_ISSUER` | Label shown in authenticator apps. Default: `Adyton`. Use `Adyton [DEV]` in dev to distinguish environments. |
| `SMTP_HOST` | SMTP server hostname. When unset, email notifications are silently skipped. Recommended: `smtp.resend.com` (Resend — 3 000 free emails/month, handles deliverability). |
| `SMTP_PORT` | SMTP port. Default: `587`. |
| `SMTP_SECURE` | Set `true` for port 465 SSL. Default: `false` (STARTTLS). |
| `SMTP_USER` | SMTP auth username. For Resend: `resend`. |
| `SMTP_PASS` | SMTP auth password. For Resend: the API key. |
| `SMTP_FROM` | Verified sender address. Must match a domain verified in your SMTP provider. |

### CI/CD

GitHub Actions runs typecheck + unit + integration + audit on every push.
Push to `staging` branch or tag `v*` triggers a Coolify rebuild via webhook.

GitHub secrets needed: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `TOTP_ENC_KEY`, `COOLIFY_WEBHOOK_STAGING`, `COOLIFY_WEBHOOK_PROD`.

### Backup

Daily PostgreSQL dump, 7-day daily + 4-week weekly retention:

```
0 2 * * * PGHOST=127.0.0.1 PGUSER=adyton PGDATABASE=adyton PGPASSWORD=<pw> \
  BACKUP_DIR=/var/backups/adyton bash /opt/adyton/scripts/backup.sh
```

Optional offsite via rclone: set `RCLONE_DEST=s3:bucket/adyton`.

### Attack mitigation

No fail2ban in V1 (Coolify log paths not stable; Cloudflare WAF + app-level progressive delay sufficient).
Defense layers: Cloudflare WAF → `@fastify/rate-limit` per-IP caps → `ProgressiveDelayService` exponential back-off on failed logins.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo scaffold, Docker, test harness | Done |
| 2 | NestJS auth (JWT, sessions, devices, PoW) | Done |
| 3 | MikroORM vault entities + migrations + vault API | Done |
| 4 | `packages/shared` crypto + Nuxt auth flows | Done |
| 5 | Nuxt vault UI | Done |
| 6 | 2FA (TOTP + WebAuthn passkeys) | Done |
| 7 | Production hardening (Dockerfiles, CI/CD, backup, security audit) | Done |
| 8 | Capacitor mobile (iOS + Android) | — |
| — | Browser extension (MV3) | Post-V1 — security design pending |

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
