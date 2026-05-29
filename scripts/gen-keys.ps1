#requires -Version 5.1
<#
.SYNOPSIS
    Generate the RS256 keypair used by NestJS to sign JWT access tokens.

.DESCRIPTION
    Writes secrets/jwt_private.pem and secrets/jwt_public.pem.
    Refuses to overwrite existing keys (delete them manually to rotate).
    Prefers `openssl` if available; falls back to Node `crypto.generateKeyPairSync`.

.EXAMPLE
    ./scripts/gen-keys.ps1
#>

$ErrorActionPreference = 'Stop'

$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot    = Resolve-Path (Join-Path $scriptDir '..')
$secretsDir  = Join-Path $repoRoot 'secrets'
$privateKey  = Join-Path $secretsDir 'jwt_private.pem'
$publicKey   = Join-Path $secretsDir 'jwt_public.pem'

if (-not (Test-Path $secretsDir)) {
    New-Item -ItemType Directory -Path $secretsDir | Out-Null
}

if ((Test-Path $privateKey) -or (Test-Path $publicKey)) {
    Write-Host "[gen-keys] Refusing to overwrite. Existing key files:" -ForegroundColor Yellow
    if (Test-Path $privateKey) { Write-Host "  - $privateKey" }
    if (Test-Path $publicKey)  { Write-Host "  - $publicKey"  }
    Write-Host "Remove them manually if you intend to rotate the keypair." -ForegroundColor Yellow
    exit 1
}

$openssl = Get-Command openssl -ErrorAction SilentlyContinue

if ($openssl) {
    Write-Host "[gen-keys] Using openssl at $($openssl.Source)"
    & $openssl.Source genrsa -out $privateKey 4096
    if ($LASTEXITCODE -ne 0) { throw "openssl genrsa failed (exit $LASTEXITCODE)" }
    & $openssl.Source rsa -in $privateKey -pubout -out $publicKey
    if ($LASTEXITCODE -ne 0) { throw "openssl rsa -pubout failed (exit $LASTEXITCODE)" }
}
else {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Neither openssl nor node is available in PATH. Install one and retry."
    }
    Write-Host "[gen-keys] openssl not found - falling back to Node crypto.generateKeyPairSync"

    # PowerShell native-arg quoting mangles strings passed via `node -e`
    # (quotes get stripped, TS-eval can misinterpret content). Safer: write
    # the script to a tmp file and run it directly. Single-quoted here-string
    # so $-prefixed identifiers stay literal; closing '@ MUST be at column 0.
    $nodeScript = @'
const fs = require("node:fs");
const { generateKeyPairSync } = require("node:crypto");
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 4096,
  publicKeyEncoding:  { type: "spki",  format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
fs.writeFileSync(process.env.JWT_PRIV_OUT, privateKey);
fs.writeFileSync(process.env.JWT_PUB_OUT,  publicKey);
'@

    $tmpScript = Join-Path ([System.IO.Path]::GetTempPath()) ("adyton-genkeys-" + [Guid]::NewGuid().ToString('N') + '.cjs')
    Set-Content -LiteralPath $tmpScript -Value $nodeScript -Encoding ascii -NoNewline

    $env:JWT_PRIV_OUT = $privateKey
    $env:JWT_PUB_OUT  = $publicKey
    try {
        & $node.Source $tmpScript
        if ($LASTEXITCODE -ne 0) { throw "Node keypair generation failed (exit $LASTEXITCODE)" }
    }
    finally {
        Remove-Item Env:JWT_PRIV_OUT -ErrorAction SilentlyContinue
        Remove-Item Env:JWT_PUB_OUT  -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "[gen-keys] Done." -ForegroundColor Green
Write-Host "  private: $privateKey"
Write-Host "  public:  $publicKey"
Write-Host ""
Write-Host "Next: cp .env.example .env ; docker compose up -d"
