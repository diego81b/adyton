import { describe, it, expect } from 'vitest';
import {
  generateEphemeralKeypair,
  exportPublicKeySpki,
  importPublicKeySpki,
  deriveQrSessionKey,
  encryptForTransport,
  decryptFromTransport,
  PAK_PROTOCOL,
} from './pak-ecdh.js';

describe('PAK_PROTOCOL constants', () => {
  it('has the correct curve, hash, and sizes', () => {
    expect(PAK_PROTOCOL.ecdh.namedCurve).toBe('P-256');
    expect(PAK_PROTOCOL.hkdf.hash).toBe('SHA-256');
    expect(PAK_PROTOCOL.hkdfInfo).toBe('adyton-qr-v1');
    expect(PAK_PROTOCOL.sessionKeyLength).toBe(32);
    expect(PAK_PROTOCOL.ivLength).toBe(12);
    expect(PAK_PROTOCOL.tagBits).toBe(128);
    expect(PAK_PROTOCOL.challengeLength).toBe(32);
    expect(PAK_PROTOCOL.sessionTtlSeconds).toBe(60);
  });

  it('hkdf.info encodes the correct ASCII string', () => {
    const decoded = new TextDecoder().decode(PAK_PROTOCOL.hkdf.info);
    expect(decoded).toBe('adyton-qr-v1');
  });
});

describe('generateEphemeralKeypair', () => {
  it('produces a P-256 CryptoKeyPair with correct usages', async () => {
    const pair = await generateEphemeralKeypair();

    expect(pair.privateKey.type).toBe('private');
    expect(pair.publicKey.type).toBe('public');

    // Both keys must be extractable (ephemeral — discarded after QR handshake)
    expect(pair.privateKey.extractable).toBe(true);
    expect(pair.publicKey.extractable).toBe(true);

    // Private key must support deriveKey and deriveBits
    expect(pair.privateKey.usages).toContain('deriveKey');
    expect(pair.privateKey.usages).toContain('deriveBits');

    // Algorithm should be P-256
    expect((pair.privateKey.algorithm as EcKeyAlgorithm).namedCurve).toBe('P-256');
    expect((pair.publicKey.algorithm as EcKeyAlgorithm).namedCurve).toBe('P-256');
  });

  it('produces distinct keypairs on each call', async () => {
    const [pairA, pairB] = await Promise.all([
      generateEphemeralKeypair(),
      generateEphemeralKeypair(),
    ]);
    const spkiA = await exportPublicKeySpki(pairA.publicKey);
    const spkiB = await exportPublicKeySpki(pairB.publicKey);
    expect(spkiA).not.toBe(spkiB);
  });
});

describe('exportPublicKeySpki / importPublicKeySpki', () => {
  it('round-trips a public key: export → import → re-export produces identical bytes', async () => {
    const pair = await generateEphemeralKeypair();

    const spki1 = await exportPublicKeySpki(pair.publicKey);
    const reimported = await importPublicKeySpki(spki1);
    const spki2 = await exportPublicKeySpki(reimported);

    expect(spki1).toBe(spki2);
  });

  it('exported value is valid standard base64 (not base64url)', async () => {
    const pair = await generateEphemeralKeypair();
    const spki = await exportPublicKeySpki(pair.publicKey);

    // Standard base64 may contain + and / and = padding; base64url uses - and _ instead
    // A P-256 SPKI is long enough that + or / almost always appears, but we verify the
    // string decodes cleanly via atob (which rejects base64url characters).
    expect(() => atob(spki)).not.toThrow();

    // Must not contain base64url-specific characters
    expect(spki).not.toMatch(/[-_]/);
  });

  it('imported public key has correct algorithm and type', async () => {
    const pair = await generateEphemeralKeypair();
    const spki = await exportPublicKeySpki(pair.publicKey);
    const imported = await importPublicKeySpki(spki);

    expect(imported.type).toBe('public');
    expect((imported.algorithm as EcKeyAlgorithm).namedCurve).toBe('P-256');
  });
});

describe('deriveQrSessionKey — ECDH shared secret', () => {
  it('both sides derive the same session key (ECDH symmetry)', async () => {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.challengeLength));
    const pairA = await generateEphemeralKeypair();
    const pairB = await generateEphemeralKeypair();

    // Both sides derive a session key using their own private key + the other's public key
    const keyA = await deriveQrSessionKey(pairA.privateKey, pairB.publicKey, challenge);
    const keyB = await deriveQrSessionKey(pairB.privateKey, pairA.publicKey, challenge);

    // Verify symmetry: encrypt with A's key, decrypt successfully with B's key
    const plaintext = new TextEncoder().encode('shared-secret-check');
    const aad = PAK_PROTOCOL.enrollmentAad;

    const { ciphertext, iv } = await encryptForTransport(keyA, plaintext, aad);
    const decrypted = await decryptFromTransport(keyB, ciphertext, iv, aad);

    expect(new TextDecoder().decode(decrypted)).toBe('shared-secret-check');
  });

  it('derived key is non-extractable', async () => {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.challengeLength));
    const pairA = await generateEphemeralKeypair();
    const pairB = await generateEphemeralKeypair();

    const sessionKey = await deriveQrSessionKey(pairA.privateKey, pairB.publicKey, challenge);
    expect(sessionKey.extractable).toBe(false);
  });

  it('derived key has AES-GCM algorithm with 256-bit length', async () => {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.challengeLength));
    const pairA = await generateEphemeralKeypair();
    const pairB = await generateEphemeralKeypair();

    const sessionKey = await deriveQrSessionKey(pairA.privateKey, pairB.publicKey, challenge);
    expect(sessionKey.algorithm.name).toBe('AES-GCM');
    expect((sessionKey.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(sessionKey.usages).toContain('encrypt');
    expect(sessionKey.usages).toContain('decrypt');
  });

  it('different challenges produce different session keys', async () => {
    const challenge1 = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.challengeLength));
    const challenge2 = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.challengeLength));
    const pairA = await generateEphemeralKeypair();
    const pairB = await generateEphemeralKeypair();

    const keyWith1 = await deriveQrSessionKey(pairA.privateKey, pairB.publicKey, challenge1);
    const keyWith2 = await deriveQrSessionKey(pairA.privateKey, pairB.publicKey, challenge2);

    // Encrypt with key1, attempt decrypt with key2 — must fail
    const plaintext = new TextEncoder().encode('test');
    const { ciphertext, iv } = await encryptForTransport(keyWith1, plaintext, PAK_PROTOCOL.enrollmentAad);

    await expect(
      decryptFromTransport(keyWith2, ciphertext, iv, PAK_PROTOCOL.enrollmentAad),
    ).rejects.toThrow();
  });
});

describe('encryptForTransport / decryptFromTransport', () => {
  async function makeSessionKey(): Promise<CryptoKey> {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.challengeLength));
    const pairA = await generateEphemeralKeypair();
    const pairB = await generateEphemeralKeypair();
    return deriveQrSessionKey(pairA.privateKey, pairB.publicKey, challenge);
  }

  it('round-trips arbitrary plaintext', async () => {
    const sessionKey = await makeSessionKey();
    const original = new TextEncoder().encode('hello PAK world 🔑');

    const { ciphertext, iv } = await encryptForTransport(sessionKey, original, 'enrollment');
    const recovered = await decryptFromTransport(sessionKey, ciphertext, iv, 'enrollment');

    expect(recovered).toEqual(original);
  });

  it('round-trips empty plaintext', async () => {
    const sessionKey = await makeSessionKey();
    const empty = new Uint8Array(0);

    const { ciphertext, iv } = await encryptForTransport(sessionKey, empty, 'enrollment');
    const recovered = await decryptFromTransport(sessionKey, ciphertext, iv, 'enrollment');

    expect(recovered).toEqual(empty);
  });

  it('produces a 12-byte IV', async () => {
    const sessionKey = await makeSessionKey();
    const { iv } = await encryptForTransport(sessionKey, new TextEncoder().encode('x'), 'enrollment');

    const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
    expect(ivBytes.length).toBe(PAK_PROTOCOL.ivLength);
  });

  it('ciphertext is longer than plaintext by exactly 16 bytes (auth tag)', async () => {
    const sessionKey = await makeSessionKey();
    const plaintext = new TextEncoder().encode('test data');

    const { ciphertext } = await encryptForTransport(sessionKey, plaintext, 'enrollment');
    const ctBytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));

    expect(ctBytes.length).toBe(plaintext.length + 16);
  });

  it('produces different ciphertexts on each call (random IV)', async () => {
    const sessionKey = await makeSessionKey();
    const plaintext = new TextEncoder().encode('determinism check');

    const enc1 = await encryptForTransport(sessionKey, plaintext, 'enrollment');
    const enc2 = await encryptForTransport(sessionKey, plaintext, 'enrollment');

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('output is valid standard base64 (not base64url)', async () => {
    const sessionKey = await makeSessionKey();
    const { ciphertext, iv } = await encryptForTransport(
      sessionKey,
      new TextEncoder().encode('base64 format check'),
      'enrollment',
    );

    expect(() => atob(ciphertext)).not.toThrow();
    expect(() => atob(iv)).not.toThrow();
    expect(ciphertext).not.toMatch(/[-_]/);
    expect(iv).not.toMatch(/[-_]/);
  });
});

describe('AAD mismatch — security invariant', () => {
  async function makeSessionKey(): Promise<CryptoKey> {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.challengeLength));
    const pairA = await generateEphemeralKeypair();
    const pairB = await generateEphemeralKeypair();
    return deriveQrSessionKey(pairA.privateKey, pairB.publicKey, challenge);
  }

  it('decryptFromTransport throws on wrong AAD', async () => {
    const sessionKey = await makeSessionKey();
    const plaintext = new TextEncoder().encode('sensitive payload');

    const { ciphertext, iv } = await encryptForTransport(sessionKey, plaintext, 'enrollment');

    await expect(
      decryptFromTransport(sessionKey, ciphertext, iv, 'wrong'),
    ).rejects.toThrow();
  });

  it('decryptFromTransport throws when AAD is empty but original was non-empty', async () => {
    const sessionKey = await makeSessionKey();
    const { ciphertext, iv } = await encryptForTransport(
      sessionKey,
      new TextEncoder().encode('data'),
      PAK_PROTOCOL.enrollmentAad,
    );

    await expect(
      decryptFromTransport(sessionKey, ciphertext, iv, ''),
    ).rejects.toThrow();
  });

  it('decryptFromTransport throws when AAD is non-empty but original was empty', async () => {
    const sessionKey = await makeSessionKey();
    const { ciphertext, iv } = await encryptForTransport(
      sessionKey,
      new TextEncoder().encode('data'),
      '',
    );

    await expect(
      decryptFromTransport(sessionKey, ciphertext, iv, PAK_PROTOCOL.enrollmentAad),
    ).rejects.toThrow();
  });

  it('ciphertext tampered by one bit causes decryption to throw', async () => {
    const sessionKey = await makeSessionKey();
    const { ciphertext, iv } = await encryptForTransport(
      sessionKey,
      new TextEncoder().encode('tamper test'),
      'enrollment',
    );

    // Flip the first byte of the ciphertext
    const ctBytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    ctBytes[0] = (ctBytes[0] ?? 0) ^ 0x01;
    const tamperedB64 = btoa(String.fromCharCode(...ctBytes));

    await expect(
      decryptFromTransport(sessionKey, tamperedB64, iv, 'enrollment'),
    ).rejects.toThrow();
  });

  it('ECDH symmetry + correct AAD succeeds; same ciphertext + wrong AAD fails', async () => {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.challengeLength));
    const pairA = await generateEphemeralKeypair();
    const pairB = await generateEphemeralKeypair();
    const keyA = await deriveQrSessionKey(pairA.privateKey, pairB.publicKey, challenge);
    const keyB = await deriveQrSessionKey(pairB.privateKey, pairA.publicKey, challenge);

    const plaintext = new TextEncoder().encode('cross-party AAD check');
    const { ciphertext, iv } = await encryptForTransport(keyA, plaintext, PAK_PROTOCOL.enrollmentAad);

    // Correct AAD — must succeed
    const recovered = await decryptFromTransport(keyB, ciphertext, iv, PAK_PROTOCOL.enrollmentAad);
    expect(new TextDecoder().decode(recovered)).toBe('cross-party AAD check');

    // Wrong AAD on the same ciphertext — must fail
    await expect(
      decryptFromTransport(keyB, ciphertext, iv, 'wrong'),
    ).rejects.toThrow();
  });
});
