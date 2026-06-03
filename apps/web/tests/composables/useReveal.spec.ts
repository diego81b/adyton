import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope } from 'vue';
import { useReveal } from '../../app/composables/useReveal';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useReveal', () => {
  it('reveals a field and auto-hides after 30s', () => {
    const scope = effectScope();
    scope.run(() => {
      const { reveal, isRevealed } = useReveal();
      reveal('pw');
      expect(isRevealed('pw')).toBe(true);
      vi.advanceTimersByTime(29_999);
      expect(isRevealed('pw')).toBe(true);
      vi.advanceTimersByTime(1);
      expect(isRevealed('pw')).toBe(false);
    });
    scope.stop();
  });

  it('toggles a field on and off', () => {
    const scope = effectScope();
    scope.run(() => {
      const { toggle, isRevealed } = useReveal();
      toggle('v');
      expect(isRevealed('v')).toBe(true);
      toggle('v');
      expect(isRevealed('v')).toBe(false);
    });
    scope.stop();
  });

  it('tracks each field independently', () => {
    const scope = effectScope();
    scope.run(() => {
      const { reveal, isRevealed } = useReveal();
      reveal('a');
      vi.advanceTimersByTime(20_000);
      reveal('b');
      // a hides at 30s, b still has 20s left
      vi.advanceTimersByTime(10_000);
      expect(isRevealed('a')).toBe(false);
      expect(isRevealed('b')).toBe(true);
    });
    scope.stop();
  });

  it('hideAll re-masks every revealed field', () => {
    const scope = effectScope();
    scope.run(() => {
      const { reveal, hideAll, isRevealed } = useReveal();
      reveal('a');
      reveal('b');
      hideAll();
      expect(isRevealed('a')).toBe(false);
      expect(isRevealed('b')).toBe(false);
    });
    scope.stop();
  });

  it('respects a custom hide window', () => {
    const scope = effectScope();
    scope.run(() => {
      const { reveal, isRevealed } = useReveal(5_000);
      reveal('x');
      vi.advanceTimersByTime(5_000);
      expect(isRevealed('x')).toBe(false);
    });
    scope.stop();
  });
});
