import { hexToBytes } from '@adyton/shared';
import { useNativeRuntime } from './useNativeRuntime';

// Storage key prefix — Phase 8 secure-storage enrolled vault keys.
const KEY_PREFIX = 'adyton.vaultKey.';

// PAK (Phone-as-Key) device ID lookup — written by /pak/enroll after SE sealing.
const PAK_DEVICE_KEY_PREFIX = 'adyton_pak_device_';

// ---------------------------------------------------------------------------
// Local helper: ArrayBuffer → lowercase hex string.
// bytesToHex is not exported from @adyton/shared (only hexToBytes is present),
// so we keep this as a private utility here.
// ---------------------------------------------------------------------------
function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Cancel / fallback error codes from BiometricAuth that are NOT bugs.
// The user intentionally dismissed the prompt or the OS cancelled it.
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

/**
 * Validates that a stored value is a 64-character hex string (32 decoded bytes).
 * Returns the decoded ArrayBuffer or null if invalid.
 */
function decodeStoredHex(value: unknown): ArrayBuffer | null {
  if (typeof value !== 'string') return null;
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;
  const bytes = hexToBytes(value);
  // Copy into a plain ArrayBuffer to avoid the SharedArrayBuffer union type that
  // TypedArray.buffer can have — Web Crypto APIs require a plain ArrayBuffer.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/** Read the PAK device ID from localStorage, or null if not enrolled. */
function readPakDeviceId(userId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(PAK_DEVICE_KEY_PREFIX + userId);
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
   * PAK path: checks localStorage for a device ID, then verifies SE keys still
   * exist in Android Keystore (handles app reinstall / key erasure).
   * Phase 8 fallback: checks @aparajita/capacitor-secure-storage.
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

    // Phase 8 fallback: vault key stored directly in secure storage
    try {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      const value = await SecureStorage.get(KEY_PREFIX + userId);
      return value !== null;
    } catch {
      return false;
    }
  }

  /**
   * Persists the raw key bytes in native secure storage (iOS Keychain /
   * Android Keystore) so the user can unlock with biometrics instead of
   * re-typing their master password.
   *
   * Throws if called on the web platform — biometric enrollment is a
   * native-only capability (localStorage / IndexedDB are forbidden for
   * key material per the security model).
   *
   * Note: PAK enrollment goes through /pak/enroll + AdytonKeystore.sealVaultKey.
   * This method is used for the Phase 8 non-PAK biometric path only.
   */
  async function enroll(userId: string, raw: ArrayBuffer): Promise<void> {
    const { isNative } = useNativeRuntime();
    if (!isNative) {
      throw new Error(
        'Biometric enrollment is not supported on the web platform. ' +
        'Key material must only be persisted in native secure storage.',
      );
    }

    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.set(KEY_PREFIX + userId, bytesToHex(raw));
  }

  /**
   * Removes the stored vault key for a given user.
   *
   * Handles both storage backends:
   * - PAK: deletes keys from Android Keystore + removes localStorage entry.
   * - Phase 8: removes from @aparajita/capacitor-secure-storage.
   *
   * Silent no-op if the user is not enrolled — safe to call without a prior
   * isEnrolled check.
   */
  async function unenroll(userId: string): Promise<void> {
    // PAK path
    const pakDeviceId = readPakDeviceId(userId);
    if (pakDeviceId) {
      try {
        const { AdytonKeystore } = await import('@adyton/capacitor-keystore');
        await AdytonKeystore.deleteKeys({ deviceId: pakDeviceId });
      } catch {
        // Ignore — keys may already be absent (app reinstall, etc.)
      }
      localStorage.removeItem(PAK_DEVICE_KEY_PREFIX + userId);
    }

    // Phase 8 fallback — remove regardless of PAK state so both paths are cleaned
    // up if migration left both coexisting during a transition window.
    try {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      await SecureStorage.remove(KEY_PREFIX + userId);
    } catch {
      // Key was never enrolled or already removed — nothing to do.
    }
  }

  /**
   * Prompts the user for biometric authentication. On success, reads the
   * stored raw key bytes and calls `cryptoStore.unlockWithRawKey`.
   *
   * PAK path:
   *  - `AdytonKeystore.unsealVaultKey` triggers the biometric prompt internally.
   *  - On success, the raw key bytes are decoded and imported as a non-extractable
   *    AES-GCM CryptoKey.
   *  - PAK hardware/OS errors (not user cancellation) are re-thrown — do NOT
   *    auto-unenroll on hardware errors, only on stale-key detect.
   *
   * Phase 8 path (SecureStorage):
   *  - BiometricAuth.authenticate prompts separately.
   *  - Corrupt stored data → auto-unenroll + return false.
   *
   * Returns:
   *  - `true`  — authentication succeeded and the vault is now unlocked.
   *  - `false` — the user cancelled, biometry is locked out, not enrolled,
   *              or the stored data was corrupt (auto-unenrolled).
   *
   * Re-throws unexpected errors (hardware failures, OS-level errors) so
   * callers can surface them to the user.
   */
  async function unlockWithBiometrics(userId: string): Promise<boolean> {
    // PAK path — biometric prompt is internal to unsealVaultKey
    const pakDeviceId = readPakDeviceId(userId);
    if (pakDeviceId) {
      try {
        const { AdytonKeystore } = await import('@adyton/capacitor-keystore');

        // Verify keys still exist before triggering the biometric prompt
        const { exists } = await AdytonKeystore.hasKeys({ deviceId: pakDeviceId });
        if (!exists) {
          // Stale entry (app reinstall, etc.) — clean up and report not enrolled
          localStorage.removeItem(PAK_DEVICE_KEY_PREFIX + userId);
          return false;
        }

        // unsealVaultKey triggers the biometric prompt and decrypts in SE
        const { vaultKeyRaw } = await AdytonKeystore.unsealVaultKey({ deviceId: pakDeviceId });

        // Decode base64 raw key → ArrayBuffer
        const raw = Uint8Array.from(atob(vaultKeyRaw), c => c.charCodeAt(0)).buffer as ArrayBuffer;

        // Validate: must be exactly 32 bytes (256-bit AES key)
        if (raw.byteLength !== 32) {
          // Corrupt SE data — unenroll to prevent repeated failures
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
        // PAK hardware/OS error — do NOT unenroll (keys may still be valid).
        // Let the caller decide whether to surface this as an error.
        throw err;
      }
    }

    // Phase 8 fallback — @aparajita/capacitor-secure-storage + BiometricAuth
    const { SecureStorage, StorageErrorType } = await import('@aparajita/capacitor-secure-storage');

    // Read the stored key — handle corrupt data before prompting biometrics.
    let storedValue: unknown = null;
    try {
      storedValue = await SecureStorage.get(KEY_PREFIX + userId);
    } catch (err: unknown) {
      if (errorCode(err) === StorageErrorType.invalidData) {
        await unenroll(userId);
        return false;
      }
      throw err;
    }

    // Not enrolled.
    if (storedValue === null) return false;

    // Validate the stored hex before opening the biometric prompt.
    const raw = decodeStoredHex(storedValue);
    if (raw === null) {
      await unenroll(userId);
      return false;
    }

    // Prompt biometric authentication.
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      await BiometricAuth.authenticate({
        reason: 'Unlock Adyton vault',
        cancelTitle: 'Cancel',
      });
    } catch (err: unknown) {
      const code = errorCode(err);
      if (code !== null && CANCEL_CODES.has(code)) return false;
      throw err;
    }

    // Authentication succeeded — import the key and unlock the store.
    const { useCryptoStore } = await import('../stores/crypto');
    try {
      await useCryptoStore().unlockWithRawKey(raw);
    } finally {
      // Best-effort zeroize: once imported as a non-extractable CryptoKey the
      // raw bytes have no reason to stay on the JS heap.
      new Uint8Array(raw).fill(0);
    }
    return true;
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
      // AES-GCM tag mismatch — keys differ.
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
