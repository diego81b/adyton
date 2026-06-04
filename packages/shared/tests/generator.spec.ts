import { describe, it, expect } from 'vitest';
import {
  generatePassphrase,
  generatePassphraseWords,
  passwordEntropyBits,
  passphraseEntropyBits,
} from '../src/generator.js';
import { buildPasswordPool } from '../src/crypto.js';
import { EFF_LARGE_WORDLIST } from '../src/wordlist.js';
import type { PasswordOptions } from '../src/types.js';

const ALL_CLASSES: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

describe('EFF_LARGE_WORDLIST', () => {
  it('contains exactly 7776 unique lowercase words', () => {
    expect(EFF_LARGE_WORDLIST).toHaveLength(7776);
    expect(new Set(EFF_LARGE_WORDLIST).size).toBe(7776);
    for (const word of EFF_LARGE_WORDLIST) {
      expect(word).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('buildPasswordPool', () => {
  it('builds the full 86-char pool with all classes enabled', () => {
    expect(buildPasswordPool(ALL_CLASSES)).toHaveLength(86);
  });

  it('strips ambiguous characters O0Il1 when excludeAmbiguous is set', () => {
    const pool = buildPasswordPool({ ...ALL_CLASSES, excludeAmbiguous: true });
    expect(pool).toHaveLength(81);
    for (const c of 'O0Il1') expect(pool).not.toContain(c);
  });

  it('returns an empty pool when no classes are selected', () => {
    expect(
      buildPasswordPool({
        length: 20,
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false,
        excludeAmbiguous: false,
      }),
    ).toBe('');
  });
});

describe('generatePassphrase', () => {
  it('generates the requested number of words joined by the default separator', () => {
    const phrase = generatePassphrase({ words: 5 });
    const words = phrase.split('-');
    // Words themselves may contain '-' (EFF list has hyphenated entries), so
    // splitting can only over-count — assert at least 5 segments and full membership
    // via the custom-separator test below.
    expect(words.length).toBeGreaterThanOrEqual(5);
  });

  it('uses a custom separator and picks only wordlist words', () => {
    const phrase = generatePassphrase({ words: 6, separator: '::' });
    const words = phrase.split('::');
    expect(words).toHaveLength(6);
    const list = new Set(EFF_LARGE_WORDLIST);
    for (const word of words) expect(list.has(word)).toBe(true);
  });

  it('produces different passphrases on consecutive calls', () => {
    // 4 words = ~51.7 bits; collision probability is negligible.
    expect(generatePassphrase({ words: 4 })).not.toBe(generatePassphrase({ words: 4 }));
  });

  it.each([0, -1, 1.5, 21, NaN])('rejects invalid word count %p', (words) => {
    expect(() => generatePassphrase({ words })).toThrow(/word count/i);
  });

  it('generatePassphraseWords returns the words as an array from the wordlist', () => {
    const words = generatePassphraseWords(5);
    expect(words).toHaveLength(5);
    const list = new Set(EFF_LARGE_WORDLIST);
    for (const word of words) expect(list.has(word)).toBe(true);
  });
});

describe('passwordEntropyBits', () => {
  it('computes length × log2(pool) for the full pool', () => {
    expect(passwordEntropyBits(ALL_CLASSES)).toBeCloseTo(20 * Math.log2(86), 6);
  });

  it('shrinks when excludeAmbiguous reduces the pool', () => {
    const bits = passwordEntropyBits({ ...ALL_CLASSES, excludeAmbiguous: true });
    expect(bits).toBeCloseTo(20 * Math.log2(81), 6);
    expect(bits).toBeLessThan(passwordEntropyBits(ALL_CLASSES));
  });

  it('returns 0 when no classes are selected', () => {
    expect(
      passwordEntropyBits({
        length: 20,
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false,
        excludeAmbiguous: false,
      }),
    ).toBe(0);
  });
});

describe('passphraseEntropyBits', () => {
  it('computes words × log2(7776)', () => {
    expect(passphraseEntropyBits(5)).toBeCloseTo(5 * Math.log2(7776), 6);
  });

  it('returns 0 for invalid word counts', () => {
    expect(passphraseEntropyBits(0)).toBe(0);
    expect(passphraseEntropyBits(2.5)).toBe(0);
  });
});
