#!/usr/bin/env bash
# Generate the RS256 keypair used by NestJS to sign JWT access tokens.
# Refuses to overwrite existing keys — delete them manually to rotate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SECRETS_DIR="${REPO_ROOT}/secrets"
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

echo "[gen-keys] Generating 4096-bit RSA private key…"
openssl genrsa -out "${PRIVATE_KEY}" 4096

echo "[gen-keys] Extracting public key…"
openssl rsa -in "${PRIVATE_KEY}" -pubout -out "${PUBLIC_KEY}"

# Best-effort permissions tightening (no-op on Windows filesystems).
chmod 600 "${PRIVATE_KEY}" 2>/dev/null || true
chmod 644 "${PUBLIC_KEY}"  2>/dev/null || true

# Server-held AES-256-GCM key encrypting account-2FA TOTP secrets at rest
# (sanctioned ZK exception, analysis/security/architecture.md §3.5).
TOTP_KEY="${SECRETS_DIR}/totp_enc.key"
if [[ -f "${TOTP_KEY}" ]]; then
    echo "[gen-keys] ${TOTP_KEY} already exists — leaving it untouched."
else
    echo "[gen-keys] Generating 32-byte TOTP encryption key…"
    openssl rand -hex 32 > "${TOTP_KEY}"
    chmod 600 "${TOTP_KEY}" 2>/dev/null || true
fi

echo ""
echo "[gen-keys] Done."
echo "  private: ${PRIVATE_KEY}"
echo "  public:  ${PUBLIC_KEY}"
echo "  totp:    ${TOTP_KEY}"
echo ""
echo "Next: cp .env.example .env && docker compose up -d"
