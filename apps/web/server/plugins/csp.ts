import { injectNonce } from '../utils/csp'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = (event.context as { cspNonce?: string }).cspNonce
    if (!nonce) return

    html.head = injectNonce(html.head, nonce)
    html.body = injectNonce(html.body, nonce)
    html.bodyAppend = injectNonce(html.bodyAppend, nonce)
    html.bodyPrepend = injectNonce(html.bodyPrepend, nonce)
  })
})
