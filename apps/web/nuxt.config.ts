// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },

  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxt/fonts'],

  css: ['~/assets/css/main.css'],

  // Mockup is dark-first; honor the user's system preference but default to dark.
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

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
      // Pre-bundle up-front so navigating to a new page doesn't trigger
      // on-demand dep discovery -> re-optimize -> full page reload.
      // reka-ui + @floating-ui/dom are NuxtUI's lazy-imported transitive deps;
      // without them here each new route that mounts a new component re-bundles.
      include: [
        '@vueuse/core',
        'defu',
        'klona',
        'reka-ui',
        'reka-ui > @floating-ui/dom',
      ],
    },
    // Docker on Windows/WSL2 bind mounts don't propagate inotify events reliably
    server: {
      watch: process.env.CHOKIDAR_USEPOLLING === 'true'
        ? { usePolling: true, interval: 500 }
        : {},
      // Eagerly transform pages/components on boot so first navigation isn't cold.
      warmup: {
        clientFiles: ['./app/pages/**/*.vue', './app/components/**/*.vue'],
      },
    },
  },
});
