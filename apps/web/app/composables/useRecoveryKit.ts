import { ref } from 'vue';
import { unwrapVaultKeyFromRecovery, validateRecoveryMnemonic } from '@adyton/shared';
import { useAuthStore } from '~/stores/auth';
import { useCryptoStore } from '~/stores/crypto';
import { useVaultStore } from '~/stores/vault';

export function useRecoveryKit() {
  const status = ref<'idle' | 'validating' | 'recovering' | 'done' | 'error'>('idle');
  const error = ref<string | null>(null);

  async function recover(mnemonicWords: string[]): Promise<void> {
    status.value = 'validating';
    error.value = null;

    const mnemonic = mnemonicWords.join(' ');
    if (!validateRecoveryMnemonic(mnemonic)) {
      status.value = 'error';
      error.value = 'Invalid recovery phrase format. Check each word and try again.';
      return;
    }

    status.value = 'recovering';
    const authStore = useAuthStore();

    let rawBytes: Uint8Array<ArrayBuffer> | null = null;
    try {
      // Fetch the encrypted kit from the server
      const kit = await authStore.apiFetch<{
        recoverySalt: string;
        recoveryWrappedVaultKey: string;
        wrapIv: string;
      }>('/auth/recovery/vault-key');

      // Decrypt the vault key locally using the mnemonic
      rawBytes = await unwrapVaultKeyFromRecovery(
        mnemonic,
        kit.recoverySalt,
        kit.recoveryWrappedVaultKey,
        kit.wrapIv,
      );

      // Import the raw key bytes into the crypto store (same path as biometric unlock).
      // unlockWithRawKey accepts ArrayBuffer; pass the underlying buffer.
      const cryptoStore = useCryptoStore();
      await cryptoStore.unlockWithRawKey(rawBytes.buffer);

      // Zeroize raw bytes immediately after import — must not outlive this scope
      rawBytes.fill(0);
      rawBytes = null;

      // Load and decrypt the vault
      const vaultStore = useVaultStore();
      await vaultStore.fetchAll();

      status.value = 'done';
      await navigateTo('/vault');
    } catch (err: unknown) {
      // Zeroize on any failure
      if (rawBytes !== null) {
        rawBytes.fill(0);
        rawBytes = null;
      }

      status.value = 'error';

      if (err !== null && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
        error.value = 'No recovery kit is set up. Enroll a phone first, then set up a recovery kit.';
      } else if (err instanceof DOMException && err.name === 'OperationError') {
        error.value = 'Incorrect recovery phrase. Check each word and try again.';
      } else if (err instanceof Error) {
        error.value = err.message;
      } else {
        error.value = 'Recovery failed. Please try again.';
      }
    }
  }

  return { status, error, recover };
}
