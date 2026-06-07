# `secrets/`

Holds the RS256 keypair that signs JWT access tokens, plus the AES-256-GCM key
that encrypts account-2FA TOTP secrets at rest (`totp_enc.key`).

**Never commit anything from this directory.** `.gitignore` enforces that only
`.gitkeep` and this `README.md` are tracked.

## Generate the keypair

POSIX (Git Bash, macOS, Linux):

```bash
./scripts/gen-keys.sh
```

Windows PowerShell:

```powershell
./scripts/gen-keys.ps1
```

Both scripts produce:

- `secrets/jwt_private.pem` — 4096-bit RSA private key (signs access tokens)
- `secrets/jwt_public.pem`  — public counterpart (verifies access tokens)
- `secrets/totp_enc.key`    — 32-byte hex AES-256-GCM key (encrypts TOTP secrets
  at rest; sanctioned zero-knowledge exception, see
  `analysis/security/architecture.md` §3.5)

The scripts refuse to overwrite existing files. Delete them manually if you
need to rotate the keypair.

**Rotating `totp_enc.key` is destructive:** every enrolled TOTP secret becomes
unrecoverable and all users must re-enroll 2FA. Back it up with the same care
as the database.

## How they are consumed

**Dev:** `docker-compose.yml` mounts both PEM files as Docker secrets. NestJS reads them via `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH`. TOTP key is read from `secrets/totp_enc.key` (via `TOTP_ENC_KEY_PATH` or default path).

**CI (GitHub Actions):** All three secrets are passed as plain env vars — `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `TOTP_ENC_KEY`. The loaders check env vars first and skip file access entirely. Store these as GitHub Actions secrets (Settings → Secrets → Actions).

**Production (Coolify):** Same env var approach — paste values into the Coolify dashboard. No files on disk. See `infra/README.md` for the full env var table.
