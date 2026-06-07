# `secrets/`

Holds the RS256 keypair (JWT signing) and the AES-256-GCM key (TOTP encryption at rest).
Organised by environment so dev, staging, and prod keys never overwrite each other.

**Never commit anything from this directory.** `.gitignore` allows only `.gitkeep` and this `README.md`.

## Directory layout

```
secrets/
  dev/       ← local dev (Docker Compose mounts these)
  staging/   ← staging keys (paste into Coolify + GitHub secrets)
  prod/      ← production keys (paste into Coolify + GitHub secrets)
```

## Generate keys

```powershell
# Windows — generates into secrets/<env>/
.\scripts\gen-keys.ps1           # dev (default)
.\scripts\gen-keys.ps1 staging
.\scripts\gen-keys.ps1 prod
```

```bash
# macOS / Linux
./scripts/gen-keys.sh            # dev (default)
./scripts/gen-keys.sh staging
./scripts/gen-keys.sh prod
```

Each run produces three files in the target subdirectory:

| File | Purpose |
|------|---------|
| `jwt_private.pem` | 4096-bit RSA private key — signs JWT access tokens |
| `jwt_public.pem` | Public counterpart — verifies JWT access tokens |
| `totp_enc.key` | 32-byte hex AES-256-GCM key — encrypts TOTP secrets at rest (sanctioned ZK exception, see `analysis/security/architecture.md` §3.5) |

Scripts refuse to overwrite existing files. Delete manually to rotate.

**Rotating `totp_enc.key` is destructive:** every enrolled TOTP secret becomes unrecoverable and all users must re-enroll 2FA.

## How they are consumed

**Dev:** `docker-compose.yml` mounts `secrets/dev/*.pem` and `secrets/dev/totp_enc.key` as Docker secrets. NestJS reads them via `JWT_*_KEY_PATH` / `TOTP_ENC_KEY_PATH` env vars (set by `docker-compose.dev.yml`). The default fallback path is `secrets/dev/` so `docker compose up` works without any extra env vars.

**CI (GitHub Actions):** All three secrets are passed as plain env vars — `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `TOTP_ENC_KEY`. Generate a dedicated CI key set or reuse the staging set. Store in GitHub Actions secrets (Settings → Secrets → Actions).

**Staging / Production (Coolify):** Same env var approach — paste values into the Coolify dashboard. No files on disk. See `infra/COOLIFY_SETUP.md` step 1 for the exact commands.
