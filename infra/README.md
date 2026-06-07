# Adyton — Infrastructure

Deployment target: single Hetzner VPS running Coolify + Caddy, behind Cloudflare.

## Stack

| Layer | Tool |
|-------|------|
| DNS / WAF | Cloudflare (proxied, orange cloud) |
| Reverse proxy | Caddy (managed by Coolify) |
| Container platform | Coolify |
| Container runtime | Docker |
| OS | Ubuntu 24.04 LTS |

## Initial VPS setup

Run once after provisioning:

```bash
bash scripts/setup-vps.sh
```

Then install Coolify per their docs. Coolify manages Caddy, TLS (Let's Encrypt), and container lifecycle.

## Coolify deployment pattern

Adyton uses **build-from-source** — Coolify builds from the Dockerfile in the repo rather than pulling a pre-built image from a registry. This avoids the need for GHCR or Docker Hub.

Compose file for production: `docker-compose.prod.yml` (standalone, not an overlay over the dev base compose).

1. Add the GitHub repo to Coolify
2. Set compose file to `docker-compose.prod.yml`
3. Set all required env vars in Coolify dashboard (see table below)
4. For staging: set `RUN_MIGRATIONS=true` (auto-applies pending migrations on boot)
5. For prod: leave `RUN_MIGRATIONS=false`; extract and apply SQL manually with `pnpm --filter @adyton/api migration:sql`

## Required env vars (Coolify dashboard)

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | From Coolify-managed PostgreSQL resource |
| `REDIS_URL` | From Coolify-managed Redis resource |
| `JWT_PRIVATE_KEY` | RS256 PEM content — generate with `scripts/gen-keys.sh` |
| `JWT_PUBLIC_KEY` | RS256 PEM content |
| `TOTP_ENC_KEY` | 64 hex chars (32 bytes) — generate: `openssl rand -hex 32` |
| `WEBAUTHN_RP_ID` | The real domain, e.g. `vault.yourdomain.com` |
| `WEBAUTHN_ORIGIN` | Full origin, e.g. `https://vault.yourdomain.com` |
| `ALLOWED_ORIGINS` | Same as WEBAUTHN_ORIGIN |
| `NUXT_PUBLIC_API_BASE_URL` | `https://vault.yourdomain.com/api` |
| `RUN_MIGRATIONS` | `true` on staging, unset/`false` on prod |

## Backup

Daily PostgreSQL dump with 7-day daily / 4-week weekly retention:

```bash
PGHOST=... PGPASSWORD=... BACKUP_DIR=/var/backups/adyton bash scripts/backup.sh
```

Add to cron (as root, once per day at 02:00):

```
0 2 * * * PGHOST=127.0.0.1 PGPORT=5432 PGUSER=adyton PGDATABASE=adyton PGPASSWORD=<pass> BACKUP_DIR=/var/backups/adyton /opt/adyton/scripts/backup.sh >> /var/log/adyton-backup.log 2>&1
```

Optional offsite: set `RCLONE_DEST=s3:my-bucket/adyton` — requires `rclone` installed and configured.

## CI/CD

GitHub Actions (`.github/workflows/`):

- **ci.yml** — runs on every push and PR: typecheck, unit tests, integration tests, `pnpm audit`
- **deploy.yml** — push to `staging` branch → triggers Coolify staging rebuild; `v*` tag on `main` → triggers production rebuild

GitHub secrets required:
- `TOTP_ENC_KEY` — same 64-char hex as Coolify env var
- `JWT_PRIVATE_KEY` — RS256 PEM (full key content, not path)
- `JWT_PUBLIC_KEY` — RS256 PEM
- `COOLIFY_WEBHOOK_STAGING` — Coolify deploy webhook URL for staging
- `COOLIFY_WEBHOOK_PROD` — Coolify deploy webhook URL for production

## Rate limiting and attack mitigation

Adyton does not use fail2ban (see decision below). Defense layers are:

1. **Cloudflare WAF** — absorbs volumetric attacks before they hit the VPS
2. **App-level progressive delay** (`ProgressiveDelayService`) — exponential back-off on failed login attempts, keyed by IP (Redis)
3. **Rate limit headers** — `@fastify/rate-limit` enforces per-IP request caps on auth endpoints

### fail2ban decision — DEFERRED post-V1

fail2ban is not installed in V1. Reasons:
- Cloudflare WAF handles volumetric/bot traffic before it reaches the VPS; Traefik/Caddy logs are the attack surface fail2ban would analyze, but in Coolify's containerized setup the log path and format are not stable.
- App-level Redis progressive delay covers the credential-stuffing threat model.
- fail2ban adds complexity (log format fragility, Docker network NAT obscuring real IPs) for marginal incremental protection given the two layers above.

Revisit post-V1 if Cloudflare is removed or if app-level rate limiting proves insufficient.
