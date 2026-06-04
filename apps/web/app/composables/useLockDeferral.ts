import { watch, onScopeDispose, type Ref } from 'vue';
import { useCryptoStore } from '../stores/crypto';
import { useSettingsStore } from '../stores/settings';

/**
 * Defers a timer-fired auto-lock while `dirty` is true AND the lock mode is
 * 'absolute' (in 'activity' mode typing already resets the timer, so deferral is
 * pointless). The lock fires immediately once the form is no longer dirty —
 * an idle open page still locks on schedule. Unmount always releases.
 */
export function useLockDeferral(dirty: Ref<boolean>) {
  const crypto = useCryptoStore();
  const settings = useSettingsStore();
  let active = false;

  function sync() {
    const want = dirty.value && settings.lockMode === 'absolute';
    if (want && !active) {
      crypto.deferLock();
      active = true;
    } else if (!want && active) {
      crypto.releaseLockDeferral();
      active = false;
    }
  }

  watch([dirty, () => settings.lockMode], sync, { immediate: true });

  onScopeDispose(() => {
    if (active) {
      crypto.releaseLockDeferral();
      active = false;
    }
  });
}
