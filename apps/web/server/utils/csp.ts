import { randomBytes } from 'node:crypto'

export function generateNonce(): string {
  return randomBytes(16).toString('base64')
}

// NuxtUI injects this exact cleanup script client-side via useHead at app mount
// (it removes the SSR `<style data-nuxt-ui-colors>` once Tailwind has loaded). unhead
// re-creates the element in the DOM without copying our per-request nonce, so the nonce
// alone can never cover it. The script body is a fixed string with no build-variable
// content, so its hash is stable across builds. Allowed by hash, independent of the nonce.
// If a NuxtUI upgrade changes the bytes, the browser console reports the new hash and the
// regression test in csp.spec.ts fails — regenerate it then.
// Source string: document.head.removeChild(document.querySelector('[data-nuxt-ui-colors]'))
export const NUXT_UI_COLOR_CLEANUP_HASH =
  "'sha256-tYCcUbFfjZ9QESuTWESGWrFg2SmiEdyD2MYUfRWUgK0='"

export function buildCspHeader(nonce: string, apiBaseUrl?: string): string {
  const connectSrc = ["'self'", 'https://api.pwnedpasswords.com']
  if (apiBaseUrl) connectSrc.push(apiBaseUrl)

  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}' ${NUXT_UI_COLOR_CLEANUP_HASH}`,
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
