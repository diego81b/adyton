// Passphrase generation + entropy helpers for the password/passphrase generator.
//
// Wordlist: EFF large (7776 words, log2(7776) ≈ 12.92 bits/word) — the standard
// diceware list for password managers. The EFF short list (1296 words) was rejected:
// only 10.34 bits/word, so a 4-word passphrase drops from ~51.7 to ~41.4 bits.
import { buildPasswordPool } from './crypto.js';
import type { PasswordOptions, PassphraseOptions } from './types.js';
import { EFF_LARGE_WORDLIST } from './wordlist.js';

export const PASSPHRASE_DEFAULTS = { separator: '-' } as const;

/**
 * Pick diceware words from the EFF large wordlist using CSPRNG + rejection
 * sampling (mirrors generatePassword — never Math.random, no modulo bias).
 * Exposed separately so UIs can color/word-wrap without re-splitting on a
 * separator (EFF words like "t-shirt" contain the default separator).
 */
export function generatePassphraseWords(words: number): string[] {
  if (!Number.isInteger(words) || words < 1 || words > 20) {
    throw new Error('Passphrase word count must be an integer between 1 and 20');
  }

  const listSize = EFF_LARGE_WORDLIST.length;
  // Rejection sampling over 32-bit values: 2^32 is not divisible by 7776,
  // so values >= maxUnbiased would over-represent low indexes.
  const maxUnbiased = Math.floor(0x1_0000_0000 / listSize) * listSize;
  const picked: string[] = [];
  const buf = new Uint32Array(8);
  while (picked.length < words) {
    crypto.getRandomValues(buf);
    for (const value of buf) {
      if (picked.length >= words) break;
      if (value < maxUnbiased) picked.push(EFF_LARGE_WORDLIST[value % listSize]!);
    }
  }
  return picked;
}

/** Generate a diceware passphrase joined by `separator` (default '-'). */
export function generatePassphrase(options: PassphraseOptions): string {
  const { words, separator = PASSPHRASE_DEFAULTS.separator } = options;
  return generatePassphraseWords(words).join(separator);
}

/** Entropy of a generated password in bits: length × log2(actual pool size). */
export function passwordEntropyBits(options: PasswordOptions): number {
  const pool = buildPasswordPool(options);
  if (pool.length === 0) return 0;
  return options.length * Math.log2(pool.length);
}

/** Entropy of a diceware passphrase in bits: words × log2(wordlist size). */
export function passphraseEntropyBits(words: number): number {
  if (!Number.isInteger(words) || words < 1) return 0;
  return words * Math.log2(EFF_LARGE_WORDLIST.length);
}
