import { ref } from 'vue';
import { wrapVaultKeyForRecovery } from '@adyton/shared';
import { useAuthStore } from '../stores/auth';
import { useCryptoStore } from '../stores/crypto';
import { deriveRawKey } from './useArgon2Worker';
import { useBiometricUnlock } from './useBiometricUnlock';

/**
 * Regenerates the recovery kit in place — same crypto as PAK enrollment
 * (usePakEnrollment.ts confirmAndSend), but decoupled from enrolling a device.
 * POST /auth/recovery/setup is an upsert server-side, so this replaces any
 * existing kit with a fresh salt + mnemonic without ever deleting first.
 */
export function useRecoveryKitRegenerate() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const mnemonic = ref<string[] | null>(null);

  async function regenerate(masterPassword: string): Promise<boolean> {
    const authStore = useAuthStore();
    const kdfSalt = authStore.user?.kdfSalt;
    if (!kdfSalt) {
      error.value = 'User session missing. Please log in again.';
      return false;
    }

    loading.value = true;
    error.value = null;
    let raw: ArrayBuffer | null = null;

    try {
      raw = await deriveRawKey(masterPassword, kdfSalt);

      const cryptoStore = useCryptoStore();
      const currentKey = cryptoStore.cryptoKey;
      if (!currentKey) {
        error.value = 'Vault is locked. Unlock it first.';
        return false;
      }

      const { verifyRawKeyMatches } = useBiometricUnlock();
      const ok = await verifyRawKeyMatches(raw, currentKey);
      if (!ok) {
        error.value = 'Wrong master password.';
        return false;
      }

      const rawBytes = new Uint8Array(raw) as Uint8Array<ArrayBuffer>;
      const kit = await wrapVaultKeyForRecovery(rawBytes);

      // Server-side upsert — only after this succeeds do we show the new
      // mnemonic, so the user never writes down words the server rejected.
      await authStore.apiFetch('/auth/recovery/setup', {
        method: 'POST',
        body: {
          recoverySalt: kit.recoverySalt,
          recoveryWrappedVaultKey: kit.recoveryWrappedVaultKey,
          wrapIv: kit.wrapIv,
        },
      });

      mnemonic.value = kit.mnemonic.split(' ');
      return true;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'Failed to regenerate recovery kit.';
      return false;
    } finally {
      if (raw !== null) new Uint8Array(raw).fill(0);
      loading.value = false;
    }
  }

  function reset() {
    mnemonic.value = null;
    error.value = null;
  }

  return { loading, error, mnemonic, regenerate, reset };
}
