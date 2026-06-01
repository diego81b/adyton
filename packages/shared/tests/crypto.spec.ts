import { describe, it, expect } from 'vitest';
import {
  deriveEncryptionKey,
  deriveRawKey,
  encryptSecret,
  decryptSecret,
  hashLabel,
  generatePassword,
  generateRecoveryCodes,
  toBase64url,
  fromBase64url,
  hexToBytes,
} from '../src/crypto.js';
import type { PasswordOptions } from '../src/types.js';

// Spike: verify argon2-browser loads + produces correct output in Node/Vitest
describe('deriveRawKey (Argon2id)', () => {
  it('produces 32-byte key from known inputs', async () => {
    const password = 'test-password';
    const salt = new Uint8Array(32).fill(1);
    const raw = await deriveRawKey(password, salt);
    expect(raw.byteLength).toBe(32);
  }, 10_000);

  it('same inputs → same output (deterministic)', async () => {
    const password = 'deterministic-test';
    const salt = new Uint8Array(32).fill(2);
    const [a, b] = await Promise.all([deriveRawKey(password, salt), deriveRawKey(password, salt)]);
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
  }, 20_000);

  it('different salts → different output', async () => {
    const password = 'same-password';
    const salt1 = new Uint8Array(32).fill(1);
    const salt2 = new Uint8Array(32).fill(2);
    const [a, b] = await Promise.all([deriveRawKey(password, salt1), deriveRawKey(password, salt2)]);
    expect(new Uint8Array(a)).not.toEqual(new Uint8Array(b));
  }, 20_000);
});

describe('deriveEncryptionKey', () => {
  it('returns non-extractable CryptoKey', async () => {
    const salt = new Uint8Array(32).fill(3);
    const key = await deriveEncryptionKey('my-master-pw', salt);
    expect(key.type).toBe('secret');
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  }, 10_000);
});

describe('encryptSecret / decryptSecret round-trip', () => {
  it('encrypts and decrypts correctly with AAD', async () => {
    const salt = new Uint8Array(32).fill(5);
    const key = await deriveEncryptionKey('pw', salt);
    const plaintext = 'Hello, vault!';
    const aad = 'user123:entry456';

    const blob = await encryptSecret(key, plaintext, aad);

    // Verify split-tag format
    expect(blob.iv.length).toBeGreaterThan(0);
    expect(fromBase64url(blob.iv).byteLength).toBe(12);
    expect(fromBase64url(blob.authTag).byteLength).toBe(16);
    expect(fromBase64url(blob.ciphertext).byteLength).toBeGreaterThan(0);

    const recovered = await decryptSecret(key, blob, aad);
    expect(recovered).toBe(plaintext);
  }, 10_000);

  it('rejects with wrong AAD (ciphertext transplant detection)', async () => {
    const salt = new Uint8Array(32).fill(6);
    const key = await deriveEncryptionKey('pw2', salt);
    const blob = await encryptSecret(key, 'secret', 'user1:entry1');
    await expect(decryptSecret(key, blob, 'user1:entry2')).rejects.toThrow();
  }, 10_000);

  it('rejects with wrong key', async () => {
    const salt1 = new Uint8Array(32).fill(7);
    const salt2 = new Uint8Array(32).fill(8);
    const key1 = await deriveEncryptionKey('pw', salt1);
    const key2 = await deriveEncryptionKey('pw', salt2);
    const blob = await encryptSecret(key1, 'data', 'u:e');
    await expect(decryptSecret(key2, blob, 'u:e')).rejects.toThrow();
  }, 10_000);
});

describe('hashLabel', () => {
  it('returns 64-char hex string', async () => {
    const h = await hashLabel('GitHub');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('case-insensitive and trimmed', async () => {
    const a = await hashLabel('GitHub');
    const b = await hashLabel('  github  ');
    expect(a).toBe(b);
  });

  it('different labels → different hashes', async () => {
    const a = await hashLabel('GitHub');
    const b = await hashLabel('GitLab');
    expect(a).not.toBe(b);
  });
});

describe('generatePassword', () => {
  const base: PasswordOptions = {
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: false,
    excludeAmbiguous: false,
  };

  it('returns password of correct length', () => {
    const p = generatePassword(base);
    expect(p).toHaveLength(20);
  });

  it('excludes ambiguous chars when requested', () => {
    const p = generatePassword({ ...base, excludeAmbiguous: true });
    expect(p).not.toMatch(/[O0Il1]/);
  });

  it('throws when no charset selected', () => {
    expect(() =>
      generatePassword({ ...base, uppercase: false, lowercase: false, numbers: false }),
    ).toThrow();
  });

  it('includes symbol chars when enabled', () => {
    const results = Array.from({ length: 50 }, () =>
      generatePassword({ ...base, symbols: true, length: 30 }),
    );
    // At least one result should contain a symbol
    const symbolRx = /[!@#$%^&*()_+\-=[\]{}|;:,.?]/;
    expect(results.some(r => symbolRx.test(r))).toBe(true);
  });
});

describe('generateRecoveryCodes', () => {
  it('returns 8 codes by default', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
  });

  it('each code matches xxxxx-xxxxx-xxxxx-xxxxx format', () => {
    const codes = generateRecoveryCodes();
    const pattern = /^[0-9a-f]{5}-[0-9a-f]{5}-[0-9a-f]{5}-[0-9a-f]{5}$/;
    for (const code of codes) expect(code).toMatch(pattern);
  });

  it('all codes are unique', () => {
    const codes = generateRecoveryCodes(16);
    expect(new Set(codes).size).toBe(16);
  });
});

describe('base64url helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const encoded = toBase64url(bytes);
    expect(fromBase64url(encoded)).toEqual(bytes);
  });

  it('no padding chars in output', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(toBase64url(bytes)).not.toContain('=');
  });

  it('uses URL-safe alphabet', () => {
    const encoded = toBase64url(new Uint8Array(100).fill(255));
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });
});

describe('hexToBytes', () => {
  it('converts hex kdfSalt to Uint8Array', () => {
    const hex = 'deadbeef'.repeat(8); // 64 chars = 32 bytes
    const bytes = hexToBytes(hex);
    expect(bytes.byteLength).toBe(32);
    expect(bytes[0]).toBe(0xde);
    expect(bytes[1]).toBe(0xad);
  });
});
