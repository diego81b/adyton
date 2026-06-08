import { randomBytes } from 'node:crypto'

export function generateNonce(): string {
  return randomBytes(16).toString('base64')
}

export function buildCspHeader(nonce: string, apiBaseUrl?: string): string {
  const connectSrc = ["'self'", 'https://api.pwnedpasswords.com']
  if (apiBaseUrl) connectSrc.push(apiBaseUrl)

  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ')
}

export function injectNonce(chunks: string[], nonce: string): string[] {
  return chunks.map(s =>
    s.replace(/<script(?=[>\s])(?![^>]*\bnonce\b)/g, `<script nonce="${nonce}"`)
  )
}
