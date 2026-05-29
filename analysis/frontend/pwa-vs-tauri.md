## 15. PWA vs Desktop App (Tauri) — Trade-off Analysis

### 15.1 The Core Trade-off

A PWA running in a browser sandbox has fundamental capabilities restrictions that a native desktop app does not. For a password manager, several of these restrictions are directly relevant to security and UX quality:

| Capability | PWA (browser) | Desktop app (Tauri) |
|-----------|---------------|---------------------|
| System keychain integration | ❌ No (Web Crypto keys stay in browser memory) | ✅ Yes (macOS Keychain, Windows Credential Manager, Linux Secret Service) |
| Auto-lock on screen lock | ❌ No (browser has no screen lock event) | ✅ Yes (OS-level hook) |
| Clipboard monitoring and forced clear | ⚠️ Partial (can clear on timer; cannot detect external clipboard read) | ✅ Yes (OS clipboard API) |
| Global keyboard shortcuts | ❌ No | ✅ Yes (system-wide hotkey to open vault) |
| System tray / menubar | ❌ No | ✅ Yes (vault accessible from tray without opening full window) |
| Browser extension integration | Separate extension required | ✅ Native autofill via accessibility API |
| Offline vault access | ⚠️ Limited (service worker cache; iOS clears after 7 days) | ✅ Yes (SQLite local encrypted store) |
| Auto-update | ✅ Yes (service worker) | ✅ Yes (Tauri updater) |
| Install friction | ✅ Zero (URL-based, "Add to Home Screen") | ⚠️ Requires download + install |
| Mobile support | ✅ Yes (PWA on iOS/Android) | ❌ Tauri mobile is experimental (as of 2025) |
| Single codebase | ✅ Yes | ✅ Yes (Tauri wraps the same Nuxt frontend) |
| Binary size | N/A (no download) | ~8MB (Tauri uses OS WebView; not bundled like Electron) |
| Memory footprint | Browser tab (~150-300MB) | ~50-80MB (no Chromium bundled) |

### 15.2 Why Tauri Over Electron

If a desktop app is built, **Tauri** is unambiguously the correct choice over Electron for this project:

- **Security model:** Tauri's backend is Rust (memory-safe, no Node.js process with file system access). The frontend runs in the OS WebView (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) in an isolated sandbox. Electron runs a full Chromium browser with Node.js access — a malicious script in an Electron app has significantly larger attack surface.
- **Size:** Tauri installer ~5-8MB vs Electron ~120MB. For a security-focused self-hosted app distributed over a personal VPS, Tauri is far more appropriate.
- **Same frontend code:** The Nuxt 4 app runs inside Tauri's WebView without modification. `packages/shared` crypto works identically (WebView supports Web Crypto API). Zero frontend duplication.
- **Tauri plugins:** `tauri-plugin-stronghold` provides hardware-backed key storage using the IOTA Stronghold security protocol. Keys stored in Stronghold survive app restart but cannot be extracted from the binary or memory without the vault password. This is a significant upgrade over in-memory Pinia store.

### 15.3 Key Advantages of the Tauri Desktop App

**System Keychain Integration (most important security improvement):**

```rust
// Tauri backend (Rust): store derived key in macOS Keychain / Windows Credential Manager
use keyring::Entry;

fn store_adyton_key(key_bytes: &[u8]) -> Result<(), keyring::Error> {
    let entry = Entry::new("adyton", "vault-encryption-key")?;
    entry.set_password(&hex::encode(key_bytes))?;
    Ok(())
}

fn load_adyton_key() -> Result<Vec<u8>, keyring::Error> {
    let entry = Entry::new("adyton", "vault-encryption-key")?;
    let hex = entry.get_password()?;
    Ok(hex::decode(hex).unwrap())
}
```

On macOS, this stores the key in Keychain Access, protected by the user's login password and optionally by Touch ID. The key persists across app restarts — the user unlocks once per login session, not once per app launch. Auto-lock still applies (Tauri can hook the OS screen lock event via `tauri-plugin-screen-lock`).

**Screen Lock Auto-Lock:**

```rust
// React to screen lock event — clears the in-memory key reference
tauri::Builder::default()
    .plugin(tauri_plugin_screen_lock::init())
    .on_screen_lock(|_app| {
        // Emit event to frontend to clear Pinia store
        app.emit_all("vault:lock", ()).unwrap();
    })
```

When the OS screen locks, the frontend receives the `vault:lock` event and calls `useCryptoStore().lock()`. This is not possible in a browser PWA — the browser has no screen lock event.

**Global Keyboard Shortcut:**

```rust
app.global_shortcut_manager()
    .register("CmdOrCtrl+Shift+V", || {
        // Show vault window and focus search
        app.get_window("main").unwrap().show().unwrap();
        app.emit_all("vault:focus-search", ()).unwrap();
    })
```

`Cmd+Shift+V` opens the vault from anywhere on the OS — no need to switch to the browser, open a tab, wait for the PWA to load. For a password manager, this is a significant daily-use UX improvement.

**Clipboard Monitoring:**

```rust
// Clear clipboard after 30 seconds AND if another app reads it
use clipboard_master::{ClipboardHandler, Master};

struct VaultClipboardMonitor;
impl ClipboardHandler for VaultClipboardMonitor {
    fn on_clipboard_change(&mut self) {
        // Another app read the clipboard — if our data was there, clear immediately
        app.emit_all("vault:clipboard-read", ()).unwrap();
    }
}
```

In a browser PWA, clipboard clearing is timer-based only. A malicious app that reads the clipboard within the 30-second window gets the password. Tauri can monitor clipboard access and clear proactively when another process reads it.

### 15.4 Recommended Architecture: Layered Client Strategy

No single client type covers all use cases optimally. The recommended approach uses three client targets, all sharing the same backend API and `packages/shared` crypto:

```
                    packages/shared (crypto, types, validation)
                           │
          ┌────────────────┼───────────────────┐
          │                │                   │
    apps/web           apps/api          apps/extension
   (Nuxt 4 PWA)    (NestJS/Fastify)     (MV3 Chrome/FF)
       │   │
       │   └─ apps/mobile (Capacitor)
       │       ├── ios/   (Xcode, WKWebView + Keychain plugins)
       │       └── android/ (Kotlin, WebView — optional if PWA sufficient)
       │
       └─ apps/desktop (Tauri)
           src-tauri/  (Rust: keychain, screen lock, global shortcut)
           (frontend = same Nuxt 4 build, no duplication)
```

**Client selection by use case:**

| Use case | Recommended client | Why |
|----------|-------------------|-----|
| Daily use on iPhone | **Capacitor iOS app** | Keychain (no ITP), native Face ID, proper install |
| Daily use on Android | **PWA** (Chrome) | Chrome PWA on Android is excellent, zero install friction |
| Desktop macOS/Windows/Linux | **Tauri** | System keychain, screen-lock auto-lock, global shortcut |
| Browser autofill | **MV3 Extension** | Only client that can inject into forms |
| Occasional access any browser | **PWA** | Zero install, works everywhere |

**Deployment summary:**
- PWA + API: served by nginx on VPS
- Desktop: `.dmg` / `.msi` / `.AppImage` built via CI, hosted as GitHub release or VPS download
- iOS: Capacitor `.ipa` — sideloaded (AltStore / direct) or App Store (requires €99/year Apple Developer account)
- Android: Capacitor `.apk` — sideloaded, or Google Play (requires €25 one-time)
- Extension: `.crx` / `.xpi`

**Capacitor is a first-class deliverable, not an iOS fallback.** The decision to build `apps/mobile` with Capacitor is made from Phase 1 — it is in the monorepo from the start. The mobile app wraps the same Nuxt 4 build (zero code duplication) and adds only a thin native layer (Keychain plugin, biometric plugin, screen-lock plugin). Android can use PWA or Capacitor depending on preference; iOS requires Capacitor due to ITP.

For a strictly personal self-hosted tool: Capacitor covers iOS (and Android optionally); PWA covers Android + all desktop browsers; Tauri covers desktop with advanced OS integration; extension covers browser autofill. All clients share zero duplicated security-critical code.

### 15.5 Feature Matrix by Client Type

| Feature | Android PWA | iOS PWA (Safari) | Capacitor iOS | Tauri Desktop | MV3 Extension |
|---------|------------|------------------|---------------|---------------|---------------|
| Core vault CRUD | ✅ | ✅ | ✅ | ✅ | ✅ (read+copy) |
| AES-256-GCM encrypt/decrypt | ✅ | ✅ | ✅ | ✅ | ✅ |
| Biometric unlock | ✅ (WebAuthn) | ✅ (Face ID, iOS 16+) | ✅ (native Face ID) | ✅ (Touch ID / Windows Hello) | ❌ |
| Biometric key storage (no ITP) | ✅ IndexedDB | ⚠️ deleted after 7d | ✅ iOS Keychain | ✅ OS Keychain | ❌ |
| Auto-lock on screen lock | ❌ | ❌ | ✅ (Capacitor plugin) | ✅ (OS event hook) | ❌ |
| Global keyboard shortcut | ❌ | ❌ | ❌ | ✅ | ✅ (extension shortcut) |
| Browser autofill | ❌ | ❌ | ❌ | ❌ | ✅ |
| ENV file upload | ✅ | ⚠️ `<input>` only | ✅ native picker | ✅ native picker | ❌ |
| ENV file download (.env) | ✅ | ✅ | ✅ save to Files | ✅ native save | ❌ |
| Offline app shell | ✅ SW cache | ✅ SW cache | ✅ bundled | ✅ bundled | N/A |
| Push notifications | ✅ | ⚠️ only if installed HS | ✅ APNs | ✅ | ❌ |
| Web Bluetooth (cross-device WebAuthn) | ✅ | ❌ | ❌ Safari engine | ⚠️ Chrome only | ❌ |
| Install required | No (Add HS) | No (Add HS) | Yes (.ipa) | Yes (.dmg etc) | Yes |
| App Store required | No / Play Store | No / App Store | Optional | No | No |
| Zero frontend code duplication | ✅ | ✅ | ✅ same Nuxt | ✅ same Nuxt | ✅ shared package |

---

