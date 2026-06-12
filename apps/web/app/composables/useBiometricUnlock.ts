import { hexToBytes } from '@adyton/shared';
import { useNativeRuntime } from './useNativeRuntime';

// Storage key prefix — all enrolled vault keys are stored under this namespace.
const KEY_PREFIX = 'adyton.vaultKey.';

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
   * Returns true if the user has enrolled biometric unlock for the given userId,
   * i.e. a vault key is stored under `adyton.vaultKey.<userId>`.
   */
  async function isEnrolled(userId: string): Promise<boolean> {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    const value = await SecureStorage.get(KEY_PREFIX + userId);
    return value !== null;
  }

  /**
   * Persists the raw key bytes in native secure storage (iOS Keychain /
   * Android Keystore) so the user can unlock with biometrics instead of
   * re-typing their master password.
   *
   * Throws if called on the web platform — biometric enrollment is a
   * native-only capability (localStorage / IndexedDB are forbidden for
   * key material per the security model).
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
   * Removes the stored vault key for a given user. Silent no-op if the key
   * does not exist — safe to call without an isEnrolled check first.
   */
  async function unenroll(userId: string): Promise<void> {
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
   * Returns:
   *  - `true`  — authentication succeeded and the vault is now unlocked.
   *  - `false` — the user cancelled, the biometry is locked out, the user
   *              is not enrolled, or the stored data was corrupt (auto-unenrolled).
   *
   * Re-throws unexpected errors (hardware failures, OS-level errors) so
   * callers can surface them to the user.
   */
  async function unlockWithBiometrics(userId: string): Promise<boolean> {
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
