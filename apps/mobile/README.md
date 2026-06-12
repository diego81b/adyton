# @adyton/mobile — Capacitor shell

Thin native wrapper around the `apps/web` static build (Phase 8). All vault logic, UI,
crypto, and stores live in `apps/web`; this package holds only the Capacitor config and
the generated native projects (`android/`, `ios/`).

## How it fits the security model

- The WebView origin is pinned to `https://adyton.diegobaldeschi.dev` via
  `server.hostname` in `capacitor.config.ts`. Assets are served locally from the bundle;
  the pinned origin makes the app same-site with `api.adyton.diegobaldeschi.dev`, so the
  `SameSite=Lax` refresh cookie works and the existing API CORS allowlist
  (`ALLOWED_ORIGINS`) matches without any backend change.
- Biometric unlock stores the **raw derived vault key bytes** (never the master
  password) in the platform secure storage (iOS Keychain / Android Keystore via
  `@aparajita/capacitor-secure-storage`), released only after a successful biometric
  prompt (`@aparajita/capacitor-biometric-auth`). This is the sanctioned Phase 8
  exception to the "key never at rest" posture: the bytes live in hardware-backed,
  OS-encrypted storage, on the user's own device, opt-in from Settings.
- The app locks the vault whenever it goes to background
  (`App.addListener('appStateChange')` in `apps/web/app/plugins/native-lock.client.ts`).

## Build

Prerequisites: Android Studio (Android SDK 35+, JDK 21) for Android; Xcode 16+ on
macOS for iOS. Neither is required for web development — this package is inert unless
you build it.

```bash
# 1. Build the web assets (API URL is baked in at build time — SPA static build)
NUXT_PUBLIC_API_BASE_URL=https://api.adyton.diegobaldeschi.dev pnpm --filter @adyton/web generate

# 2. Sync assets + plugins into the native projects
pnpm --filter @adyton/mobile sync

# 3. Open / run
pnpm --filter @adyton/mobile open:android   # Android Studio → build signed APK/AAB
pnpm --filter @adyton/mobile open:ios       # Xcode (macOS only) → archive/sideload
```

## Live reload (development)

Point the WebView at the Nuxt dev server (use the LAN IP of your dev machine — on a
physical device `localhost` is the device itself):

```bash
CAP_SERVER_URL=http://192.168.1.10:30000 pnpm --filter @adyton/mobile sync
pnpm --filter @adyton/mobile run:android
```

Re-run `sync` **without** `CAP_SERVER_URL` before any release build — a leftover dev
server URL in `capacitor.config.json` would ship a remote-loading app.

## Gotchas

- `NUXT_PUBLIC_API_BASE_URL` **must be absolute** in mobile builds. A relative `/api`
  would resolve against the local bundle server and never reach the real API.
- The Nitro CSP middleware (`server/middleware/csp.ts`) does not run in the static
  bundle — there is no server. The native WebView shell is the trust boundary instead.
- After adding/removing a Capacitor plugin, run `sync` again so the native projects
  pick it up.
