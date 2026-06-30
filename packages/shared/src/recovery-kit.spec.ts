import { describe, it, expect } from 'vitest';
import {
  generateRecoveryMnemonic,
  validateRecoveryMnemonic,
  wrapVaultKeyForRecovery,
  unwrapVaultKeyFromRecovery,
  deriveRecoveryKey,
} from './recovery-kit.js';

function randomVaultKey(): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

describe('generateRecoveryMnemonic', () => {
  it('produces a 24-word mnemonic', () => {
    const mnemonic = generateRecoveryMnemonic();
    expect(mnemonic.split(' ')).toHaveLength(24);
  });

  it('validates as a correct BIP39 mnemonic', () => {
    const mnemonic = generateRecoveryMnemonic();
    expect(validateRecoveryMnemonic(mnemonic)).toBe(true);
  });

  it('produces different mnemonics on each call (uniqueness)', () => {
    const a = generateRecoveryMnemonic();
    const b = generateRecoveryMnemonic();
    expect(a).not.toBe(b);
  });
});

describe('validateRecoveryMnemonic', () => {
  it('returns false for garbage input', () => {
    expect(validateRecoveryMnemonic('this is definitely not a valid bip39 mnemonic string')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateRecoveryMnemonic('')).toBe(false);
  });
});

describe('wrapVaultKeyForRecovery / unwrapVaultKeyFromRecovery', () => {
  it('round-trip: wrap then unwrap returns original bytes', async () => {
    const rawKey = randomVaultKey();
    const payload = await wrapVaultKeyForRecovery(rawKey);

    const recovered = await unwrapVaultKeyFromRecovery(
      payload.mnemonic,
      payload.recoverySalt,
      payload.recoveryWrappedVaultKey,
      payload.wrapIv,
    );

    expect(recovered).toEqual(rawKey);
  });

  it('wrong mnemonic (different valid mnemonic): unwrap throws', async () => {
    const rawKey = randomVaultKey();
    const payload = await wrapVaultKeyForRecovery(rawKey);
    const wrongMnemonic = generateRecoveryMnemonic();

    await expect(
      unwrapVaultKeyFromRecovery(
        wrongMnemonic,
        payload.recoverySalt,
        payload.recoveryWrappedVaultKey,
        payload.wrapIv,
      ),
    ).rejects.toThrow();
  });

  it('tampered ciphertext: unwrap throws', async () => {
    const rawKey = randomVaultKey();
    const payload = await wrapVaultKeyForRecovery(rawKey);

    const wrappedBytes = fromBase64(payload.recoveryWrappedVaultKey);
    wrappedBytes[0] = wrappedBytes[0]! ^ 0xff;
    const tamperedWrapped = toBase64(wrappedBytes);

    await expect(
      unwrapVaultKeyFromRecovery(
        payload.mnemonic,
        payload.recoverySalt,
        tamperedWrapped,
        payload.wrapIv,
      ),
    ).rejects.toThrow();
  });

  it('tampered IV: unwrap throws', async () => {
    const rawKey = randomVaultKey();
    const payload = await wrapVaultKeyForRecovery(rawKey);

    const ivBytes = fromBase64(payload.wrapIv);
    ivBytes[0] = ivBytes[0]! ^ 0xff;
    const tamperedIv = toBase64(ivBytes);

    await expect(
      unwrapVaultKeyFromRecovery(
        payload.mnemonic,
        payload.recoverySalt,
        payload.recoveryWrappedVaultKey,
        tamperedIv,
      ),
    ).rejects.toThrow();
  });

  it('invalid mnemonic passed to unwrap throws', async () => {
    const rawKey = randomVaultKey();
    const payload = await wrapVaultKeyForRecovery(rawKey);

    await expect(
      unwrapVaultKeyFromRecovery(
        'not a valid mnemonic at all',
        payload.recoverySalt,
        payload.recoveryWrappedVaultKey,
        payload.wrapIv,
      ),
    ).rejects.toThrow('Invalid recovery mnemonic');
  });

  it('AAD-mismatch rejection: decrypt with wrong additionalData throws', async () => {
    const rawKey = randomVaultKey();
    const payload = await wrapVaultKeyForRecovery(rawKey);

    const saltBytes = fromBase64(payload.recoverySalt) as Uint8Array<ArrayBuffer>;
    const wrappedBytes = fromBase64(payload.recoveryWrappedVaultKey);
    const ivBytes = fromBase64(payload.wrapIv);

    const recoveryKey = await deriveRecoveryKey(payload.mnemonic, saltBytes);

    await expect(
      globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ivBytes,
          additionalData: new TextEncoder().encode('adyton-recovery-v2'),
          tagLength: 128,
        },
        recoveryKey,
        wrappedBytes,
      ),
    ).rejects.toThrow();
  });
});
