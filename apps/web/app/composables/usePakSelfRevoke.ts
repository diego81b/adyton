import { ref } from 'vue';
import { computeDevicePublicKeyFingerprint } from '@adyton/shared';
import { useNativeRuntime } from './useNativeRuntime';
import { useAuthStore } from '../stores/auth';
import type { PakDevice } from './usePakDevices';

// Storage key prefix — Phase 8 secure-storage enrolled vault keys.
const KEY_PREFIX = 'adyton.vaultKey.';

// PAK (Phone-as-Key) device ID lookup — written by /pak/enroll after SE sealing.
const PAK_DEVICE_KEY_PREFIX = 'adyton_pak_device_';

// Cancel / fallback error codes from BiometricAuth / Keystore that are NOT bugs.
// The user intentionally dismissed the biometric prompt.
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

/** ArrayBuffer → lowercase hex string. */
function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * usePakSelfRevoke — reverse-migration composable for PAK self-revocation.
 *
 * When the user removes their own phone as a PAK key, this composable:
 *  1. Unseals the vault key from the Secure Enclave (biometric required).
 *  2. Restores the Phase 8 fallback (raw bytes → SecureStorage as hex).
 *  3. Deletes the SE keypair from Android Keystore.
 *  4. Removes the localStorage marker so useBiometricUnlock routes to Phase 8.
 *  5. Notifies the server (DELETE /devices/:id?reason=safe).
 *
 * All operations are native-only — calling on the web platform throws.
 */
export function usePakSelfRevoke() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Returns true if this device is currently enrolled as a PAK key.
   * Checks localStorage for the PAK device ID marker.
   * Always false on the web platform.
   */
  async function isPakDevice(userId: string): Promise<boolean> {
    const { isNative } = useNativeRuntime();
    if (!isNative) return false;
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(PAK_DEVICE_KEY_PREFIX + userId) !== null;
  }

  /**
   * Resolves the server-side DeviceVaultKey row for the local Keystore alias `deviceId`.
   *
   * `deviceId` (the Keystore alias / localStorage marker) is a purely client-generated UUID
   * (see enroll.vue) — the server never sees or stores it. The server only knows the device
   * by its own generated row `id` and by `publicKeyFingerprint` (SHA-256 of the SPKI public
   * key). To revoke the right row we recompute that fingerprint locally from the still-present
   * Keystore public key and match it against GET /pak/devices.
   *
   * Returns null if no matching, non-revoked server row is found (e.g. it was already
   * revoked from another device) — the caller should still clean up local state in that case.
   */
  async function resolveServerDeviceId(deviceId: string): Promise<string | null> {
    const { AdytonKeystore } = await import('@adyton/capacitor-keystore');
    const { ecdhPublicKey } = await AdytonKeystore.getPublicKeys({ deviceId });
    const fingerprint = await computeDevicePublicKeyFingerprint(ecdhPublicKey);

    const auth = useAuthStore();
    const devices = await auth.apiFetch<PakDevice[]>('/pak/devices');
    const match = devices.find((d) => d.publicKeyFingerprint === fingerprint && d.revokedAt === null);
    return match?.id ?? null;
  }

  /**
   * Revokes THIS device as a PAK key.
   *
   * Steps (in order):
   * 1. Read device ID from localStorage ('adyton_pak_device_' + userId)
   * 2. If missing: throw Error('This device is not enrolled as a PAK key')
   * 3. Resolve the server-side device row ID via resolveServerDeviceId() — done before any
   *    destructive local step so a network failure here leaves nothing torn down.
   * 4. Call AdytonKeystore.unsealVaultKey({ deviceId }) — triggers biometric prompt
   *    - On user cancel (errorCode in CANCEL_CODES): return false
   *    - On other error: rethrow
   * 5. Store raw bytes in SecureStorage under KEY_PREFIX + userId (Phase 8 restore)
   * 6. Call AdytonKeystore.deleteKeys({ deviceId }) — removes SE keypair
   * 7. Remove localStorage marker ('adyton_pak_device_' + userId)
   * 8. If a server device row was resolved: DELETE /pak/devices/:id?reason=safe
   * 9. Return true on success
   *
   * Sets loading=true during the operation; always resets loading=false in finally.
   * Sets error on failure (user cancel returns false cleanly without setting error).
   * Throws if called on web platform.
   */
  async function revokeThisDevice(userId: string): Promise<boolean> {
    const { isNative } = useNativeRuntime();
    if (!isNative) {
      throw new Error(
        'PAK self-revocation is not supported on the web platform. ' +
        'This operation requires native Secure Enclave access.',
      );
    }

    // Step 1: read PAK device ID
    const deviceId = typeof localStorage !== 'undefined'
      ? localStorage.getItem(PAK_DEVICE_KEY_PREFIX + userId)
      : null;

    // Step 2: not enrolled — bail out before touching loading state
    if (!deviceId) {
      throw new Error('This device is not enrolled as a PAK key');
    }

    loading.value = true;
    error.value = null;

    try {
      // Step 3: resolve the server-side row BEFORE any destructive local step
      const serverDeviceId = await resolveServerDeviceId(deviceId);

      // Step 4: unseal vault key from SE (triggers biometric prompt internally)
      const { AdytonKeystore } = await import('@adyton/capacitor-keystore');
      let vaultKeyRaw: string;
      try {
        ({ vaultKeyRaw } = await AdytonKeystore.unsealVaultKey({ deviceId }));
      } catch (err: unknown) {
        const code = errorCode(err);
        if (code !== null && CANCEL_CODES.has(code)) {
          // User intentionally cancelled — not an error, don't touch enrollment
          return false;
        }
        throw err;
      }

      // Decode base64 → ArrayBuffer (same pattern as useBiometricUnlock.ts:208-211)
      const rawBytes = Uint8Array.from(atob(vaultKeyRaw), c => c.charCodeAt(0));
      if (rawBytes.byteLength !== 32) {
        throw new Error(
          `Unsealed vault key is ${rawBytes.byteLength} bytes — expected 32. SE data corrupt.`,
        );
      }
      const raw = rawBytes.buffer as ArrayBuffer;

      // Step 5: restore Phase 8 fallback BEFORE deleting SE keys.
      // Order is safety-critical: if SecureStorage.set fails after deleteKeys, the user
      // loses biometric unlock entirely with no fallback.
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      await SecureStorage.set(KEY_PREFIX + userId, bytesToHex(raw));
      rawBytes.fill(0); // zeroize sensitive bytes after storing hex

      // Step 6: delete SE keypair from Android Keystore
      await AdytonKeystore.deleteKeys({ deviceId });

      // Step 7: remove localStorage marker — useBiometricUnlock now routes to Phase 8
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(PAK_DEVICE_KEY_PREFIX + userId);
      }

      // Step 8: notify server — only if a matching, still-active row was found
      if (serverDeviceId !== null) {
        const auth = useAuthStore();
        await auth.apiFetch(`/pak/devices/${serverDeviceId}?reason=safe`, { method: 'DELETE' });
      }

      // Step 9: done
      return true;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, isPakDevice, revokeThisDevice };
}
