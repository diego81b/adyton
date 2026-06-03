import { shallowRef, ref, computed } from 'vue';
import { defineStore } from 'pinia';

const AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes

export const useCryptoStore = defineStore('crypto', () => {
  // shallowRef: CryptoKey is opaque — do not deep-proxy it
  const cryptoKey = shallowRef<CryptoKey | null>(null);
  const isUnlocked = computed(() => cryptoKey.value !== null);
  // Epoch ms at which the auto-lock timer will fire; null when locked. Drives the
  // countdown pill in the vault layout header. Not a security control — the real
  // lock is the setTimeout below clearing cryptoKey.
  const lockAt = ref<number | null>(null);
  let lockTimer: ReturnType<typeof setTimeout> | null = null;

  async function deriveKey(masterPassword: string, kdfSaltHex: string): Promise<void> {
    const { useArgon2Worker } = await import('../composables/useArgon2Worker');
    cryptoKey.value = await useArgon2Worker(masterPassword, kdfSaltHex);
    resetLockTimer();
  }

  function lock() {
    cryptoKey.value = null;
    lockAt.value = null;
    if (lockTimer !== null) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
  }

  function resetLockTimer() {
    if (lockTimer !== null) clearTimeout(lockTimer);
    lockAt.value = Date.now() + AUTO_LOCK_MS;
    lockTimer = setTimeout(lock, AUTO_LOCK_MS);
  }

  return { cryptoKey, isUnlocked, lockAt, autoLockMs: AUTO_LOCK_MS, deriveKey, lock, resetLockTimer };
});
