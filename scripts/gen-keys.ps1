#requires -Version 5.1
<#
.SYNOPSIS
    Generate the RS256 keypair and TOTP encryption key for a given environment.

.DESCRIPTION
    Writes keys to secrets/<env>/ (default: dev).
    Refuses to overwrite existing keys (delete them manually to rotate).
    Prefers `openssl` if available; falls back to Node `crypto.generateKeyPairSync`.

.PARAMETER Env
    Target environment: dev | staging | prod (default: dev)

.EXAMPLE
    ./scripts/gen-keys.ps1           # → secrets/dev/
    ./scripts/gen-keys.ps1 staging  # → secrets/staging/
    ./scripts/gen-keys.ps1 prod     # → secrets/prod/
#>
param(
    [ValidateSet('dev', 'staging', 'prod')]
    [string]$Env = 'dev'
)

$ErrorActionPreference = 'Stop'

$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot    = Resolve-Path (Join-Path $scriptDir '..')
$secretsDir  = Join-Path $repoRoot "secrets\$Env"
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
    Write-Host "[gen-keys] Using openssl at $($openssl.Source) (env=$Env)"
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
    Write-Host "[gen-keys] openssl not found - falling back to Node crypto.generateKeyPairSync (env=$Env)"

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

$totpKey = Join-Path $secretsDir 'totp_enc.key'
if (Test-Path $totpKey) {
    Write-Host "[gen-keys] $totpKey already exists - leaving it untouched." -ForegroundColor Yellow
}
else {
    Write-Host "[gen-keys] Generating 32-byte TOTP encryption key..."
    $bytes = [byte[]]::new(32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $hex = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    Set-Content -LiteralPath $totpKey -Value $hex -Encoding ascii -NoNewline
}

Write-Host ""
Write-Host "[gen-keys] Done (env=$Env)." -ForegroundColor Green
Write-Host "  private: $privateKey"
Write-Host "  public:  $publicKey"
Write-Host "  totp:    $totpKey"
Write-Host ""
if ($Env -eq 'dev') {
    Write-Host "Next: docker compose up -d"
} else {
    Write-Host "Next: paste contents into Coolify env vars / GitHub Actions secrets"
    Write-Host "  JWT_PRIVATE_KEY  = Get-Content $privateKey -Raw"
    Write-Host "  JWT_PUBLIC_KEY   = Get-Content $publicKey -Raw"
    Write-Host "  TOTP_ENC_KEY     = Get-Content $totpKey -Raw"
}
