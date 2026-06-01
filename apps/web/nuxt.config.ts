// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },

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
          // CSP applied in production only — dev mode requires unsafe-inline for HMR + __NUXT__ injection
          ...(process.env.NODE_ENV === 'production' ? {
            'Content-Security-Policy': [
              "default-src 'self'",
              "script-src 'self' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "connect-src 'self' https://api.pwnedpasswords.com",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join('; '),
          } : {}),
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        },
      },
    },
  },

  ssr: false,

  typescript: {
    strict: true,
    typeCheck: false,
  },

  vite: {
    optimizeDeps: {
      include: [
        '@nuxt/ui',
        'reka-ui',
        '@vueuse/core',
        'pinia',
      ],
    },
    // Docker on Windows/WSL2 bind mounts don't propagate inotify events reliably
    server: {
      watch: process.env.CHOKIDAR_USEPOLLING === 'true'
        ? { usePolling: true, interval: 500 }
        : {},
    },
  },
});
