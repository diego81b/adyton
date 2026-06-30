import { WebPlugin } from '@capacitor/core';
import type { AdytonKeystorePlugin } from './index';

export class AdytonKeystoreWeb extends WebPlugin implements AdytonKeystorePlugin {
  async generateKeys(_opts: { deviceId: string }): Promise<{ ecdhPublicKey: string; signPublicKey: string }> {
    throw this.unavailable('AdytonKeystore is not available on web. Use the native Capacitor app.');
  }

  async getPublicKeys(_opts: { deviceId: string }): Promise<{ ecdhPublicKey: string; signPublicKey: string }> {
    throw this.unavailable('AdytonKeystore is not available on web.');
  }

  async sealVaultKey(_opts: { deviceId: string; vaultKeyRaw: string }): Promise<void> {
    throw this.unavailable('AdytonKeystore is not available on web.');
  }

  async unsealVaultKey(_opts: { deviceId: string }): Promise<{ vaultKeyRaw: string }> {
    throw this.unavailable('AdytonKeystore is not available on web.');
  }

  async encryptForRelay(_opts: {
    deviceId: string;
    remotePublicKeySpki: string;
    challengeHex: string;
    sessionId: string;
  }): Promise<{ ciphertext: string; iv: string; phoneEphemeralPub: string }> {
    throw this.unavailable('AdytonKeystore is not available on web.');
  }

  async sign(_opts: { deviceId: string; dataBase64: string }): Promise<{ signatureBase64: string }> {
    throw this.unavailable('AdytonKeystore is not available on web.');
  }

  async hasKeys(_opts: { deviceId: string }): Promise<{ exists: boolean }> {
    return { exists: false };
  }

  async hasRawKey(_opts: { deviceId: string }): Promise<{ exists: boolean }> {
    return { exists: false };
  }

  async deleteKeys(_opts: { deviceId: string }): Promise<void> {
    throw this.unavailable('AdytonKeystore is not available on web.');
  }
}
