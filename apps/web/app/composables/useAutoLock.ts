import { computed, ref } from 'vue';
import { useEventListener, useIntervalFn, useThrottleFn } from '@vueuse/core';
import { useCryptoStore } from '../stores/crypto';
import { useSettingsStore } from '../stores/settings';

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
  const settings = useSettingsStore();
  const now = ref(Date.now());

  // throttle(fn, ms, trailing=false, leading=true): fire on first activity, then ignore
  // further activity for the window so the countdown can decrement between resets.
  // In 'absolute' lock mode activity never resets the timer (per-user setting).
  const reset = useThrottleFn(
    () => {
      if (crypto.isUnlocked && settings.lockMode === 'activity') crypto.resetLockTimer();
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
    // Auto-lock set to "never": no timer while unlocked (pill still locks on click).
    if (crypto.isUnlocked && crypto.lockAt === null) return 'off';
    const totalSec = Math.ceil(remainingMs.value / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  });

  return { reset, remainingMs, countdown };
}
