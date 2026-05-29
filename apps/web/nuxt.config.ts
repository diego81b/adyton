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
      // Phase 1 scaffold only — full CSP arrives in Phase 4 alongside Argon2id WASM.
      // 'wasm-unsafe-eval' is required for the Argon2id Web Worker.
      '/**': {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
        },
      },
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },
});
