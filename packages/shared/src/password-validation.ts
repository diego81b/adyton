import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import { dictionary as enDictionary, translations } from '@zxcvbn-ts/language-en';

// Initialize dictionaries + keyboard graphs once on module load.
zxcvbnOptions.setOptions({
  translations,
  graphs: adjacencyGraphs,
  dictionary: {
    ...commonDictionary,
    ...enDictionary,
  },
});

export interface PasswordStrengthResult {
  valid: boolean;
  score: number;           // 0-4 (zxcvbn)
  crackTimeSec: number;    // offline fast hashing (1e10/s), worst-case seconds
  feedback: string[];      // user-facing rejection reasons (empty when valid)
  breached: boolean;       // found in HIBP corpus
}

// k-anonymity HIBP check — only the 5-char SHA-1 prefix is transmitted.
// Server returns ~400-600 suffix lines; full hash never leaves browser.
export async function isBreachedPassword(password: string): Promise<boolean> {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  const prefix = hashHex.slice(0, 5);
  const suffix = hashHex.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const text = await response.text();
  return text.split('\n').some(line => line.startsWith(suffix));
}

// Validates master password against all required rules.
// Returns PasswordStrengthResult — all reasons populated in `feedback` on failure.
// zxcvbn score=4 required (score 3 "Strong" is insufficient per security spec §3.2).
export async function validateMasterPassword(
  password: string,
): Promise<PasswordStrengthResult> {
  const result = zxcvbn(password);
  const feedback: string[] = [];

  if (password.length < 12)
    feedback.push('Minimum 12 characters required.');

  if (result.score < 4)
    feedback.push(
      'Password is too predictable. Avoid words, phrases, keyboard patterns, and substitutions like @ for a.',
    );

  const hasWeakMatch = result.sequence.some(m =>
    ['dictionary', 'spatial', 'repeat'].includes(m.pattern),
  );
  if (hasWeakMatch)
    feedback.push('Password contains a recognizable word, pattern, or repeated sequence.');

  const charClasses = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];
  const classCount = charClasses.filter(rx => rx.test(password)).length;
  if (classCount < 3)
    feedback.push('Use at least 3 character types: uppercase, lowercase, numbers, symbols.');

  const breached = await isBreachedPassword(password);
  if (breached)
    feedback.push('This password has appeared in a known data breach. Choose a different password.');

  return {
    valid: feedback.length === 0,
    score: result.score,
    crackTimeSec: result.crackTimesSeconds.offlineFastHashing1e10PerSecond,
    feedback,
    breached,
  };
}
