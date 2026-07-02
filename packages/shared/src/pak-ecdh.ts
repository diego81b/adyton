// PAK (Phone-as-Key) ECDH shared crypto contract.
// All wire constants are mirrored exactly in the Kotlin mobile companion.
// Uses standard base64 (btoa/atob) throughout — NOT base64url — to match Kotlin's Base64.DEFAULT.

export const PAK_PROTOCOL = {
  ecdh: { name: 'ECDH', namedCurve: 'P-256' },
  hkdf: { name: 'HKDF', hash: 'SHA-256', info: new TextEncoder().encode('adyton-qr-v1') },
  sessionKeyLength: 32,
  aesgcm: { name: 'AES-GCM' },
  ivLength: 12,
  tagBits: 128,
  challengeLength: 32,
  sessionTtlSeconds: 60,
  enrollmentAad: 'enrollment',
  hkdfInfo: 'adyton-qr-v1', // string form for reference / docs
} as const;

// Helper: Uint8Array → standard base64 string
function toStdBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

// Helper: standard base64 string → Uint8Array<ArrayBuffer>
function fromStdBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Generate an ephemeral P-256 ECDH keypair.
 * extractable: true — these are ephemeral keys discarded immediately after use;
 * the vault key (CryptoKey) derived from the session key remains non-extractable.
 */
export async function generateEphemeralKeypair(): Promise<CryptoKeyPair> {
  return globalThis.crypto.subtle.generateKey(
    PAK_PROTOCOL.ecdh,
    true, // extractable — ephemeral, discarded after QR handshake
    ['deriveKey', 'deriveBits'],
  );
}

/**
 * Export a P-256 public key as standard base64-encoded SPKI.
 * Kotlin companion imports this with Base64.decode(..., Base64.DEFAULT).
 */
export async function exportPublicKeySpki(key: CryptoKey): Promise<string> {
  const exported = await globalThis.crypto.subtle.exportKey('spki', key);
  return toStdBase64(new Uint8Array(exported));
}

/**
 * Import a P-256 public key from standard base64-encoded SPKI.
 * usages: [] — public keys are not used for deriveKey/deriveBits directly;
 * only the private key is passed to deriveBits in deriveQrSessionKey.
 */
export async function importPublicKeySpki(spkiBase64: string): Promise<CryptoKey> {
  const spkiBytes = fromStdBase64(spkiBase64);
  return globalThis.crypto.subtle.importKey(
    'spki',
    spkiBytes,
    PAK_PROTOCOL.ecdh,
    true, // extractable — public keys may be re-exported for logging/verification
    [],   // no usages on the imported public key itself
  );
}

/**
 * Derive the shared QR session key via ECDH + HKDF.
 *
 * Steps:
 *   1. ECDH deriveBits(ownPrivate, remotePublic) → 32-byte shared secret
 *   2. Import shared secret as HKDF key material
 *   3. HKDF-SHA-256 with salt=challengeBytes, info="adyton-qr-v1" → 256-bit AES-GCM key
 *
 * The challenge bytes (32 CSPRNG bytes, transmitted in the QR payload) act as HKDF salt,
 * binding the derived key to a specific QR session.
 * Returns a non-extractable AES-GCM key.
 */
export async function deriveQrSessionKey(
  ownPrivate: CryptoKey,
  remotePublic: CryptoKey,
  challengeBytes: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  // Step 1: raw ECDH shared bits
  const sharedBits = await globalThis.crypto.subtle.deriveBits(
    { name: 'ECDH', public: remotePublic },
    ownPrivate,
    256,
  );

  // Step 2: import shared bits as HKDF key material
  const hkdfKey = await globalThis.crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );

  // Step 3: HKDF → AES-GCM session key
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: PAK_PROTOCOL.hkdf.hash,
      salt: challengeBytes,
      info: PAK_PROTOCOL.hkdf.info,
    },
    hkdfKey,
    { name: 'AES-GCM', length: PAK_PROTOCOL.sessionKeyLength * 8 },
    false, // non-extractable — session key must not leave the JS heap
    ['encrypt', 'decrypt'],
  );
}

/**
 * Compute the SHA-256 fingerprint (lowercase hex) of a base64-encoded SPKI public key.
 * Mirrors the server-side computation in apps/api/src/pak/pak.service.ts (enrollDevice) —
 * lets a client resolve its own server-assigned device row (via GET /pak/devices) without
 * ever persisting the server's row ID locally.
 */
export async function computeDevicePublicKeyFingerprint(spkiBase64: string): Promise<string> {
  const spkiBytes = fromStdBase64(spkiBase64);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', spkiBytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Encrypt plaintext for transport using the QR session key.
 *
 * Uses AES-256-GCM with a random 12-byte IV.
 * AAD binds the ciphertext to its semantic context (e.g. "enrollment").
 * WebCrypto appends the 16-byte auth tag to the ciphertext output automatically.
 *
 * Returns standard base64 strings for cross-platform compatibility with Kotlin.
 */
export async function encryptForTransport(
  sessionKey: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  aad: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(PAK_PROTOCOL.ivLength));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(aad),
      tagLength: PAK_PROTOCOL.tagBits,
    },
    sessionKey,
    plaintext,
  );
  return {
    ciphertext: toStdBase64(new Uint8Array(encrypted)),
    iv: toStdBase64(iv),
  };
}

/**
 * Decrypt transport payload using the QR session key.
 *
 * Throws a DOMException (OperationError) on auth tag mismatch — do not catch here.
 * The caller is responsible for surfacing auth failures as session termination.
 */
export async function decryptFromTransport(
  sessionKey: CryptoKey,
  ciphertext: string,
  iv: string,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const ciphertextBytes = fromStdBase64(ciphertext);
  const ivBytes = fromStdBase64(iv);
  const decrypted = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: new TextEncoder().encode(aad),
      tagLength: PAK_PROTOCOL.tagBits,
    },
    sessionKey,
    ciphertextBytes,
  );
  return new Uint8Array(decrypted);
}
