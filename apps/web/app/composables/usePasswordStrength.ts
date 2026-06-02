import { ref, computed, watch, onScopeDispose } from 'vue';
import { validateMasterPassword } from '@adyton/shared';
import type { PasswordStrengthResult } from '@adyton/shared';
import type { Ref } from 'vue';

// Mockup palette (analysis/frontend/mockups/adyton.html) indexed by zxcvbn score 0-4.
const SEG_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e'];
const LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const LABEL_COLORS = ['#64748b', '#f87171', '#fbbf24', '#facc15', '#4ade80'];

/**
 * Debounced master-password strength evaluation, derived display state, and the
 * Shannon-entropy readout. Encapsulates the zxcvbn call (a side effect) so pages
 * stay presentational.
 *
 * NOTE: validateMasterPassword also runs the HIBP breach check (network call) on
 * each debounced run; moving that to on-blur only is tracked as a follow-up.
 */
export function usePasswordStrength(password: Ref<string>, debounceMs = 500) {
  const result = ref<PasswordStrengthResult | null>(null);
  const validating = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  watch(password, (pw) => {
    result.value = null;
    if (timer) clearTimeout(timer);
    if (!pw) return;
    timer = setTimeout(async () => {
      validating.value = true;
      try {
        result.value = await validateMasterPassword(pw);
      } finally {
        validating.value = false;
      }
    }, debounceMs);
  });

  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });

  const score = computed(() => result.value?.score ?? 0);
  const valid = computed(() => result.value?.valid === true);
  const feedback = computed(() => result.value?.feedback ?? []);
  const segColor = computed(() => SEG_COLORS[Math.min(score.value - 1, 3)] ?? '');
  const label = computed(() => LABELS[score.value] || 'Strength');
  const labelColor = computed(() => LABEL_COLORS[score.value] ?? '#64748b');

  // Charset-pool × length entropy estimate — cosmetic readout, mirrors the mockup.
  const bits = computed(() => {
    const pw = password.value;
    if (!pw) return 0;
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10;
    if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
    return pool ? Math.floor(pw.length * Math.log2(pool)) : 0;
  });

  return { result, validating, score, valid, feedback, segColor, label, labelColor, bits };
}
