// hash-wasm provides argon2id in both browser and Node.js via bundled WASM.
// The spec names argon2-browser, but hash-wasm produces identical Argon2id output
// with the same parameters and works in Vitest/Node without path-resolution issues.
import { argon2id as hashWasmArgon2id } from 'hash-wasm';
import type { PasswordOptions } from './types.js';

export interface EncryptedBlob {
  ciphertext: string; // base64url-encoded (variable length)
  iv: string;         // base64url-encoded, 12 bytes
  authTag: string;    // base64url-encoded, 16 bytes
}

// --- Base64url helpers (no native API dependency) ---

export function toBase64url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function fromBase64url(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padding);
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Convert hex string (e.g. User.kdfSalt) to Uint8Array
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// --- Key derivation ---

// Returns raw 32-byte key material (for use in a Web Worker before importKey on main thread).
export async function deriveRawKey(
  masterPassword: string,
  salt: Uint8Array,
): Promise<ArrayBuffer> {
  const hashBytes = await hashWasmArgon2id({
    password: masterPassword,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,  // 64 MiB — load-bearing, do not lower
    hashLength: 32,
    outputType: 'binary',
  });
  // Explicitly copy into a plain ArrayBuffer (hash-wasm may return SharedArrayBuffer variant)
  const buf = new ArrayBuffer(32);
  new Uint8Array(buf).set(hashBytes);
  return buf;
}

// Derives and imports a non-extractable AES-256-GCM CryptoKey.
// In the web app this should run inside a Web Worker to avoid blocking the UI thread.
export async function deriveEncryptionKey(
  masterPassword: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const rawKey = await deriveRawKey(masterPassword, salt);
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,              // non-extractable — enforced by Web Crypto API
    ['encrypt', 'decrypt'],
  );
}

// --- Encryption / Decryption ---
//
// AAD (additionalData) binds ciphertext to a specific entry: `${userId}:${entryId}`.
// A ciphertext moved to a different entry will fail decryption with a DOMException
// (authentication tag mismatch). AAD is a required parameter — no silent omissions.

export async function encryptSecret(
  key: CryptoKey,
  plaintext: string,
  aad: string,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  // AES-GCM output = ciphertext || authTag (last 16 bytes appended by Web Crypto)
  const data = new Uint8Array(encrypted);
  return {
    ciphertext: toBase64url(data.slice(0, -16)),
    iv:         toBase64url(iv),
    authTag:    toBase64url(data.slice(-16)),
  };
}

export async function decryptSecret(
  key: CryptoKey,
  blob: EncryptedBlob,
  aad: string,
): Promise<string> {
  const cipherBytes = fromBase64url(blob.ciphertext);
  const tagBytes    = fromBase64url(blob.authTag);
  // Reassemble the AES-GCM wire format: ciphertext || authTag
  const combined = new Uint8Array(new ArrayBuffer(cipherBytes.length + tagBytes.length));
  combined.set(cipherBytes, 0);
  combined.set(tagBytes, cipherBytes.length);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64url(blob.iv), additionalData: new TextEncoder().encode(aad) },
    key,
    combined,
  );
  return new TextDecoder().decode(decrypted);
}

// --- Utilities ---

export async function hashLabel(label: string): Promise<string> {
  const encoded = new TextEncoder().encode(label.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Exported so entropy displays compute from the SAME pool the generator draws from
// (pool size changes with selected classes and excludeAmbiguous — approximating lies).
export function buildPasswordPool(options: PasswordOptions): string {
  const charsets: Record<string, string> = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers:   '0123456789',
    symbols:   '!@#$%^&*()_+-=[]{}|;:,.?',
  };
  const ambiguous = /[O0Il1]/g;
  let pool = Object.entries(charsets)
    .filter(([k]) => options[k as keyof PasswordOptions] === true)
    .map(([, v]) => v)
    .join('');
  if (options.excludeAmbiguous) pool = pool.replace(ambiguous, '');
  return pool;
}

export function generatePassword(options: PasswordOptions): string {
  const pool = buildPasswordPool(options);
  if (pool.length === 0) throw new Error('No character classes selected');

  const bytes = crypto.getRandomValues(new Uint8Array(options.length * 4));
  let result = '';
  // Rejection sampling: eliminates modulo bias when pool.length doesn't divide 256 evenly.
  const maxUnbiased = Math.floor(256 / pool.length) * pool.length;
  for (const byte of bytes) {
    if (result.length >= options.length) break;
    if (byte < maxUnbiased) result += pool[byte % pool.length];
  }
  // Extremely unlikely to exhaust the buffer, but handle gracefully.
  while (result.length < options.length) {
    const extra = crypto.getRandomValues(new Uint8Array(16));
    for (const b of extra) {
      if (result.length >= options.length) break;
      if (b < maxUnbiased) result += pool[b % pool.length];
    }
  }
  return result;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
  });
}
