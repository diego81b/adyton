# `secrets/`

Holds the RS256 keypair that signs JWT access tokens.

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

The scripts refuse to overwrite existing files. Delete them manually if you
need to rotate the keypair.

## How they are consumed

Locally, `docker-compose.yml` mounts both files as Docker secrets at
`/run/secrets/jwt_private_key` and `/run/secrets/jwt_public_key`. The NestJS
config reads those paths (`JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`).

In production (Coolify), the PEM content is pasted as a multiline env var; no
files exist on disk. See `analysis/infrastructure.md` §9.5.
