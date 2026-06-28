#!/usr/bin/env bash
# Generate the RS256 keypair and TOTP encryption key for a given environment.
# Usage: ./scripts/gen-keys.sh [dev|staging|prod]
# Default: dev
#
# Keys are written to secrets/<env>/ — never to the repo root.
# Refuses to overwrite existing keys — delete them manually to rotate.

set -euo pipefail

ENV="${1:-dev}"
case "${ENV}" in
  dev|staging|prod) ;;
  *) echo "[gen-keys] Unknown env '${ENV}'. Use: dev | staging | prod" >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SECRETS_DIR="${REPO_ROOT}/secrets/${ENV}"
PRIVATE_KEY="${SECRETS_DIR}/jwt_private.pem"
PUBLIC_KEY="${SECRETS_DIR}/jwt_public.pem"

if ! command -v openssl >/dev/null 2>&1; then
    echo "[gen-keys] openssl is required but was not found in PATH." >&2
    exit 1
fi

mkdir -p "${SECRETS_DIR}"

if [[ -f "${PRIVATE_KEY}" || -f "${PUBLIC_KEY}" ]]; then
    echo "[gen-keys] Refusing to overwrite. Existing key files:" >&2
    [[ -f "${PRIVATE_KEY}" ]] && echo "  - ${PRIVATE_KEY}" >&2
    [[ -f "${PUBLIC_KEY}"  ]] && echo "  - ${PUBLIC_KEY}"  >&2
    echo "Remove them manually if you intend to rotate the keypair." >&2
    exit 1
fi

echo "[gen-keys] Generating 4096-bit RSA private key for env=${ENV}…"
openssl genrsa -out "${PRIVATE_KEY}" 4096

echo "[gen-keys] Extracting public key…"
openssl rsa -in "${PRIVATE_KEY}" -pubout -out "${PUBLIC_KEY}"

chmod 600 "${PRIVATE_KEY}" 2>/dev/null || true
chmod 644 "${PUBLIC_KEY}"  2>/dev/null || true

TOTP_KEY="${SECRETS_DIR}/totp_enc.key"
if [[ -f "${TOTP_KEY}" ]]; then
    echo "[gen-keys] ${TOTP_KEY} already exists — leaving it untouched."
else
    echo "[gen-keys] Generating 32-byte TOTP encryption key…"
    openssl rand -hex 32 > "${TOTP_KEY}"
    chmod 600 "${TOTP_KEY}" 2>/dev/null || true
fi

echo ""
echo "[gen-keys] Done (env=${ENV})."
echo "  private: ${PRIVATE_KEY}"
echo "  public:  ${PUBLIC_KEY}"
echo "  totp:    ${TOTP_KEY}"
echo ""
if [[ "${ENV}" == "dev" ]]; then
    echo "Next: docker compose up -d"
else
    # Write a ready-to-paste Coolify env file (gitignored, same folder as the keys).
    # Base64 for the PEMs — Coolify mangles multiline values; the API loader decodes
    # base64 automatically (see jwt.strategy.ts normalizePem).
    ENV_FILE="${SECRETS_DIR}/coolify-env.txt"
    {
        echo "# Adyton ${ENV} — Coolify env values. GITIGNORED, plaintext secrets."
        echo "# Source of truth = the .pem/.key files in this folder. Safe to delete this file."
        echo "# Regenerated every time you run gen-keys for this env."
        echo ""
        echo "JWT_PRIVATE_KEY=$(openssl base64 -A -in "${PRIVATE_KEY}")"
        echo ""
        echo "JWT_PUBLIC_KEY=$(openssl base64 -A -in "${PUBLIC_KEY}")"
        echo ""
        echo "TOTP_ENC_KEY=$(tr -d '\r\n' < "${TOTP_KEY}")"
    } > "${ENV_FILE}"
    chmod 600 "${ENV_FILE}" 2>/dev/null || true

    echo "Next: paste these into Coolify / GitHub Actions secrets."
    echo "  env file (ready to copy): ${ENV_FILE}"
fi
