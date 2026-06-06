import { ref, toValue, watch, onMounted, onScopeDispose, type MaybeRefOrGetter } from 'vue';
import { generateTotp, totpRemainingSeconds } from '@adyton/shared';

const PERIOD = 30;

/**
 * Live TOTP for a stored base32 seed: a reactive 6-digit `code` that rotates every 30s
 * and a `remaining` second count driving the countdown ring. Recomputes the code only
 * when the period boundary crosses (not every tick). `error` flips true if the seed is
 * not valid base32. Reactive to the seed source so it follows an entry switch / edit.
 */
export function useTotp(secret: MaybeRefOrGetter<string | undefined | null>, period = PERIOD) {
  const code = ref('');
  const remaining = ref(period);
  const error = ref(false);
  let lastCounter = -1;

  async function recompute() {
    const seed = toValue(secret);
    if (!seed) {
      code.value = '';
      error.value = false;
      return;
    }
    try {
      code.value = await generateTotp(seed, { period });
      error.value = false;
    } catch {
      code.value = '';
      error.value = true;
    }
  }

  function tick() {
    remaining.value = totpRemainingSeconds(period);
    const counter = Math.floor(Date.now() / 1000 / period);
    if (counter !== lastCounter) {
      lastCounter = counter;
      void recompute();
    }
  }

  let interval: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    tick();
    interval = setInterval(tick, 1000);
  });

  // Re-seed when the secret source changes (e.g. navigating between entries).
  watch(
    () => toValue(secret),
    () => {
      lastCounter = -1;
      tick();
    },
  );

  onScopeDispose(() => {
    if (interval) clearInterval(interval);
  });

  /**
   * Fraction 0..1 of the current period REMAINING — feeds the ring `--progress`.
   * The ring DRAINS as the code expires (matches mockup `totpSeconds / 30`), so it
   * reads as a countdown, not a count-up.
   */
  function progress(): number {
    return remaining.value / period;
  }

  return { code, remaining, error, progress };
}
