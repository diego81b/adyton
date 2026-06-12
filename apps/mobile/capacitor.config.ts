import type { CapacitorConfig } from '@capacitor/cli';

// Live reload for development: point the WebView at the Nuxt dev server instead
// of the bundled build. Usage:
//   CAP_SERVER_URL=http://192.168.x.x:30000 pnpm --filter @adyton/mobile sync
// (use the LAN IP of the machine running `nuxt dev`; localhost on a device is the
// device itself). Never set in a production build.
const liveReloadUrl = process.env.CAP_SERVER_URL;
if (liveReloadUrl && process.env.NODE_ENV === 'production') {
  // `cleartext: true` below would otherwise survive into a release build and
  // allow plain-HTTP traffic from the WebView.
  throw new Error('CAP_SERVER_URL must not be set in production builds');
}

const config: CapacitorConfig = {
  appId: 'dev.diegobaldeschi.adyton',
  appName: 'Adyton',
  // Nuxt static output (`nuxt generate` in apps/web). Run `pnpm build:web` first.
  webDir: '../web/.output/public',
  plugins: {
    // Insets are owned by @capacitor-community/safe-area (it polyfills broken
    // Chromium < 140 webviews via webview padding; on newer webviews the real
    // env(safe-area-inset-*) values flow through). Capacitor's own handling
    // must be off or the two fight (plugin README, "Setup").
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
  server: {
    // The WebView origin becomes https://adyton.diegobaldeschi.dev (assets are still
    // served locally from the bundle — no network round-trip). This makes the app
    // same-site with api-adyton.diegobaldeschi.dev, so the SameSite=Lax refresh
    // cookie is sent on fetch and the existing CORS allowlist matches unchanged.
    // Without this the origin would be capacitor://localhost → cross-site → the
    // refresh cookie is silently dropped and sessions cannot be restored.
    hostname: 'adyton.diegobaldeschi.dev',
    androidScheme: 'https',
    iosScheme: 'https',
    ...(liveReloadUrl ? { url: liveReloadUrl, cleartext: true } : {}),
  },
};

export default config;
