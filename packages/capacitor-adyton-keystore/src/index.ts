import { registerPlugin } from '@capacitor/core';

export interface SealedVaultKey {
  ciphertext: string;   // base64
  iv: string;           // base64, 12 bytes
  ephemeralPub: string; // base64 SPKI
}

export interface AdytonKeystorePlugin {
  /**
   * Generate (or retrieve if exists) the persistent P-256 ECDH key + SIGN key in Android Keystore.
   * Returns the ECDH public key as base64 SPKI.
   * Idempotent — safe to call multiple times.
   */
  generateKeys(options: { deviceId: string }): Promise<{ ecdhPublicKey: string; signPublicKey: string }>;

  /**
   * Get the persistent public keys for a device (must call generateKeys first).
   */
  getPublicKeys(options: { deviceId: string }): Promise<{ ecdhPublicKey: string; signPublicKey: string }>;

  /**
   * Seal raw vault key bytes using the persistent ECDH key (self-ECDH wrap).
   * Stores sealed key in app files dir. Requires biometric auth.
   * vaultKeyRaw: base64 encoded 32 bytes
   */
  sealVaultKey(options: { deviceId: string; vaultKeyRaw: string }): Promise<void>;

  /**
   * Unseal vault key. Requires biometric auth.
   * Returns vaultKeyRaw: base64 encoded 32 bytes.
   */
  unsealVaultKey(options: { deviceId: string }): Promise<{ vaultKeyRaw: string }>;

  /**
   * Perform ECDH with the remote public key, HKDF-derive session key,
   * AES-GCM encrypt the vault key raw bytes for transport.
   * This is the QR relay approval step — requires biometric auth.
   * Returns phone's ephemeral pub key + encrypted payload.
   *
   * remotePublicKeySpki: base64 SPKI (desktop's ephemeral pub)
   * challengeHex: 32-byte hex string (HKDF salt)
   * sessionId: used as AAD
   */
  encryptForRelay(options: {
    deviceId: string;
    remotePublicKeySpki: string;
    challengeHex: string;
    sessionId: string;
  }): Promise<{
    ciphertext: string;        // base64
    iv: string;                // base64
    phoneEphemeralPub: string; // base64 SPKI
  }>;

  /**
   * Sign data with the persistent SIGN key (ECDSA P-256 SHA-256).
   * Requires biometric auth.
   * dataBase64: base64 encoded bytes to sign
   * Returns signatureBase64: DER-encoded ECDSA signature, base64
   */
  sign(options: { deviceId: string; dataBase64: string }): Promise<{ signatureBase64: string }>;

  /**
   * Check if keys exist for this deviceId.
   */
  hasKeys(options: { deviceId: string }): Promise<{ exists: boolean }>;

  /**
   * Delete all keys for this deviceId from Keystore + remove sealed vault key file.
   */
  deleteKeys(options: { deviceId: string }): Promise<void>;
}

export const AdytonKeystore = registerPlugin<AdytonKeystorePlugin>('AdytonKeystore', {
  web: () => import('./web').then(m => new m.AdytonKeystoreWeb()),
});
