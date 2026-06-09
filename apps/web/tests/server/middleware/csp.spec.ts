import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  generateNonce,
  buildCspHeader,
  injectNonce,
  NUXT_UI_COLOR_CLEANUP_HASH,
} from '../../../server/utils/csp'

describe('generateNonce', () => {
  it('returns a base64 string', () => {
    const nonce = generateNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('returns unique values', () => {
    expect(generateNonce()).not.toBe(generateNonce())
  })
})

describe('buildCspHeader', () => {
  it('contains nonce and the NuxtUI cleanup hash in script-src', () => {
    const header = buildCspHeader('abc123')
    expect(header).toContain("'nonce-abc123'")
    expect(header).toContain(
      `script-src 'self' 'wasm-unsafe-eval' 'nonce-abc123' ${NUXT_UI_COLOR_CLEANUP_HASH}`,
    )
  })

  it('pins the NuxtUI cleanup hash to its source script', () => {
    // The exact inline script NuxtUI re-injects client-side at mount. If a NuxtUI
    // upgrade changes this string, this test fails — recompute the hash from the new
    // bytes (browser console reports it) and update NUXT_UI_COLOR_CLEANUP_HASH.
    const script = "document.head.removeChild(document.querySelector('[data-nuxt-ui-colors]'))"
    const hash = createHash('sha256').update(script, 'utf8').digest('base64')
    expect(NUXT_UI_COLOR_CLEANUP_HASH).toBe(`'sha256-${hash}'`)
  })

  it('includes HIBP endpoint in connect-src', () => {
    const header = buildCspHeader('n')
    expect(header).toContain('https://api.pwnedpasswords.com')
  })

  it('includes API base URL in connect-src when provided', () => {
    const header = buildCspHeader('n', 'https://api.example.com')
    expect(header).toContain('https://api.example.com')
  })

  it('omits empty API URL from connect-src', () => {
    const header = buildCspHeader('n', '')
    const connectLine = header.split('; ').find(s => s.startsWith('connect-src'))!
    const parts = connectLine.replace('connect-src ', '').split(' ')
    expect(parts).not.toContain('')
  })

  it('enforces strict directives', () => {
    const header = buildCspHeader('n')
    expect(header).toContain("frame-ancestors 'none'")
    expect(header).toContain("object-src 'none'")
    expect(header).toContain("base-uri 'self'")
  })
})

describe('injectNonce', () => {
  it('injects nonce into bare <script> tag', () => {
    const result = injectNonce(['<script>alert(1)</script>'], 'n1')
    expect(result[0]).toBe('<script nonce="n1">alert(1)</script>')
  })

  it('injects nonce into <script type="module"> tag', () => {
    const result = injectNonce(['<script type="module" src="/a.js"></script>'], 'n2')
    expect(result[0]).toBe('<script nonce="n2" type="module" src="/a.js"></script>')
  })

  it('does not inject nonce if already present', () => {
    const result = injectNonce(['<script nonce="existing">x</script>'], 'new')
    expect(result[0]).toBe('<script nonce="existing">x</script>')
  })

  it('does not match <script-tag> custom elements', () => {
    const result = injectNonce(['<script-tag>x</script-tag>'], 'n')
    expect(result[0]).toBe('<script-tag>x</script-tag>')
  })

  it('handles multiple script tags in one chunk', () => {
    const result = injectNonce(['<script>a</script><script>b</script>'], 'n3')
    expect(result[0]).toBe('<script nonce="n3">a</script><script nonce="n3">b</script>')
  })
})
