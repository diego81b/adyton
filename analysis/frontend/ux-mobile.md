## 14. UX Design — Mobile First

### 14.1 Decryption Always Happens Client-Side — UX Implications

**This is the most important UX constraint in the system.** Every operation that reveals vault content requires the `CryptoKey` to be present in memory on the device currently being used. There is no server-side decryption, no "view in browser via a link," no server-side PDF export of vault contents. This is a security property, not a limitation — but it shapes every UX decision.

Consequences for UX:
- Switching devices (e.g. from phone to laptop) requires a new vault unlock on the new device. The key is not synchronized.
- Vault entries cannot be shared via a server-rendered URL (there is no server-rendered content to share).
- Offline access requires the vault to have been fetched and decrypted during a previous online session. Cached in-memory entries are available until the browser tab closes.
- The loading experience includes an unavoidable ~1-2 second Argon2id derivation spinner. This must be designed as a positive "security ritual" rather than a perceived performance problem.

### 14.2 Mobile-First Layout System

The application uses Tailwind CSS's mobile-first breakpoint system (`sm:`, `md:`, `lg:`) starting from a 375px baseline. All components are designed for thumb reachability on a 6-inch phone screen before being adapted for tablet and desktop.

**Primary navigation — bottom bar on mobile, sidebar on desktop:**

```
Mobile (≤ 768px)                    Desktop (≥ 1024px)
┌────────────────────┐              ┌────────┬──────────────────────┐
│  🔒 Adyton       │              │ 🔒     │                      │
│                    │              │ Vault  │   Vault Entry List   │
│  [Entry list]      │              │ ─────  │   + Detail Panel     │
│                    │              │ Secrets│                      │
│                    │              │ ─────  │                      │
│                    │              │ Gen    │                      │
│                    │              │ ─────  │                      │
│                    │              │Settings│                      │
├────┬────┬────┬─────┤              └────────┴──────────────────────┘
│Vault│Env│Gen│Settings│
└────┴────┴────┴─────┘
```

Bottom navigation tabs on mobile: Vault · Env Secrets · Generator · Settings. Each tab is 25% width, 56px tall (exceeds Apple's 44px minimum tap target). Active tab uses violet accent. On desktop the same tabs become a left sidebar with icons + labels.

**Vault entry list — mobile optimized:**

```
┌────────────────────────────────┐
│ 🔍 Search...           [+] Add │
│ All · Login · Env · Secret     │  ← filter chips, horizontally scrollable
├────────────────────────────────┤
│ 🔵 GitHub                      │
│    alice@example.com    [copy] │
├────────────────────────────────┤
│ 🟣 PROD .env — api-service     │
│    Production · v3    [export] │
├────────────────────────────────┤
│ 🔑 STRIPE_SECRET_KEY           │
│    Production · sk_live_...    │
└────────────────────────────────┘
```

Swipe left on an entry reveals "Copy Password" and "Delete" actions (similar to iOS Mail). Swipe right reveals "Edit." This avoids requiring long-press menus, which have poor discoverability on mobile.

### 14.3 Vault Unlock — Mobile Biometric (No Third Parties)

The vault unlock step (Phase 2, entering the master password) can be enhanced on mobile with biometric authentication — without any third-party service, without push notifications, without Apple or Google involvement in the authentication flow.

**Mechanism: WebAuthn Platform Authenticator + Secure Enclave Key Wrapping**

The mobile device's Secure Enclave (Apple) or StrongBox (Android) can protect the derived `CryptoKey` across sessions. The flow:

```
First unlock on this device:
  1. User enters master password (full Argon2id derivation, ~1-2 sec)
  2. CryptoKey derived
  3. App generates a device-local WebAuthn credential (platform authenticator)
     Credential private key is stored in Secure Enclave / StrongBox
     Credential public key stored in the app's IndexedDB
  4. Raw AES-256-GCM key bytes are encrypted by the WebAuthn credential
     (via subtle.wrapKey using the authenticator's public key — only the Secure Enclave can unwrap)
  5. Wrapped key stored in IndexedDB alongside the WebAuthn credential ID
  6. User is prompted: "Enable Face ID / Touch ID / Fingerprint for future unlocks?" → Yes/No

Subsequent unlocks (biometric):
  1. "Unlock Vault" screen shows biometric prompt instead of password field
  2. User touches finger / looks at phone
  3. Device authenticates via platform authenticator (Face ID / Touch ID / Fingerprint)
     → WebAuthn assertion proves biometric passed and device holds the credential
  4. Secure Enclave unwraps the stored key bytes
  5. importKey() creates CryptoKey in memory
  6. Vault unlocked — no master password typed, no network request
```

**Third-party dependencies: zero.** The Secure Enclave / StrongBox is on-device hardware. The WebAuthn platform authenticator API is a W3C standard implemented in the OS browser engine. No push notification service is involved. No Apple ID or Google Account is required (non-synced, device-bound credentials).

**What happens if the device is stolen:**
- The wrapped key in IndexedDB is useless without the Secure Enclave to unwrap it
- The Secure Enclave requires biometric or device PIN to unlock
- After N failed biometric attempts, the device locks and the credential is invalidated
- The master password path always remains available as fallback (user can always re-derive from scratch)

**What "certified mobile device" means in this model:** A device is "certified" when the user has completed the first full master-password unlock on that device and opted into biometric protection. The device then holds a Secure Enclave credential + wrapped key. Revoking a device means deleting the WebAuthn credential from the registered credentials list (via `/auth/webauthn/credentials/:id DELETE`) — the wrapped key in IndexedDB on that device becomes permanently undecryptable.

**Implementation:** Uses the standard `@simplewebauthn/browser` + `SubtleCrypto.wrapKey` / `unwrapKey` API. No native mobile app required — works in Safari on iOS 16+ and Chrome on Android. The `authenticatorAttachment: 'platform'` flag in WebAuthn registration options ensures only the device's built-in authenticator (not a hardware key) is used for this flow.

**Cross-device unlock (desktop unlocked by phone approval):**
CTAP2 hybrid transport (QR code on desktop → phone scans → biometric on phone → desktop unlocks) is supported natively in Chrome/Safari/Edge without any third-party service. However, this uses Bluetooth for the secure channel — Apple Passkeys and Google Passkeys use their respective cloud services for passkey sync. For a fully third-party-free cross-device flow, the alternative is: enroll a **FIDO2 NFC hardware key** (YubiKey 5 NFC, ~€50) as a device-independent credential. Tap the key to the phone → NFC → WebAuthn assertion → vault unlock on any device. No cloud, no Bluetooth, no third party.

### 14.4 Argon2id Derivation — Mobile UX

The 1-2 second Argon2id derivation (m=65536, 64MB RAM, Web Worker) needs deliberate UX treatment on mobile. It must not feel like a loading failure.

```vue
<!-- VaultUnlockScreen.vue -->
<template>
  <div class="vault-unlock-screen">
    <div v-if="!isUnlocking">
      <!-- Biometric available -->
      <UButton v-if="hasBiometric" @click="unlockWithBiometric" size="xl" block>
        <UIcon name="i-heroicons-finger-print" class="mr-2" />
        Unlock with Face ID / Fingerprint
      </UButton>

      <!-- Password fallback -->
      <PasswordInput
        v-model="masterPassword"
        label="Or enter master password"
        :disabled="isUnlocking"
        @keydown.enter="unlockWithPassword"
      />
      <UButton @click="unlockWithPassword" :disabled="!masterPassword" block>
        Unlock Vault
      </UButton>
    </div>

    <!-- Derivation in progress -->
    <div v-else class="flex flex-col items-center gap-4">
      <div class="w-16 h-16 rounded-full border-4 border-violet-500 border-t-transparent animate-spin" />
      <p class="text-sm text-gray-400">Deriving encryption key…</p>
      <p class="text-xs text-gray-600">This takes ~1-2 seconds for your security</p>
    </div>
  </div>
</template>
```

The spinner copy "This takes ~1-2 seconds for your security" converts a perceived loading delay into a security signal. Users who understand crypto will appreciate it; users who don't will at minimum understand the delay is intentional.

### 14.5 PWA Device API Access — What Works and What Does Not

PWAs running in a browser sandbox have restricted access to device APIs. The table below maps every API relevant to this application across the main platforms:

| API | Chrome Android | Safari iOS | Chrome/Firefox Desktop | Notes |
|-----|---------------|------------|------------------------|-------|
| **Web Crypto API** (AES-GCM, ECDH) | ✅ | ✅ | ✅ | Core requirement — universally supported |
| **WebAuthn platform authenticator** (Face ID, fingerprint) | ✅ | ✅ iOS 16+ | ✅ | Biometric unlock works on all platforms |
| **Service Worker + Cache** | ✅ | ✅ (50MB quota) | ✅ | Offline app shell caching |
| **IndexedDB** (wrapped key storage) | ✅ | ⚠️ cleared after 7 days (ITP) | ✅ | iOS ITP is a real problem — see below |
| **Push notifications** | ✅ | ⚠️ iOS 16.4+ only if installed to Home Screen | ✅ | |
| **File System Access API** (file upload/download) | ✅ | ❌ Not supported | ✅ | iOS: must use `<input type="file">` workaround |
| **Clipboard read/write** | ✅ | ✅ (requires user gesture) | ✅ | |
| **Web Bluetooth** (CTAP2 hybrid cross-device) | ✅ | ❌ Not supported | ⚠️ Chrome only | Cross-device WebAuthn via phone doesn't work in Safari |
| **Web NFC** (YubiKey tap) | ✅ Android only | ❌ | ❌ | NFC in web: Android Chrome only |
| **System Keychain** | ❌ | ❌ | ❌ | Browser sandbox — requires native app (Tauri/Capacitor) |
| **Screen lock event** | ❌ | ❌ | ❌ | Requires native app |
| **Global keyboard shortcuts** | ❌ | ❌ | ❌ | Requires native app (Tauri) or extension |
| **`beforeinstallprompt`** (native install banner) | ✅ | ❌ | ✅ Chrome | iOS: user must manually use "Add to Home Screen" from Safari share menu |
| **Background sync** | ✅ | ❌ | ✅ | |

### 14.6 The iOS Reality — Why "PWA on Apple" Is Limited

The user's concern is well-founded. The iOS PWA situation has historically been poor and remains significantly inferior to Android Chrome or desktop. The specific problems for this application:

**Problem 1 — ITP storage clearing (most impactful):**
Safari's Intelligent Tracking Prevention deletes IndexedDB, service worker caches, and other storage for origins that have not been visited in 7 days. This means:
- The wrapped `CryptoKey` stored for biometric unlock → deleted after 7-day inactivity
- WebAuthn credential IDs in IndexedDB → deleted
- User must re-enter master password and re-enroll biometric
- For a password manager used infrequently (e.g. only when setting up a new server), this happens constantly

When installed as a PWA (added to Home Screen), Apple applies somewhat more lenient ITP rules — the installed app has its own storage partition. But the 7-day baseline can still apply. This is not a solvable problem within the PWA sandbox.

**Problem 2 — No `beforeinstallprompt`:**
Android Chrome shows a native "Install" banner automatically. On iOS, the user must know to tap the share icon → "Add to Home Screen." Most users never discover this. For a personal tool used by one person, this is acceptable friction.

**Problem 3 — No Web Bluetooth, No Web NFC:**
Cross-device WebAuthn (phone approves desktop login via Bluetooth QR code) does not work in Safari. YubiKey NFC tap does not work in Safari. The only WebAuthn option on iOS is the platform authenticator (Face ID/Touch ID) — which does work well.

**Problem 4 — No File System Access API:**
The ENV file import/export uses `<input type="file">` as a workaround (file picker, no drag-and-drop to arbitrary paths). This is less convenient but functional. Download of `.env` files works via `URL.createObjectURL` — Safari supports this.

**Conclusion for iOS:** The core vault operations (read, write, encrypt, decrypt, biometric unlock via Face ID) work on iOS Safari PWA. The limitations are around peripheral features and storage durability. For a single technical user, the iOS PWA is functional but not polished.

### 14.7 Capacitor — The iOS-Native Alternative

**Capacitor** (by Ionic) wraps the existing Nuxt 4 web app in a native iOS/Android shell. It is not a rewrite — the same Vue components, Pinia stores, and `packages/shared` crypto run inside a WKWebView (iOS) or Android WebView. Capacitor adds a plugin bridge to native device APIs.

```
apps/web (Nuxt 4)
    │
    └─ apps/mobile (Capacitor wrapper)
        ├── ios/           # Xcode project (Swift shell, WKWebView)
        ├── android/       # Android Studio project (Kotlin shell, WebView)
        └── capacitor.config.ts
```

Capacitor plugins that solve the iOS limitations:

| Plugin | What it provides | iOS limitation it solves |
|--------|-----------------|--------------------------|
| `@capacitor/secure-storage` | Stores key in iOS Keychain (never cleared by ITP) | ITP 7-day deletion |
| `@capacitor/biometrics` | Native Face ID / Touch ID with Keychain integration | Better than WebAuthn platform auth in WKWebView |
| `@capacitor/filesystem` | Native file picker, save to Files app | No File System Access API in Safari |
| `@capacitor/clipboard` | Clipboard access, can detect reads on newer iOS | Partial clipboard monitoring |
| `@capacitor-community/bluetooth-le` | BLE access (for future cross-device features) | No Web Bluetooth in Safari |
| `@capacitor/push-notifications` | APNs push (no iOS 16.4 restriction) | Push only from Home Screen in PWA |

With Capacitor, the Keychain integration works identically to Tauri on desktop:

```typescript
// capacitor: store derived key in iOS Keychain (never cleared by ITP)
import { SecureStorage } from '@capacitor/secure-storage';

async function storeWrappedKey(wrappedKey: ArrayBuffer): Promise<void> {
  await SecureStorage.set({
    key: 'vault-encryption-key',
    value: arrayBufferToBase64(wrappedKey),
  });
}

async function loadWrappedKey(): Promise<ArrayBuffer | null> {
  try {
    const { value } = await SecureStorage.get({ key: 'vault-encryption-key' });
    return base64ToArrayBuffer(value);
  } catch {
    return null; // First launch or user deleted app
  }
}
```

The iOS Keychain storage is protected by the device passcode and optionally by Face ID/Touch ID — the same Secure Enclave protection as the WebAuthn approach, but without the ITP clearing problem.

**Capacitor vs pure PWA — when to choose:**

| Scenario | Recommendation |
|----------|---------------|
| Personal use, infrequent iOS access | PWA — acceptable despite ITP |
| Daily iOS use, biometric unlock every day | Capacitor iOS app — Keychain storage, no ITP |
| Android primary device | PWA (Chrome Android is excellent) |
| Desktop primary use | Tauri desktop app |

**App Store distribution:** A Capacitor iOS app requires an Apple Developer account (€99/year) and App Store review. For a self-hosted personal tool this adds operational burden. Alternative: **AltStore** or **Sideloadly** for sideloading without App Store, or EU alternative marketplaces (iOS 17.4+ in EU). For a truly self-contained personal deployment, sideloading the Capacitor app is a viable option.

### 14.8 PWA Configuration

For the web and Android use cases, the PWA is configured via `@vite-pwa/nuxt`:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@vite-pwa/nuxt'],
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Adyton',
      short_name: 'Adyton',
      description: 'Zero-knowledge personal password vault',
      theme_color: '#0f172a',
      background_color: '#0f172a',
      display: 'standalone',
      orientation: 'portrait',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,wasm}'],
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/.*\/api\//,
          handler: 'NetworkOnly', // NEVER cache API responses — vault ciphertext must not sit in SW cache
        },
      ],
    },
  },
});
```

`NetworkOnly` for all `/api/` responses is non-negotiable. The service worker must never cache vault API responses — not because the ciphertext is dangerous (it is opaque), but because cached auth tokens or response metadata could leak session information.

### 14.7 UX Flows — Key Screens

**Registration:**
```
Email → Password (strength meter + HIBP check in real time)
      → Confirm password → [Create Account]
      → (auto-login) → Vault Unlock screen → (derive key) → Empty vault
      → "Add your first entry" CTA
```

**Login (returning user, no 2FA):**
```
Email → Password → [Login]
      → (server validates) → Vault Unlock screen
      → Enter master password → [Unlock] → Argon2id spinner → Vault
```

**Login (returning user, WebAuthn 2FA):**
```
Email → Password → [Login]
      → (server: requires 2FA) → "Verify your identity" → [Use Passkey]
      → Platform authenticator prompt (Face ID / fingerprint / hardware key)
      → (server issues full JWT) → Vault Unlock screen
      → (if biometric enrolled) → [Unlock with Face ID] → vault ready in <500ms
      → (if not enrolled) → master password entry → Argon2id → vault ready
```

**ENV_FILE entry — mobile create:**
```
[+] Add → ENV File → 
  Name: [api-service PROD     ]
  Environment: [Production ▾  ]
  Paste or upload .env:
  [ DATABASE_URL=postgres://... ]
  [ REDIS_URL=redis://...       ]
  [ ... multiline textarea      ]
  [Save] → encrypts → stored
```

**ENV_FILE entry — mobile view:**
```
 api-service PROD  🟢 Production  v3
 ─────────────────────────────────
 DATABASE_URL      ●●●●●●●●  [copy] [reveal]
 REDIS_URL         ●●●●●●●●  [copy] [reveal]
 STRIPE_SECRET_KEY ●●●●●●●●  [copy] [reveal]
 ─────────────────────────────────
 [Download .env]  [Version history]  [Edit]
```

All value fields masked by default. Reveal toggle shows plaintext for 30 seconds then re-masks automatically. Copy clears clipboard after 30 seconds.

---

