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

  /**
   * Generate hex-encoded 32 random bytes — opaque MFA pending-login token.
   * Stored hashed in Redis (mirrors refresh-token hashing), never a JWT:
   * it cannot pass JwtAuthGuard by construction.
   */
  generateMfaToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generate one-time 2FA recovery codes, `xxxxx-xxxxx-xxxxx-xxxxx` (20 hex chars).
   * Mirrors packages/shared generateRecoveryCodes (api cannot import shared source).
   */
  generateRecoveryCodes(count = 8): string[] {
    return Array.from({ length: count }, () => {
      const hex = randomBytes(10).toString('hex');
      return `${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
    });
  }

  /**
   * Argon2id hash of a recovery code with REDUCED cost (m=19456, t=2, p=1 per
   * analysis/security/architecture.md §3.5): codes carry 80 bits of entropy,
   * so login-grade memory cost is unnecessary and would slow the 8-hash batch.
   */
  async hashRecoveryCode(code: string): Promise<string> {
    return argon2.hash(code, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, code);
  }
}
