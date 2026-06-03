import { computed, ref } from 'vue';
import { useEventListener, useIntervalFn, useThrottleFn } from '@vueuse/core';
import { useCryptoStore } from '../stores/crypto';

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'focus'] as const;
// Reset the lock timer at most once per this window. Raw mousemove fires hundreds of
// times a second; without throttling lockAt is rewritten constantly and the countdown
// never visibly ticks. Leading-edge: the first activity resets immediately.
const RESET_THROTTLE_MS = 30_000;

/**
 * Wires global user-activity listeners to reset the vault auto-lock timer, and
 * exposes a live `mm:ss` countdown to the next auto-lock. Call once, in the vault
 * layout. Listeners and the interval auto-clean on unmount (VueUse).
 */
export function useAutoLock() {
  const crypto = useCryptoStore();
  const now = ref(Date.now());

  // throttle(fn, ms, trailing=false, leading=true): fire on first activity, then ignore
  // further activity for the window so the countdown can decrement between resets.
  const reset = useThrottleFn(
    () => {
      if (crypto.isUnlocked) crypto.resetLockTimer();
    },
    RESET_THROTTLE_MS,
    false,
    true,
  );

  for (const evt of ACTIVITY_EVENTS) {
    useEventListener(window, evt, reset, { passive: true });
  }

  // Tick once a second to recompute the displayed countdown.
  useIntervalFn(() => {
    now.value = Date.now();
  }, 1000);

  const remainingMs = computed(() => {
    if (!crypto.lockAt) return 0;
    return Math.max(0, crypto.lockAt - now.value);
  });

  const countdown = computed(() => {
    const totalSec = Math.ceil(remainingMs.value / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  });

  return { reset, remainingMs, countdown };
}
