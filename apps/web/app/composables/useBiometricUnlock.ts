import { useNativeRuntime } from './useNativeRuntime';

// PAK (Phone-as-Key) device ID lookup — written by /pak/enroll after SE sealing.
const PAK_DEVICE_KEY_PREFIX = 'adyton_pak_device_';

// Phase 8 biometric device ID — generated at enroll time, used as the wrap-key alias.
// Unlike PAK, Phase 8 does not have ECDH/SIGN keys — only the AES wrap key + sealed file.
const PHASE8_DEVICE_KEY_PREFIX = 'adyton.phase8_device_';

// ---------------------------------------------------------------------------
// Cancel / fallback error codes from BiometricPrompt (mapped in Kotlin plugin)
// and @aparajita/capacitor-biometric-auth. These represent intentional user
// dismissal or OS-level cancellation — not bugs or stale-key conditions.
// ---------------------------------------------------------------------------
const CANCEL_CODES = new Set([
  'userCancel',
  'systemCancel',
  'appCancel',
  'userFallback',
  'biometryLockout',
]);

/** Extracts the `.code` string from a plugin error object, or returns null. */
function errorCode(err: unknown): string | null {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    return (err as { code: string }).code;
  }
  return null;
}

/** Read the PAK device ID from localStorage, or null if not enrolled. */
function readPakDeviceId(userId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(PAK_DEVICE_KEY_PREFIX + userId);
}

/** Read the Phase 8 biometric device ID from localStorage, or null if not enrolled. */
function readPhase8DeviceId(userId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + userId);
}

// A native biometric call can hang indefinitely on Android after the app has spent
// long enough in the background — observed as the Capacitor bridge silently never
// dispatching the plugin call after certain resume transitions (no native log, no
// callback, nothing). Without a bound, this leaves the unlock button permanently
// disabled (`:disabled="biometricLoading"`) with no way to recover short of a
// force-close. This timeout is a client-side safety net, not a fix for the native
// root cause (still under investigation) — it guarantees the caller always gets a
// settled promise, so the existing failure-path UI (reveal password form, show
// error) always has a chance to run.
const NATIVE_CALL_TIMEOUT_MS = 15000;

class BiometricTimeoutError extends Error {
  constructor() {
    super('Biometric authentication timed out — the native prompt did not respond.');
    this.name = 'BiometricTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BiometricTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// useBiometricUnlock
// ---------------------------------------------------------------------------
export function useBiometricUnlock() {
  /**
   * Returns true if the device supports biometric authentication.
   * Always false on the web platform (plugins are native-only).
   */
  async function isSupported(): Promise<boolean> {
    const { isNative } = useNativeRuntime();
    if (!isNative) return false;

    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable;
  }

  /**
   * Returns true if the user has enrolled biometric unlock for the given userId.
   *
   * PAK path: checks localStorage for a PAK device ID, then verifies all SE keys
   * still exist in Android Keystore (handles app reinstall / key erasure).
   * Phase 8 path: checks localStorage for a Phase 8 device ID, then verifies the
   * AES wrap key + sealed file exist via AdytonKeystore.hasRawKey.
   */
  async function isEnrolled(userId: string): Promise<boolean> {
    // PAK path: device enrolled via /pak/enroll
    const pakDeviceId = readPakDeviceId(userId);
    if (pakDeviceId) {
      try {
        const { AdytonKeystore } = await import('@adyton/capacitor-keystore');
        const { exists } = await AdytonKeystore.hasKeys({ deviceId: pakDeviceId });
        if (exists) return true;
        // Keys gone (app reinstall, etc.) — clean up the stale localStorage entry
        localStorage.removeItem(PAK_DEVICE_KEY_PREFIX + userId);
      } catch {
        // Plugin not available (shouldn't happen on native, but guard defensively)
      }
    }

    // Phase 8 path: biometric enrollment backed by AES Keystore wrap key
    const phase8DeviceId = readPhase8DeviceId(userId);
    if (phase8DeviceId) {
      try {
        const { AdytonKeystore } = await import('@adyton/capacitor-keystore');
        const { exists } = await AdytonKeystore.hasRawKey({ deviceId: phase8DeviceId });
        if (exists) return true;
        // Wrap key gone — clean up
        localStorage.removeItem(PHASE8_DEVICE_KEY_PREFIX + userId);
      } catch {
        // Plugin not available
      }
    }

    return false;
  }

  /**
   * Enrolls biometric unlock for a user on the Phase 8 path.
   *
   * Generates a device ID (UUID), stores it in localStorage, then calls
   * AdytonKeystore.sealVaultKey which shows a BiometricPrompt and seals the vault
   * key under an OS-biometric-bound AES Keystore key.
   *
   * PAK enrollment goes through /pak/enroll + AdytonKeystore.generateKeys +
   * AdytonKeystore.sealVaultKey — this method is for non-PAK biometric only.
   *
   * Throws if called on the web platform.
   */
  async function enroll(userId: string, raw: ArrayBuffer): Promise<void> {
    const { isNative } = useNativeRuntime();
    if (!isNative) {
      throw new Error(
        'Biometric enrollment is not supported on the web platform. ' +
        'Key material must only be persisted in native secure storage.',
      );
    }

    // Generate a stable device ID for this enrollment; reuse if already enrolled.
    let phase8DeviceId = readPhase8DeviceId(userId);
    if (!phase8DeviceId) {
      phase8DeviceId = crypto.randomUUID();
      localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + userId, phase8DeviceId);
    }

    // Convert ArrayBuffer to base64 for the plugin (expects base64-encoded 32 bytes).
    const base64Raw = btoa(String.fromCharCode(...new Uint8Array(raw)));

    const { AdytonKeystore } = await import('@adyton/capacitor-keystore');
    // sealVaultKey shows BiometricPrompt and uses the authenticated CryptoObject cipher
    // to encrypt under the AES Keystore wrap key — OS enforces biometric at seal time.
    await AdytonKeystore.sealVaultKey({ deviceId: phase8DeviceId, vaultKeyRaw: base64Raw });
  }

  /**
   * Removes biometric enrollment for a user.
   *
   * Handles both storage backends:
   * - PAK: deletes Keystore keys + removes PAK localStorage entry.
   * - Phase 8: deletes Keystore wrap key + sealed file via AdytonKeystore.deleteKeys
   *   + removes Phase 8 localStorage entry.
   *
   * Silent no-op if the user is not enrolled.
   */
  async function unenroll(userId: string): Promise<void> {
    const { AdytonKeystore } = await import('@adyton/capacitor-keystore');

    // PAK path
    const pakDeviceId = readPakDeviceId(userId);
    if (pakDeviceId) {
      try {
        await AdytonKeystore.deleteKeys({ deviceId: pakDeviceId });
      } catch {
        // Ignore — keys may already be absent
      }
      localStorage.removeItem(PAK_DEVICE_KEY_PREFIX + userId);
    }

    // Phase 8 path
    const phase8DeviceId = readPhase8DeviceId(userId);
    if (phase8DeviceId) {
      try {
        await AdytonKeystore.deleteKeys({ deviceId: phase8DeviceId });
      } catch {
        // Ignore — keys may already be absent
      }
      localStorage.removeItem(PHASE8_DEVICE_KEY_PREFIX + userId);
    }
  }

  /**
   * Prompts the user for biometric authentication. On success, decrypts the
   * stored vault key and calls `cryptoStore.unlockWithRawKey`.
   *
   * PAK path:
   *  - `AdytonKeystore.unsealVaultKey` triggers the biometric prompt via BiometricPrompt
   *    CryptoObject — the OS enforces biometric before the AES wrap key is released.
   *  - Cancel codes → return false; hardware errors → re-throw (do NOT auto-unenroll).
   *
   * Phase 8 path:
   *  - Same mechanism as PAK: AdytonKeystore.unsealVaultKey triggers BiometricPrompt
   *    internally — biometric is OS-enforced, not a JS gate.
   *  - Cancel codes → return false; hardware errors → re-throw.
   *
   * Returns:
   *  - `true`  — authentication succeeded and the vault is now unlocked.
   *  - `false` — user cancelled, biometry locked out, or not enrolled.
   *
   * Re-throws unexpected errors (hardware failures, OS-level errors).
   */
  async function unlockWithBiometrics(userId: string): Promise<boolean> {
    const { AdytonKeystore } = await import('@adyton/capacitor-keystore');

    // PAK path — ECDH + SIGN + wrap key enrolled
    const pakDeviceId = readPakDeviceId(userId);
    if (pakDeviceId) {
      try {
        const { exists } = await withTimeout(AdytonKeystore.hasKeys({ deviceId: pakDeviceId }), NATIVE_CALL_TIMEOUT_MS);
        if (!exists) {
          localStorage.removeItem(PAK_DEVICE_KEY_PREFIX + userId);
          return false;
        }

        const { vaultKeyRaw } = await withTimeout(
          AdytonKeystore.unsealVaultKey({ deviceId: pakDeviceId }),
          NATIVE_CALL_TIMEOUT_MS,
        );
        const raw = Uint8Array.from(atob(vaultKeyRaw), c => c.charCodeAt(0)).buffer as ArrayBuffer;

        if (raw.byteLength !== 32) {
          localStorage.removeItem(PAK_DEVICE_KEY_PREFIX + userId);
          return false;
        }

        const { useCryptoStore } = await import('../stores/crypto');
        try {
          await useCryptoStore().unlockWithRawKey(raw);
        } finally {
          new Uint8Array(raw).fill(0);
        }
        return true;
      } catch (err: unknown) {
        const code = errorCode(err);
        if (code !== null && CANCEL_CODES.has(code)) return false;
        throw err;
      }
    }

    // Phase 8 path — wrap key only (non-PAK biometric enrollment)
    const phase8DeviceId = readPhase8DeviceId(userId);
    if (phase8DeviceId) {
      try {
        const { exists } = await withTimeout(AdytonKeystore.hasRawKey({ deviceId: phase8DeviceId }), NATIVE_CALL_TIMEOUT_MS);
        if (!exists) {
          localStorage.removeItem(PHASE8_DEVICE_KEY_PREFIX + userId);
          return false;
        }

        // unsealVaultKey shows BiometricPrompt with CryptoObject — OS-enforced biometric.
        const { vaultKeyRaw } = await withTimeout(
          AdytonKeystore.unsealVaultKey({ deviceId: phase8DeviceId }),
          NATIVE_CALL_TIMEOUT_MS,
        );
        const raw = Uint8Array.from(atob(vaultKeyRaw), c => c.charCodeAt(0)).buffer as ArrayBuffer;

        if (raw.byteLength !== 32) {
          localStorage.removeItem(PHASE8_DEVICE_KEY_PREFIX + userId);
          return false;
        }

        const { useCryptoStore } = await import('../stores/crypto');
        try {
          await useCryptoStore().unlockWithRawKey(raw);
        } finally {
          new Uint8Array(raw).fill(0);
        }
        return true;
      } catch (err: unknown) {
        const code = errorCode(err);
        if (code !== null && CANCEL_CODES.has(code)) return false;
        throw err;
      }
    }

    return false;
  }

  /**
   * Verifies that `raw` bytes, when imported as a key, can decrypt data that
   * was encrypted with `current`. Returns true iff the bytes match the key
   * material behind `current`.
   *
   * Implemented as an encrypt-then-decrypt round-trip against random plaintext.
   * `crypto.subtle.exportKey` is never called — the non-extractable invariant
   * is preserved throughout.
   */
  async function verifyRawKeyMatches(
    raw: ArrayBuffer,
    current: CryptoKey,
  ): Promise<boolean> {
    const candidate = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );

    const plaintext = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      current,
      plaintext,
    );

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        candidate,
        ciphertext,
      );
      const decryptedBytes = new Uint8Array(decrypted);
      return plaintext.every((b, i) => b === decryptedBytes[i]);
    } catch {
      return false;
    }
  }

  return {
    isSupported,
    isEnrolled,
    enroll,
    unenroll,
    unlockWithBiometrics,
    verifyRawKeyMatches,
  };
}
