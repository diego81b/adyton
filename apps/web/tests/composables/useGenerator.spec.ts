import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import { EFF_LARGE_WORDLIST } from '@adyton/shared';
import { useGenerator } from '../../app/composables/useGenerator';

describe('useGenerator', () => {
  it('generates an initial password with the default options', () => {
    const g = useGenerator();
    expect(g.mode.value).toBe('password');
    expect(g.generated.value).toHaveLength(20);
    expect(g.error.value).toBe('');
  });

  it('regenerates when an option changes', async () => {
    const g = useGenerator();
    const before = g.generated.value;
    g.passwordOptions.length = 32;
    await nextTick();
    expect(g.generated.value).toHaveLength(32);
    expect(g.generated.value).not.toBe(before);
  });

  it('switches to passphrase mode and exposes the words', async () => {
    const g = useGenerator();
    g.mode.value = 'passphrase';
    await nextTick();
    expect(g.words.value).toHaveLength(5);
    const list = new Set(EFF_LARGE_WORDLIST);
    for (const word of g.words.value) expect(list.has(word)).toBe(true);
    expect(g.generated.value).toBe(g.words.value.join('-'));
  });

  it('computes entropy from the real pool (all classes, length 20 → 20·log2(86))', () => {
    const g = useGenerator();
    expect(g.entropyBits.value).toBeCloseTo(20 * Math.log2(86), 6);
  });

  it('entropy shrinks with excludeAmbiguous and tracks word count in passphrase mode', async () => {
    const g = useGenerator();
    const full = g.entropyBits.value;
    g.passwordOptions.excludeAmbiguous = true;
    await nextTick();
    expect(g.entropyBits.value).toBeLessThan(full);
    expect(g.entropyBits.value).toBeCloseTo(20 * Math.log2(81), 6);

    g.mode.value = 'passphrase';
    g.wordCount.value = 4;
    await nextTick();
    expect(g.entropyBits.value).toBeCloseTo(4 * Math.log2(7776), 6);
  });

  it('sets an error and clears output when no character class is selected', async () => {
    const g = useGenerator();
    g.passwordOptions.uppercase = false;
    g.passwordOptions.lowercase = false;
    g.passwordOptions.numbers = false;
    g.passwordOptions.symbols = false;
    await nextTick();
    expect(g.generated.value).toBe('');
    expect(g.error.value).toMatch(/character classes/i);
    expect(g.entropyBits.value).toBe(0);
    expect(g.strength.value.label).toBe('Weak');
  });

  it.each([
    [3, 'Weak'],       // 3 × 12.92 ≈ 38.8 bits
    [4, 'Fair'],       // 4 × 12.92 ≈ 51.7 bits
    [6, 'Strong'],     // 6 × 12.92 ≈ 77.5 bits
    [8, 'Excellent'],  // 8 × 12.92 ≈ 103.4 bits
  ])('maps a %d-word passphrase to the %s tier', async (count, label) => {
    const g = useGenerator();
    g.mode.value = 'passphrase';
    g.wordCount.value = count;
    await nextTick();
    expect(g.strength.value.label).toBe(label);
  });

  it('manual regenerate produces a new value', () => {
    const g = useGenerator();
    const before = g.generated.value;
    g.regenerate();
    expect(g.generated.value).not.toBe(before);
    expect(g.generated.value).toHaveLength(20);
  });
});
