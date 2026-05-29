import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class CryptoService {
  /**
   * Argon2id hash of auth password (server-side only, NOT vault key derivation).
   */
  async hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }

  /**
   * SHA-256 hex of a raw token string.
   * Used for refresh token + device ID storage.
   */
  hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Generate hex-encoded 32 random bytes — used for kdfSalt.
   */
  generateKdfSalt(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generate hex-encoded 32 random bytes — raw refresh token.
   * Will be hashed before DB storage.
   */
  generateRefreshToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generate hex-encoded 32 random bytes — raw device_id cookie value.
   */
  generateDeviceId(): string {
    return randomBytes(32).toString('hex');
  }
}
