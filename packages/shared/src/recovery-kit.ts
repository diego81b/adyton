// PAK recovery kit crypto — BIP39 mnemonic → HKDF → AES-GCM vault-key wrap.
// Uses Web Crypto API (crypto.subtle) throughout, consistent with pak-ecdh.ts.
// The mnemonic is NEVER stored — it is returned once from wrapVaultKeyForRecovery
// and must be written down by the user (it is the recovery secret).

import { generateMnemonic, validateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const RECOVERY_INFO = 'adyton-recovery-v1';
const RECOVERY_INFO_BYTES = new TextEncoder().encode(RECOVERY_INFO);
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export interface RecoveryKitServerPayload {
  recoverySalt: string;            // base64 of 32-byte random salt
  recoveryWrappedVaultKey: string; // base64 of AES-GCM output (ciphertext || 16-byte authTag = 48 bytes)
  wrapIv: string;                  // base64 of 12-byte IV
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateRecoveryMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

export function validateRecoveryMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

export async function deriveRecoveryKey(
  mnemonic: string,
  saltBytes: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const seed = await mnemonicToSeed(mnemonic, '');

  const hkdfMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    seed,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: RECOVERY_INFO_BYTES,
    },
    hkdfMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapVaultKeyForRecovery(
  rawVaultKey: Uint8Array<ArrayBuffer>,
): Promise<RecoveryKitServerPayload & { mnemonic: string }> {
  const mnemonic = generateRecoveryMnemonic();
  const saltBytes = globalThis.crypto.getRandomValues(
    new Uint8Array(SALT_LENGTH),
  ) as Uint8Array<ArrayBuffer>;
  const iv = globalThis.crypto.getRandomValues(
    new Uint8Array(IV_LENGTH),
  ) as Uint8Array<ArrayBuffer>;

  const recoveryKey = await deriveRecoveryKey(mnemonic, saltBytes);

  const wrapped = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: RECOVERY_INFO_BYTES,
      tagLength: 128,
    },
    recoveryKey,
    rawVaultKey,
  );

  return {
    mnemonic,
    recoverySalt: toBase64(saltBytes),
    recoveryWrappedVaultKey: toBase64(new Uint8Array(wrapped)),
    wrapIv: toBase64(iv),
  };
}

export async function unwrapVaultKeyFromRecovery(
  mnemonic: string,
  recoverySalt: string,
  recoveryWrappedVaultKey: string,
  wrapIv: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!validateRecoveryMnemonic(mnemonic)) {
    throw new Error('Invalid recovery mnemonic');
  }

  const saltBytes = fromBase64(recoverySalt) as Uint8Array<ArrayBuffer>;
  const wrappedBytes = fromBase64(recoveryWrappedVaultKey);
  const ivBytes = fromBase64(wrapIv);

  const recoveryKey = await deriveRecoveryKey(mnemonic, saltBytes);

  const decrypted = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: RECOVERY_INFO_BYTES,
      tagLength: 128,
    },
    recoveryKey,
    wrappedBytes,
  );

  return new Uint8Array(decrypted) as Uint8Array<ArrayBuffer>;
}
