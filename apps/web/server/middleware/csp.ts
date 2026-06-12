import { defineEventHandler, setResponseHeader } from 'h3'
import { generateNonce, buildCspHeader } from '../utils/csp'

export default defineEventHandler((event) => {
  const url = event.path ?? ''
  if (url.startsWith('/_nuxt/') || url.startsWith('/favicon') || url.startsWith('/manifest')) return

  const nonce = generateNonce()
  event.context.cspNonce = nonce

  setResponseHeader(
    event,
    'Content-Security-Policy',
    buildCspHeader(nonce, process.env.NUXT_PUBLIC_API_BASE_URL),
  )
})
