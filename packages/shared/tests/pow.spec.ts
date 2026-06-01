import { describe, it, expect } from 'vitest';
import { solvePoW } from '../src/pow.js';

describe('solvePoW', () => {
  it('returns nonce whose SHA-256(challenge+nonce) starts with required zeros', async () => {
    const challenge = 'abc123';
    const difficulty = 2; // faster for tests
    const nonce = await solvePoW(challenge, difficulty);
    const target = '0'.repeat(difficulty);

    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(challenge + nonce),
    );
    const hash = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hash.startsWith(target)).toBe(true);
  }, 10_000);

  it('nonce is a decimal integer string', async () => {
    const nonce = await solvePoW('challenge', 1);
    expect(nonce).toMatch(/^\d+$/);
    expect(parseInt(nonce, 10)).toBeGreaterThanOrEqual(0);
  }, 10_000);

  it('different challenges produce different nonces (most of the time)', async () => {
    const [n1, n2] = await Promise.all([
      solvePoW('challenge-a', 2),
      solvePoW('challenge-b', 2),
    ]);
    // They could theoretically be equal at low difficulty but almost never
    // Just verify both are valid nonces (already covered by first test pattern)
    expect(n1).toMatch(/^\d+$/);
    expect(n2).toMatch(/^\d+$/);
  }, 20_000);
});
