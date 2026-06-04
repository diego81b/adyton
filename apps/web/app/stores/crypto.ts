import { shallowRef, ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { useSettingsStore } from './settings';

export const useCryptoStore = defineStore('crypto', () => {
  // shallowRef: CryptoKey is opaque — do not deep-proxy it
  const cryptoKey = shallowRef<CryptoKey | null>(null);
  const isUnlocked = computed(() => cryptoKey.value !== null);
  // Epoch ms at which the auto-lock timer will fire; null when locked or when the
  // user set auto-lock to "never". Drives the countdown pill in the vault layout
  // header. Not a security control — the real lock is the setTimeout below clearing
  // cryptoKey.
  const lockAt = ref<number | null>(null);
  let lockTimer: ReturnType<typeof setTimeout> | null = null;

  // Lock deferral: while > 0 (e.g. an entry form has unsaved edits in absolute lock
  // mode) an expiring timer does NOT clear the key; the lock fires as soon as the
  // last deferral is released. An idle open page must still lock on schedule, so
  // callers defer only while genuinely dirty — never for the whole page lifetime.
  const deferrals = ref(0);
  let lockPending = false;

  async function deriveKey(masterPassword: string, kdfSaltHex: string): Promise<void> {
    const { useArgon2Worker } = await import('../composables/useArgon2Worker');
    cryptoKey.value = await useArgon2Worker(masterPassword, kdfSaltHex);
    resetLockTimer();
  }

  /** Explicit lock (lock button, logout): always locks, ignores deferrals. */
  function lock() {
    lockPending = false;
    deferrals.value = 0;
    cryptoKey.value = null;
    lockAt.value = null;
    if (lockTimer !== null) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
  }

  /** Timer-fired lock: respects active deferrals (unsaved edits). */
  function tryAutoLock() {
    if (deferrals.value > 0) {
      lockPending = true;
      return;
    }
    lock();
  }

  function resetLockTimer() {
    if (lockTimer !== null) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
    // Duration comes from per-user settings (DB-backed, localStorage boot cache).
    const ms = useSettingsStore().lockDurationMs;
    if (ms <= 0) {
      // "Never" — no timer. The key still dies on reload/tab close (in-memory only).
      lockAt.value = null;
      return;
    }
    lockAt.value = Date.now() + ms;
    lockTimer = setTimeout(tryAutoLock, ms);
  }

  function deferLock() {
    deferrals.value += 1;
  }

  function releaseLockDeferral() {
    deferrals.value = Math.max(0, deferrals.value - 1);
    if (deferrals.value === 0 && lockPending) lock(); // overdue — lock immediately
  }

  return {
    cryptoKey,
    isUnlocked,
    lockAt,
    deferrals,
    deriveKey,
    lock,
    resetLockTimer,
    deferLock,
    releaseLockDeferral,
  };
});
