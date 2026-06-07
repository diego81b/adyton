# Adyton — Coolify Setup Guide

Step-by-step walkthrough for deploying Adyton on an existing Coolify instance (v4.x).
Assumes: Coolify already installed on VPS, GitHub repo accessible, domain pointing to VPS.

---

## 1. Generate secrets locally (one-time)

Run on your local machine before touching Coolify — you'll paste the output into the dashboard.

```powershell
# Windows
.\scripts\gen-keys.ps1 staging   # → secrets/staging/
.\scripts\gen-keys.ps1 prod      # → secrets/prod/
```

```bash
# macOS / Linux
./scripts/gen-keys.sh staging
./scripts/gen-keys.sh prod
```

Produces three files per env:

| File | Used as |
|------|---------|
| `jwt_private.pem` | `JWT_PRIVATE_KEY` env var |
| `jwt_public.pem` | `JWT_PUBLIC_KEY` env var |
| `totp_enc.key` | `TOTP_ENC_KEY` env var (64 hex chars) |

**Never commit these.** `.gitignore` already excludes `*.pem` and `*.key` everywhere.

---

## 2. Create a Coolify project

In Coolify v4, all resources (databases, apps) live inside a project.

1. Sidebar → **Projects** → **+ New Project**
2. Name it `adyton` (or `adyton-staging` / `adyton-prod`)
3. Click **Create** — you land on the project's environment page
4. Coolify creates a default **production** environment; rename it to `staging` or create a new one as needed

---

## 3. Add databases inside the project

Both PostgreSQL and Redis are Coolify-managed resources created within the project.

### 3a. PostgreSQL

1. Inside the project/environment → **+ Add Resource** → **Database** → **PostgreSQL**
2. Set:
   - Name: `adyton-db`
   - Version: `16`
   - Database name: `adyton`
   - Username: `adyton`
   - Password: generate a strong one and save it
3. Click **Save** → **Start**
4. The internal connection URL is built from the values you just set — no need to hunt for it in the UI:
   ```
   postgresql://adyton:<password>@adyton-db:5432/adyton
   ```
   The hostname (`adyton-db`) is the **Name** you set in step 2. Save this string — it becomes `DATABASE_URL` in step 5.

   > Coolify may also show this URL in the resource detail page under a **Connections** or **Overview** section — if you see it there, you can copy it directly.

### 3b. Redis

1. Inside the project/environment → **+ Add Resource** → **Database** → **Redis**
2. Set:
   - Name: `adyton-redis`
   - Version: `7`
   - Username: `adyton` (or leave `default`)
   - Password: generate a strong one and save it (`openssl rand -hex 32`)
3. Click **Save** → **Start**
4. Build the internal URL from the values above:
   ```
   redis://adyton:<password>@adyton-redis:6379
   ```
   Again, the hostname (`adyton-redis`) is the **Name** from step 2. Save this — it becomes `REDIS_URL` in step 5.

> **Why internal URLs?** The API container reaches DB and Redis over the shared `coolify` Docker network — no host-level port exposure needed.

---

## 4. Add the application

Still inside the same project/environment:

1. **+ Add Resource** → **Application** → **Public or Private Repository (Git)**
   - If first time: authorise the Coolify GitHub App and install it on your repo
2. Select your repository `your-org/adyton`
3. Coolify shows a configuration form. Fill in:

   | Field | Value |
   |-------|-------|
   | **Name** | `adyton-staging` (or `adyton-prod`) |
   | **Branch** | `staging` (or `main` for prod) |
   | **Base directory** | `/` (repo root — leave default) |
   | **Build pack** | **Docker Compose** |
   | **Docker Compose location** | `docker-compose.staging.yml` (staging) or `docker-compose.prod.yml` (prod) ← not the default `docker-compose.yml` |

4. Click **Save** — Coolify reads the compose file and discovers the `api` and `web` services.

> **Service Stack vs Application:** "Service Stack" lets you paste a compose file directly with no Git source. Use **Application** (from Git) here so Coolify tracks the branch and triggers rebuilds on push.

> **`coolify` network:** `docker-compose.prod.yml` declares `coolify` as an external network. Coolify creates this network automatically on install — no manual action needed.

---

## 5. Set environment variables

Application resource → **Environment Variables** tab. Add all of the following:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | `postgresql://adyton:<pw>@adyton-db:5432/adyton` | From step 3a |
| `REDIS_URL` | `redis://:password@adyton-redis:6379` | From step 3b |
| `JWT_PRIVATE_KEY` | *(full PEM)* | `cat secrets/staging/jwt_private.pem` |
| `JWT_PUBLIC_KEY` | *(full PEM)* | `cat secrets/staging/jwt_public.pem` |
| `TOTP_ENC_KEY` | *(64 hex chars)* | `cat secrets/staging/totp_enc.key` |
| `WEBAUTHN_RP_ID` | `adyton.diegobaldeschi.dev` | Frontend domain only, no protocol |
| `WEBAUTHN_ORIGIN` | `https://adyton.diegobaldeschi.dev` | Frontend full origin |
| `ALLOWED_ORIGINS` | `https://adyton.diegobaldeschi.dev` | Frontend origin (CORS) |
| `NUXT_PUBLIC_API_BASE_URL` | `https://api.adyton.diegobaldeschi.dev` | API origin — no `/api` suffix (app adds it) |
| `RUN_MIGRATIONS` | `true` | Auto-applies pending DB migrations on API boot |
| `NODE_ENV` | `production` | |

### Pasting multi-line PEM keys

Coolify's env var editor accepts multi-line values. Paste the full PEM including the `-----BEGIN/END-----` lines:

```
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
-----END RSA PRIVATE KEY-----
```

---

## 6. Configure Cloudflare DNS

> **Cloudflare vs Coolify:** Coolify handles routing *inside* the VPS (which container serves which domain). Cloudflare handles external DNS — it points the domain to the VPS IP. Do this step first; Coolify needs the domain to resolve when it requests the Let's Encrypt certificate.

### 6a. Find the VPS IP

**Hetzner Cloud Console** (`console.hetzner.cloud`) → select the server → copy the **IPv4** address shown in the server overview. This is the IP you put in all Cloudflare A records.

> **Multiple apps on the same VPS:** all apps share this single IP. Coolify's built-in Caddy proxy routes traffic by domain name (`Host` header) — each app just needs different domains pointing to the same IP.

### 6b. Add DNS records (Cloudflare dashboard)

**dash.cloudflare.com → select domain `diegobaldeschi.dev` → DNS → Records → Add record:**

| Type | Name | Content | Proxy status |
|------|------|---------|-------|
| A | `adyton` | `<VPS IPv4>` | Proxied (orange cloud) |
| A | `api.adyton` | `<VPS IPv4>` | Proxied (orange cloud) |

### 6b. Harden Cloudflare settings

Still in the Cloudflare dashboard for `diegobaldeschi.dev`:

1. **SSL/TLS → Overview** → **Full (Strict)** — Coolify/Caddy provides the origin cert via Let's Encrypt automatically
2. **SSL/TLS → Edge Certificates → Always Use HTTPS → ON**
3. **Security → Bots → Bot Fight Mode → ON**
4. **Security → WAF → Managed Rules → ON**

---

## 7. Configure domain routing in Coolify

Application resource → **General** tab → scroll to the **Domains** section.

Enter the full URL (with `https://`) for each service:

| Full URL | Service |
|----------|---------|
| `https://adyton.diegobaldeschi.dev` | `web` |
| `https://api.adyton.diegobaldeschi.dev` | `api` |

Coolify/Caddy requests a Let's Encrypt certificate automatically when you save. No manual HTTPS toggle — the `https://` prefix in the URL is what enables it.

---

## 8. First deploy

1. Application resource → click **Deploy**
2. Build takes ~3–5 min (pnpm install + TypeScript compile for both services)
3. Check API container logs — should contain:
   ```
   [MikroORM] migrations applied (6 run)
   [NestApplication] Nest application successfully started
   ```
4. Verify health endpoint:
   ```bash
   curl https://api.adyton.diegobaldeschi.dev/api/health
   # → {"status":"ok","timestamp":"..."}
   ```

If migrations log is missing, confirm `RUN_MIGRATIONS=true` is set.

---

## 9. Smoke test

1. `https://adyton.diegobaldeschi.dev` → redirects to `/login`
2. Register → login → unlock vault with master password
3. Create a test entry → verify it saves and decrypts
4. Lock and re-unlock → entry still readable

---

## 10. Wire up CI/CD (GitHub Actions)

### Get the Coolify webhook

Application resource → **Configuration** tab → **Deploy Webhook URL**:

```
https://your-coolify.host/api/v1/deploy?uuid=abc123&token=xyz789
```

### Set GitHub Actions secrets

GitHub repo → **Settings → Secrets → Actions**:

| Secret | Value |
|--------|-------|
| `JWT_PRIVATE_KEY` | Full PEM — `cat secrets/staging/jwt_private.pem` |
| `JWT_PUBLIC_KEY` | Full PEM — `cat secrets/staging/jwt_public.pem` |
| `TOTP_ENC_KEY` | 64 hex chars — `cat secrets/staging/totp_enc.key` |
| `COOLIFY_WEBHOOK_STAGING` | Webhook URL from above |
| `COOLIFY_WEBHOOK_PROD` | Placeholder (set when prod env is ready) |

After this, every push to `staging` branch:
1. GitHub Actions runs CI (typecheck + unit + integration + audit)
2. On green: calls the webhook → Coolify rebuilds and redeploys

---

## 11. Ongoing operations

### Deploy a new version

```bash
git checkout staging
git merge develop
git push origin staging
# CI runs → webhook fires → Coolify redeploys
```

### View logs

Application resource → **Logs** tab. Select `api` or `web` service.

### Run a one-off command (e.g. manual migration)

Application resource → **Terminal** tab → select `api` container:

```bash
pnpm exec mikro-orm migration:up
```

### Rotate secrets

1. Delete old files, regenerate: `./scripts/gen-keys.sh staging`
2. Update Coolify env vars
3. Update GitHub Actions secrets
4. Redeploy — all active JWT sessions invalidated, users must re-login

**Warning:** Rotating `TOTP_ENC_KEY` is destructive — all enrolled TOTP secrets become unrecoverable; every user must re-enroll 2FA.

### Backup database

See cron setup in the main `README.md` (Production deployment → Backup section).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Build fails: `pnpm install` error | pnpm version mismatch | `pnpm@9.15.4` in Dockerfile must match lockfile |
| API 500 on login | Missing `JWT_PRIVATE_KEY` | Check env var includes full PEM headers |
| API 500 on 2FA setup | Missing or malformed `TOTP_ENC_KEY` | Must be exactly 64 hex chars |
| Vault entries fail to decrypt | Wrong `NUXT_PUBLIC_API_BASE_URL` | Must match actual deployed API URL, end in `/api` |
| WebAuthn registration fails | `WEBAUTHN_RP_ID` mismatch | Must match domain exactly — no protocol, no path, no port |
| Migrations not applied | `RUN_MIGRATIONS` not `true` | Set in env vars and redeploy |
| CORS errors | Missing `ALLOWED_ORIGINS` | Set to the deployed origin (e.g. `https://adyton.diegobaldeschi.dev`) |
