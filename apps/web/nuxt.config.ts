// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },

  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxt/fonts'],

  css: ['~/assets/css/main.css'],

  // ssr:false means icons render client-side. The default server bundle is useless here,
  // so bundle icons into the CLIENT and never fall back to the Iconify CDN — a remote
  // fetch would violate both our CSP (connect-src) and the no-CDN/zero-knowledge posture.
  // `scan` collects icon names from our source; collections (lucide, simple-icons) are
  // installed locally. NuxtUI's internal icon names are registered via its app config.
  icon: {
    provider: 'iconify',
    fallbackToApi: false,
    // With fallbackToApi:false, @nuxt/icon resolves the local /api/_nuxt_icon/ endpoint
    // only for collections listed here. Without this, the endpoint returns nothing and
    // icons that miss the clientBundle disappear (no CDN, no local API = blank).
    serverBundle: {
      collections: ['lucide', 'simple-icons'],
    },
    clientBundle: {
      // @nuxt/icon's default scan glob is **/*.{vue,jsx,tsx,md,...} — it does NOT
      // include `.ts`. Our icon names live as literals in `.ts` utilities too
      // (nav.ts, card-brand detection, entry-display), so the default scan misses
      // them and they'd fall back to the Iconify CDN (CSP + zero-knowledge breach).
      // Add `ts` so every `i-lucide-*` / `i-simple-icons-*` literal gets bundled.
      scan: {
        globInclude: ['**/*.{vue,jsx,tsx,ts,md,mdc,mdx,yml,yaml}'],
      },
      includeCustomCollections: true,
      // `scan` only sees icon names that appear as literals in our own source. NuxtUI
      // renders its own chrome (select chevrons, alert/close icons, etc.) from names that
      // live in NuxtUI's source, not ours, so scan can miss them and they'd hit the CDN.
      // Pin NuxtUI's full default lucide set explicitly. Source: @nuxt/ui theme defaults
      // (ui.icons). Update if a NuxtUI upgrade adds new default icons.
      icons: [
        'lucide:arrow-down', 'lucide:arrow-left', 'lucide:arrow-right', 'lucide:arrow-up',
        'lucide:arrow-up-right', 'lucide:check', 'lucide:chevron-down', 'lucide:chevron-left',
        'lucide:chevron-right', 'lucide:chevron-up', 'lucide:chevrons-left', 'lucide:chevrons-right',
        'lucide:circle-alert', 'lucide:circle-check', 'lucide:circle-x', 'lucide:copy',
        'lucide:copy-check', 'lucide:ellipsis', 'lucide:eye', 'lucide:eye-off', 'lucide:file',
        'lucide:folder', 'lucide:folder-open', 'lucide:grip-vertical', 'lucide:hash', 'lucide:info',
        'lucide:lightbulb', 'lucide:loader-circle', 'lucide:menu', 'lucide:minus', 'lucide:monitor',
        'lucide:moon', 'lucide:panel-left-close', 'lucide:panel-left-open', 'lucide:plus',
        'lucide:rotate-ccw', 'lucide:search', 'lucide:square', 'lucide:sun', 'lucide:terminal',
        'lucide:triangle-alert', 'lucide:upload', 'lucide:x',
      ],
    },
  },

  // Mockup is dark-first; honor the user's system preference but default to dark.
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? '',
    },
  },

  app: {
    head: {
      title: 'Adyton',
      meta: [
        { charset: 'utf-8' },
        // viewport-fit=cover so env(safe-area-inset-*) works in PWA standalone mode.
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Adyton — zero-knowledge password manager' },
        { name: 'theme-color', content: '#011a1f' },
        // Installed/standalone display → no browser chrome, no pull-to-refresh on mobile.
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Adyton' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.json' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },

  nitro: {
    routeRules: {
      '/**': {
        headers: {
          // CSP is applied per-request via server/middleware/csp.ts (nonce-based).
          // Static CSP here would break inline scripts injected by Nuxt (color-mode,
          // __NUXT__ config) because their hashes change every build.
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
