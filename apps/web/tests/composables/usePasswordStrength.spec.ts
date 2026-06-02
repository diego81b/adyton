import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, effectScope, nextTick } from 'vue';

const mockValidate = vi.fn();
vi.mock('@adyton/shared', () => ({
  validateMasterPassword: (...args: unknown[]) => mockValidate(...args),
}));

const { usePasswordStrength } = await import('../../app/composables/usePasswordStrength');

function result(score: number, valid: boolean, feedback: string[] = []) {
  return { valid, score, crackTimeSec: 1, feedback, breached: false };
}

describe('usePasswordStrength', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in an empty/neutral state', () => {
    const scope = effectScope();
    scope.run(() => {
      const { score, valid, bits, label, labelColor } = usePasswordStrength(ref(''));
      expect(score.value).toBe(0);
      expect(valid.value).toBe(false);
      expect(bits.value).toBe(0);
      expect(label.value).toBe('Strength');
      expect(labelColor.value).toBe('#64748b');
    });
    scope.stop();
  });

  it('debounces validation and reflects a strong result', async () => {
    mockValidate.mockResolvedValue(result(4, true));
    const scope = effectScope();
    await scope.run(async () => {
      const pw = ref('');
      const { score, valid, label, labelColor, segColor } = usePasswordStrength(pw, 500);

      pw.value = 'Tr0ub4dor&3xample!';
      await nextTick();
      expect(mockValidate).not.toHaveBeenCalled(); // still within debounce window

      await vi.advanceTimersByTimeAsync(500);
      expect(mockValidate).toHaveBeenCalledWith('Tr0ub4dor&3xample!');
      expect(score.value).toBe(4);
      expect(valid.value).toBe(true);
      expect(label.value).toBe('Strong');
      expect(labelColor.value).toBe('#4ade80');
      expect(segColor.value).toBe('#22c55e');
    });
    scope.stop();
  });

  it('maps a weak score to the red palette and exposes feedback', async () => {
    mockValidate.mockResolvedValue(
      result(1, false, ['Minimum 12 characters required.', 'Password is too predictable.']),
    );
    const scope = effectScope();
    await scope.run(async () => {
      const pw = ref('');
      const { label, labelColor, segColor, valid, feedback } = usePasswordStrength(pw);
      pw.value = 'abc';
      await vi.advanceTimersByTimeAsync(500);
      expect(label.value).toBe('Weak');
      expect(labelColor.value).toBe('#f87171');
      expect(segColor.value).toBe('#ef4444');
      expect(valid.value).toBe(false);
      expect(feedback.value).toEqual([
        'Minimum 12 characters required.',
        'Password is too predictable.',
      ]);
    });
    scope.stop();
  });

  it('only runs the final validation when typing rapidly (debounce collapses calls)', async () => {
    mockValidate.mockResolvedValue(result(3, false));
    const scope = effectScope();
    await scope.run(async () => {
      const pw = ref('');
      usePasswordStrength(pw, 500);
      pw.value = 'a';
      await nextTick();
      vi.advanceTimersByTime(200);
      pw.value = 'ab';
      await nextTick();
      vi.advanceTimersByTime(200);
      pw.value = 'abc';
      await nextTick();
      await vi.advanceTimersByTimeAsync(500);
      expect(mockValidate).toHaveBeenCalledTimes(1);
      expect(mockValidate).toHaveBeenCalledWith('abc');
    });
    scope.stop();
  });

  it('clears strength when the field is emptied', async () => {
    mockValidate.mockResolvedValue(result(4, true));
    const scope = effectScope();
    await scope.run(async () => {
      const pw = ref('');
      const { score } = usePasswordStrength(pw);
      pw.value = 'Tr0ub4dor&3xample!';
      await vi.advanceTimersByTimeAsync(500);
      expect(score.value).toBe(4);
      pw.value = '';
      await nextTick();
      expect(score.value).toBe(0); // result reset synchronously, no validation scheduled
    });
    scope.stop();
  });

  it('computes charset-pool entropy bits', async () => {
    const scope = effectScope();
    scope.run(() => {
      const pw = ref('');
      const { bits } = usePasswordStrength(pw);
      pw.value = 'abc'; // pool 26, len 3 -> floor(3 * log2(26)) = 14
      expect(bits.value).toBe(14);
      pw.value = 'Abc1!'; // pool 26+26+10+32=94, len 5 -> floor(5 * log2(94)) = 32
      expect(bits.value).toBe(32);
    });
    scope.stop();
  });
});
