// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@pinia/nuxt'],

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? '/api',
    },
  },

  app: {
    head: {
      title: 'Adyton',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Adyton — zero-knowledge password manager' },
      ],
    },
  },

  nitro: {
    routeRules: {
      '/**': {
        headers: {
          'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'wasm-unsafe-eval'",  // wasm-unsafe-eval required for hash-wasm Argon2id
            "style-src 'self' 'unsafe-inline'",       // Tailwind runtime class injection
            "img-src 'self' data:",
            "connect-src 'self' https://api.pwnedpasswords.com",  // HIBP k-anonymity check
            "frame-ancestors 'none'",
            "form-action 'self'",
            "base-uri 'self'",
            "object-src 'none'",
          ].join('; '),
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        },
      },
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },
});
