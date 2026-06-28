// Type-augmentation shim for qr-crypto functions that will be added to
// packages/shared/src/qr-crypto.ts by Track 1. This file lets the web app
// typecheck clean while the shared package does not yet export these names.
//
// The top-level `export {}` makes this a MODULE (not an ambient script) so
// the `declare module` block is a proper module augmentation that MERGES with
// the real @adyton/shared types rather than replacing them.
//
// DO NOT hand-edit the implementation here — the real logic lives in
// packages/shared. Remove this file once qr-crypto.ts is merged into shared.
export {};

declare module '@adyton/shared' {
  /** ECDH P-256 ephemeral keypair. */
  export interface EphemeralKeypair {
    privateKey: CryptoKey;
    publicKey: CryptoKey;
  }

  /** Encrypted payload returned by encryptForTransport. */
  export interface TransportCiphertext {
    /** Base64-encoded ciphertext. */
    ciphertext: string;
    /** Base64-encoded 12-byte IV. */
    iv: string;
  }

  /**
   * Generate a fresh ECDH P-256 ephemeral keypair for one enrollment or unlock
   * session. The private key is non-extractable.
   */
  export function generateEphemeralKeypair(): Promise<EphemeralKeypair>;

  /**
   * Export a public CryptoKey as a base64-encoded SPKI blob suitable for
   * embedding in the QR payload.
   */
  export function exportPublicKeySpki(key: CryptoKey): Promise<string>;

  /**
   * Import a base64-encoded SPKI blob as an ECDH P-256 public CryptoKey.
   */
  export function importPublicKeySpki(spki: string): Promise<CryptoKey>;

  /**
   * Derive a 256-bit AES-GCM session key from an ECDH private key, the remote
   * party's public key, and the challenge bytes (for binding). Used for both
   * enrollment and unlock flows.
   */
  export function deriveQrSessionKey(
    privateKey: CryptoKey,
    remotePublicKey: CryptoKey,
    challengeBytes: Uint8Array,
  ): Promise<CryptoKey>;

  /**
   * Encrypt `data` with the session key using AES-256-GCM.
   *
   * @param sessionKey — the ECDH-derived session key
   * @param data       — plaintext bytes to seal (e.g. raw vault key)
   * @param aad        — additional authenticated data (e.g. 'enrollment')
   */
  export function encryptForTransport(
    sessionKey: CryptoKey,
    data: Uint8Array,
    aad: string,
  ): Promise<TransportCiphertext>;
}
