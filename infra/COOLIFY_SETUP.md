# Adyton — Coolify Setup Guide

Step-by-step walkthrough for deploying Adyton on an existing Coolify instance.
Assumes: Coolify already installed on VPS, GitHub repo accessible, domain pointing to VPS.

---

## 1. Generate secrets locally (one-time)

Run on your local machine (the keys must exist before setting Coolify env vars).
Each environment gets its own subdirectory so dev keys are never overwritten.

```powershell
# Windows — generates into secrets/staging/
.\scripts\gen-keys.ps1 staging

# For production
.\scripts\gen-keys.ps1 prod
```

```bash
# macOS / Linux
./scripts/gen-keys.sh staging
./scripts/gen-keys.sh prod
```

This produces `secrets/staging/jwt_private.pem`, `secrets/staging/jwt_public.pem`, `secrets/staging/totp_enc.key` (and equivalently for prod).
Keep these files — you'll paste their contents into Coolify and GitHub in the steps below.

**Never commit them.** `.gitignore` already excludes `*.pem` and `*.key` everywhere.

---

## 2. Create Coolify resources (PostgreSQL + Redis)

In Coolify, before creating the application:

### 2a. PostgreSQL

1. Sidebar → **Resources** → **New Resource** → **Database** → **PostgreSQL**
2. Set:
   - Name: `adyton-db`
   - Version: `16`
   - Database name: `adyton`
   - Username: `adyton`
   - Password: generate a strong one and save it
3. Click **Save** → **Start**
4. After start, open the resource and copy the **Internal Connection URL** — looks like:
   ```
   postgresql://adyton:<password>@adyton-db:5432/adyton
   ```
   You'll use this as `DATABASE_URL` in step 4.

### 2b. Redis

1. Sidebar → **Resources** → **New Resource** → **Database** → **Redis**
2. Set:
   - Name: `adyton-redis`
   - Version: `7`
   - Password: generate one and save it
3. Click **Save** → **Start**
4. Copy the **Internal Connection URL** — looks like:
   ```
   redis://:password@adyton-redis:6379
   ```
   You'll use this as `REDIS_URL` in step 4.

> **Why internal URLs?** The API container connects to DB and Redis over Docker's internal `coolify` network — no need for host-level port exposure.

---

## 3. Create the application

1. Sidebar → **Projects** → your project → **New Resource** → **Docker Compose**
2. Set the **source**:
   - **Source**: GitHub (connect your GitHub account if not already done)
   - **Repository**: `your-org/adyton`
   - **Branch**: `staging` (for staging) or `main` (for production)
   - **Compose file**: `docker-compose.prod.yml`  ← **important, not the default**
3. Click **Save**

---

## 4. Set environment variables

In the application resource → **Environment Variables** tab. Add all of the following:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | `postgresql://adyton:<pw>@adyton-db:5432/adyton` | From step 2a |
| `REDIS_URL` | `redis://:password@adyton-redis:6379` | From step 2b |
| `JWT_PRIVATE_KEY` | *(full PEM — see below)* | Contents of `secrets/staging/jwt_private.pem` |
| `JWT_PUBLIC_KEY` | *(full PEM — see below)* | Contents of `secrets/staging/jwt_public.pem` |
| `TOTP_ENC_KEY` | *(64 hex chars)* | Contents of `secrets/staging/totp_enc.key` (single line) |
| `WEBAUTHN_RP_ID` | `vault.yourdomain.com` | Your actual domain, no protocol |
| `WEBAUTHN_ORIGIN` | `https://vault.yourdomain.com` | Full origin with https |
| `ALLOWED_ORIGINS` | `https://vault.yourdomain.com` | Same as WEBAUTHN_ORIGIN |
| `NUXT_PUBLIC_API_BASE_URL` | `https://vault.yourdomain.com/api` | Must end in `/api` |
| `RUN_MIGRATIONS` | `true` | Auto-applies pending DB migrations on API boot |
| `NODE_ENV` | `production` | |

### Pasting multi-line PEM keys

Coolify's env var editor accepts multi-line values. Paste the full PEM content including the `-----BEGIN/END-----` lines. Example:

```
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
...rest of key...
-----END RSA PRIVATE KEY-----
```

Alternatively, encode as a single line to avoid UI issues:

```bash
# On local machine — produces a base64 single-line string
base64 -w0 secrets/jwt_private.pem
```

Then in the API source code you'd need to decode it — simpler to just paste the multi-line PEM directly (Coolify handles it).

---

## 5. Configure domain routing

1. Application resource → **Domains** tab
2. Add domains:
   - `vault.yourdomain.com` → service `web`, port `3000`
   - `vault.yourdomain.com/api` → service `api`, port `3001`

   Or if you want the API on a subdomain:
   - `vault.yourdomain.com` → `web` port `3000`
   - `api.vault.yourdomain.com` → `api` port `3001`  
     *(then update `NUXT_PUBLIC_API_BASE_URL` to `https://api.vault.yourdomain.com/api`)*

3. Enable **HTTPS** (Let's Encrypt) — Coolify/Caddy handles the certificate automatically.

> **DNS prerequisite:** `vault.yourdomain.com` must point to your VPS IP (A record, or Cloudflare proxied).

---

## 6. First deploy

1. Application resource → click **Deploy**
2. Watch the **Deployment Logs** — the build takes ~3–5 minutes (pnpm install + TypeScript compile for both api and web)
3. Verify these lines appear in the API logs (after deploy completes):
   ```
   [MikroORM] migrations applied (6 run)
   [NestApplication] Nest application successfully started
   ```
4. Check health:
   ```bash
   curl https://vault.yourdomain.com/api/health
   # → {"status":"ok","timestamp":"2026-06-07T..."}
   ```

If migrations are missing from the log, check that `RUN_MIGRATIONS=true` is set in env vars.

---

## 7. Smoke test

1. Navigate to `https://vault.yourdomain.com` → should redirect to `/login`
2. Register a new account
3. Login → unlock vault with master password
4. Create a test entry → verify it saves and decrypts correctly
5. Lock and re-unlock → entry still readable

---

## 8. Get the deploy webhook URL (for GitHub Actions)

1. Application resource → **Webhooks** tab (or **Settings** → **Webhook**)
2. Copy the **Deploy Webhook URL** — looks like:
   ```
   https://your-coolify.example.com/api/v1/deploy?uuid=abc123&token=xyz789
   ```
3. Add this URL as a GitHub secret: **Settings → Secrets → Actions → New secret**
   - Name: `COOLIFY_WEBHOOK_STAGING`
   - Value: the webhook URL

---

## 9. Set GitHub Actions secrets

In GitHub repo → **Settings → Secrets → Actions**, add:

| Secret | Value |
|--------|-------|
| `TOTP_ENC_KEY` | 64-char hex from `secrets/staging/totp_enc.key` |
| `JWT_PRIVATE_KEY` | Full PEM content of `secrets/staging/jwt_private.pem` |
| `JWT_PUBLIC_KEY` | Full PEM content of `secrets/staging/jwt_public.pem` |
| `COOLIFY_WEBHOOK_STAGING` | Webhook URL from step 8 |
| `COOLIFY_WEBHOOK_PROD` | Placeholder for now (set when prod environment exists) |

After this, every push to the `staging` branch will:
1. Run CI (typecheck + unit + integration tests + audit)
2. On success, call the Coolify webhook → Coolify rebuilds and redeploys

---

## 10. Ongoing operations

### Deploy a new version

```bash
git checkout staging
git merge develop    # or cherry-pick specific commits
git push origin staging
# → GitHub Actions runs CI → webhook fires → Coolify redeploys
```

### View logs

Coolify → application resource → **Logs** tab. Both `api` and `web` service logs available.

### Run a one-off command (e.g. manual migration)

Coolify → application resource → **Terminal** tab → select `api` container:

```bash
pnpm exec mikro-orm migration:up
```

### Rotate secrets

1. Generate new keys locally (`scripts/gen-keys.sh` — it refuses to overwrite existing files; delete them first)
2. Update in Coolify env vars
3. Update in GitHub Actions secrets
4. Redeploy (all active JWT sessions will be invalidated — users must log in again)

**Warning:** Rotating `TOTP_ENC_KEY` is destructive — all enrolled TOTP secrets become unrecoverable and every user must re-enroll 2FA.

### Backup database

Coolify-managed PostgreSQL: connect via the internal connection URL from Coolify dashboard.
For scheduled backups, see `scripts/backup.sh` and the cron setup in `infra/README.md`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Build fails: `pnpm install` error | pnpm version mismatch in Dockerfile vs lockfile | Check `pnpm@9.15.4` in Dockerfile matches `engines.pnpm` |
| API starts but 500 on login | Missing `JWT_PRIVATE_KEY` | Check env var is set and includes full PEM headers |
| API starts but 500 on 2FA setup | Missing `TOTP_ENC_KEY` | Check env var is exactly 64 hex chars |
| Vault entries fail to decrypt | `NUXT_PUBLIC_API_BASE_URL` points to wrong host | Must match actual deployed API URL |
| WebAuthn registration fails | `WEBAUTHN_RP_ID` mismatch | `rpID` must match the domain exactly (no protocol, no path) |
| Migrations not applied | `RUN_MIGRATIONS` not set to `true` | Set in Coolify env vars and redeploy |
| CORS errors in browser | `ALLOWED_ORIGINS` missing | Set to `https://vault.yourdomain.com` |
