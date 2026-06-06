import { describe, it, expect } from 'vitest';
import { base32Decode, generateTotp, totpRemainingSeconds } from './totp.js';

describe('base32Decode', () => {
  it('decodes a known RFC 4648 vector', () => {
    // 'JBSWY3DPEHPK3PXP' is the base32 of bytes 48 65 6C 6C 6F 21 DE AD BE EF.
    const expected = Uint8Array.from([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef,
    ]);
    expect(base32Decode('JBSWY3DPEHPK3PXP')).toEqual(expected);
  });

  it('tolerates lowercase input', () => {
    expect(base32Decode('jbswy3dpehpk3pxp')).toEqual(
      base32Decode('JBSWY3DPEHPK3PXP'),
    );
  });

  it('tolerates embedded whitespace', () => {
    expect(base32Decode('JBSW Y3DP\tEHPK\n3PXP')).toEqual(
      base32Decode('JBSWY3DPEHPK3PXP'),
    );
  });

  it('strips trailing = padding', () => {
    // 'MZXW6===' is base32 of ASCII 'foo'.
    expect(base32Decode('MZXW6===')).toEqual(
      Uint8Array.from([0x66, 0x6f, 0x6f]),
    );
  });

  it('returns empty array for empty/whitespace-only input', () => {
    expect(base32Decode('   ')).toEqual(new Uint8Array(0));
  });

  it('throws on invalid base32 characters', () => {
    // '1', '8', '9', '0' are not in the RFC 4648 base32 alphabet.
    expect(() => base32Decode('ABC1')).toThrow(/invalid base32/i);
    expect(() => base32Decode('!!!!')).toThrow(/invalid base32/i);
  });
});

describe('generateTotp', () => {
  // RFC 6238 Appendix B, SHA-1 vectors. The RFC secret is the ASCII string
  // "12345678901234567890" (20 bytes); its base32 is the following.
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('matches RFC 6238 8-digit vector at T=59s', async () => {
    expect(
      await generateTotp(SECRET, { digits: 8, timestamp: 59_000 }),
    ).toBe('94287082');
  });

  it('matches RFC 6238 8-digit vector at T=1111111109s', async () => {
    expect(
      await generateTotp(SECRET, { digits: 8, timestamp: 1_111_111_109_000 }),
    ).toBe('07081804');
  });

  it('matches RFC 6238 8-digit vector at T=1111111111s', async () => {
    expect(
      await generateTotp(SECRET, { digits: 8, timestamp: 1_111_111_111_000 }),
    ).toBe('14050471');
  });

  it('defaults to 6 digits (last 6 of the 8-digit value)', async () => {
    // T=59 → 8-digit 94287082 → 6-digit 287082.
    expect(await generateTotp(SECRET, { timestamp: 59_000 })).toBe('287082');
  });

  it('defaults period to 30s (T=29 and T=0 share the first window)', async () => {
    const atZero = await generateTotp(SECRET, { timestamp: 0 });
    const at29 = await generateTotp(SECRET, { timestamp: 29_000 });
    expect(at29).toBe(atZero);
  });

  it('is deterministic for the same secret and timestamp', async () => {
    const a = await generateTotp(SECRET, { digits: 8, timestamp: 1_234_567_890_000 });
    const b = await generateTotp(SECRET, { digits: 8, timestamp: 1_234_567_890_000 });
    expect(a).toBe(b);
  });

  it('defaults the timestamp to Date.now() when omitted', async () => {
    const code = await generateTotp(SECRET);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('zero-pads short codes to the requested digit count', async () => {
    const code = await generateTotp(SECRET, { digits: 8, timestamp: 1_111_111_109_000 });
    expect(code).toHaveLength(8);
    expect(code).toBe('07081804');
  });
});

describe('totpRemainingSeconds', () => {
  it('returns the full period when epoch seconds align to the window start', () => {
    // 30_000 ms → 30 s → 30 % 30 === 0 → 30 - 0 = 30.
    expect(totpRemainingSeconds(30, 30_000)).toBe(30);
  });

  it('returns period-1 one second into the window', () => {
    expect(totpRemainingSeconds(30, 31_000)).toBe(29);
  });

  it('honors a custom period', () => {
    expect(totpRemainingSeconds(60, 5_000)).toBe(55);
  });

  it('defaults period to 30 and timestamp to Date.now() when omitted', () => {
    const remaining = totpRemainingSeconds();
    expect(remaining).toBeGreaterThanOrEqual(1);
    expect(remaining).toBeLessThanOrEqual(30);
  });
});
