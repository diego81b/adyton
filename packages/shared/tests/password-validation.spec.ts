import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateMasterPassword,
  isBreachedPassword,
} from '../src/password-validation.js';

// Helper: build a fake HIBP API response
function buildHibpResponse(suffix: string, count: number): string {
  // HIBP returns lines like: <SUFFIX>:<count>
  return `${suffix}:${count}\nDEADBEEFDEADBEEFDEAD:1`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isBreachedPassword', () => {
  it('returns true when SHA-1 suffix is in HIBP response', async () => {
    // Hash of 'password' starts with 5BAA6 (SHA-1 prefix)
    const sha1OfPassword = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
    const prefix = sha1OfPassword.slice(0, 5);
    const suffix = sha1OfPassword.slice(5);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(buildHibpResponse(suffix, 1000)),
    }));

    const result = await isBreachedPassword('password');
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`https://api.pwnedpasswords.com/range/${prefix}`);
  });

  it('returns false when SHA-1 suffix not in HIBP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve('AAAAA:1\nBBBBB:2'),
    }));
    const result = await isBreachedPassword('correct-horse-battery-staple');
    expect(result).toBe(false);
  });
});

describe('validateMasterPassword', () => {
  // Mock HIBP to return "not breached" by default
  function mockHibpNotBreached() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve('AAAAA:1'), // suffix won't match
    }));
  }

  it('accepts a strong, unique password (score 4)', async () => {
    mockHibpNotBreached();
    // A high-entropy password with mixed classes
    const pw = 'Xk9!mP2$vQ8&nR4#wL7@';
    const result = await validateMasterPassword(pw);
    expect(result.score).toBe(4);
    expect(result.valid).toBe(true);
    expect(result.feedback).toHaveLength(0);
    expect(result.breached).toBe(false);
  });

  it('rejects password shorter than 12 chars', async () => {
    mockHibpNotBreached();
    const result = await validateMasterPassword('Short1!');
    expect(result.valid).toBe(false);
    expect(result.feedback.some(f => f.includes('12 characters'))).toBe(true);
  });

  it('rejects dictionary word password regardless of length', async () => {
    mockHibpNotBreached();
    // A long but weak password
    const result = await validateMasterPassword('passwordpassword');
    expect(result.valid).toBe(false);
    // Either score < 4 or sequence match
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it('rejects when fewer than 3 character classes', async () => {
    mockHibpNotBreached();
    // All lowercase, no uppercase/numbers/symbols
    const result = await validateMasterPassword('abcdefghijklmnopqrstuvwxyz');
    expect(result.valid).toBe(false);
    expect(result.feedback.some(f => f.includes('3 character types'))).toBe(true);
  });

  it('rejects breached password', async () => {
    // Fake a breach hit
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: async () => {
        // We need the SHA-1 suffix of the test password
        const pw = 'Xk9!mP2$vQ8&nR4#';
        const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pw));
        const hex = Array.from(new Uint8Array(buf))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
        const suffix = hex.slice(5);
        return `${suffix}:999`;
      },
    }));
    const result = await validateMasterPassword('Xk9!mP2$vQ8&nR4#');
    if (!result.valid) {
      expect(result.feedback.some(f => f.includes('data breach'))).toBe(true);
    }
    // Note: may still be invalid for other reasons; just verify breach is detected
    expect(result.breached).toBe(true);
  });

  it('populates crackTimeSec as a number', async () => {
    mockHibpNotBreached();
    const result = await validateMasterPassword('Test1234');
    expect(typeof result.crackTimeSec).toBe('number');
    expect(result.crackTimeSec).toBeGreaterThanOrEqual(0);
  });

  it('populates score in range 0-4', async () => {
    mockHibpNotBreached();
    const result = await validateMasterPassword('abc');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(4);
  });
});
