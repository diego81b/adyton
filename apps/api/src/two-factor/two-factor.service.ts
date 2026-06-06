import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Redis } from 'ioredis';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { User } from '../entities/user.entity';
import { RecoveryCode } from '../entities/recovery-code.entity';
import { WebAuthnCredential } from '../entities/webauthn-credential.entity';
import { CryptoService } from '../crypto/crypto.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../entities/audit-log.entity';
import { REDIS_CLIENT } from '../redis/redis.provider';
import {
  AuthService,
  AuthResult,
  MFA_TOKEN_PREFIX,
  MFA_ATTEMPTS_PREFIX,
  MFA_TOKEN_TTL_SECONDS,
  MFA_MAX_ATTEMPTS,
} from '../auth/auth.service';
import { loadTotpEncKey, encryptTotpSecret, decryptTotpSecret } from './totp-cipher';
import { AuthenticateTwoFactorDto } from './dto/authenticate-two-factor.dto';

const TOTP_ISSUER = 'Adyton';
// ±30s tolerance = one RFC 6238 time-step of clock drift in each direction.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

@Injectable()
export class TwoFactorService {
  // Lazy: loaded on first 2FA operation so the app boots without the key file
  // until someone actually enrolls (and unit tests can point TOTP_ENC_KEY_PATH
  // at a fixture before first use).
  private encKey: Buffer | null = null;

  constructor(
    private readonly em: EntityManager,
    private readonly cryptoService: CryptoService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private get key(): Buffer {
    this.encKey ??= loadTotpEncKey();
    return this.encKey;
  }

  /**
   * Start TOTP enrollment: generate a 160-bit secret, store it encrypted (pending —
   * totpEnabled stays false until a valid code confirms the scan), return the
   * otpauth URI + QR data URI. Re-calling overwrites the pending secret.
   */
  async setup(userId: string): Promise<{ secret: string; otpauthUri: string; qrDataUri: string }> {
    const user = await this.em.findOneOrFail(User, { id: userId });
    if (user.totpEnabled) {
      throw new ConflictException('Two-factor authentication is already enabled');
    }

    const secret = generateSecret();
    user.totpSecretEncrypted = encryptTotpSecret(secret, this.key);
    await this.em.flush();

    const otpauthUri = generateURI({ secret, issuer: TOTP_ISSUER, label: user.email });
    const qrDataUri = await QRCode.toDataURL(otpauthUri);
    return { secret, otpauthUri, qrDataUri };
  }

  /**
   * Confirm enrollment with a valid TOTP code (prevents lockout from a bad QR scan),
   * flip totpEnabled, and issue the 8 one-time recovery codes — plaintext returned
   * exactly once, only Argon2id hashes stored.
   */
  async enable(userId: string, code: string, ip: string, userAgent: string): Promise<string[]> {
    const user = await this.em.findOneOrFail(User, { id: userId });
    if (user.totpEnabled) {
      throw new ConflictException('Two-factor authentication is already enabled');
    }
    if (!user.totpSecretEncrypted) {
      throw new BadRequestException('Two-factor setup has not been started');
    }

    const secret = decryptTotpSecret(user.totpSecretEncrypted, this.key);
    const result = await verify({ secret, token: code, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS });
    if (!result.valid) {
      await this.auditService.log(user.id, AuditAction.TWO_FACTOR_FAILURE, ip, userAgent, { stage: 'enable' });
      throw new UnauthorizedException('Invalid code');
    }

    user.totpEnabled = true;
    const codes = await this.replaceRecoveryCodes(user);
    this.auditService.persistLog(user.id, AuditAction.TWO_FACTOR_ENABLED, ip, userAgent);
    await this.em.flush();
    return codes;
  }

  /** Disable 2FA after re-verifying the master password; wipes secret + recovery codes. */
  async disable(userId: string, password: string, ip: string, userAgent: string): Promise<void> {
    const user = await this.em.findOneOrFail(User, { id: userId });

    const valid = await this.cryptoService.verifyPassword(password, user.passwordHash);
    if (!valid) {
      await this.auditService.log(user.id, AuditAction.LOGIN_FAILURE, ip, userAgent, {
        reason: 'two_factor_disable_wrong_password',
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.totpEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    user.totpEnabled = false;
    user.totpSecretEncrypted = null;
    await this.em.nativeDelete(RecoveryCode, { user });
    await this.em.nativeDelete(WebAuthnCredential, { user });
    this.auditService.persistLog(user.id, AuditAction.TWO_FACTOR_DISABLED, ip, userAgent);
    await this.em.flush();
  }

  /** Regenerate recovery codes (password re-verified); all previous codes are invalidated. */
  async regenerateRecoveryCodes(
    userId: string,
    password: string,
    ip: string,
    userAgent: string,
  ): Promise<string[]> {
    const user = await this.em.findOneOrFail(User, { id: userId });

    const valid = await this.cryptoService.verifyPassword(password, user.passwordHash);
    if (!valid) {
      await this.auditService.log(user.id, AuditAction.LOGIN_FAILURE, ip, userAgent, {
        reason: 'recovery_codes_regenerate_wrong_password',
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.totpEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const codes = await this.replaceRecoveryCodes(user);
    this.auditService.persistLog(user.id, AuditAction.RECOVERY_CODES_REGENERATED, ip, userAgent);
    await this.em.flush();
    return codes;
  }

  /**
   * Second login stage: consume the opaque mfaToken (single-use, hashed in Redis)
   * plus a TOTP code or a recovery code, then issue the full session via
   * AuthService.completeLogin. Wrong codes burn attempts; the 6th attempt kills
   * the token (the user must re-enter the password).
   */
  async authenticate(
    dto: AuthenticateTwoFactorDto,
    ip: string,
    userAgent: string,
    deviceIdCookie?: string,
  ): Promise<AuthResult> {
    if (!dto.code === !dto.recoveryCode) {
      throw new BadRequestException('Provide exactly one of code or recoveryCode');
    }

    const tokenHash = this.cryptoService.hashToken(dto.mfaToken);
    const tokenKey = `${MFA_TOKEN_PREFIX}${tokenHash}`;
    const attemptsKey = `${MFA_ATTEMPTS_PREFIX}${tokenHash}`;

    const userId = await this.redis.get(tokenKey);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) {
      await this.redis.expire(attemptsKey, MFA_TOKEN_TTL_SECONDS);
    }
    if (attempts > MFA_MAX_ATTEMPTS) {
      await this.redis.del(tokenKey, attemptsKey);
      await this.auditService.log(userId, AuditAction.TWO_FACTOR_FAILURE, ip, userAgent, {
        reason: 'too_many_attempts',
      });
      throw new UnauthorizedException('Too many attempts');
    }

    const user = await this.em.findOne(User, { id: userId });
    if (!user || !user.totpEnabled || !user.totpSecretEncrypted) {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    let usedRecovery = false;
    let valid = false;
    if (dto.code) {
      const secret = decryptTotpSecret(user.totpSecretEncrypted, this.key);
      valid = (await verify({ secret, token: dto.code, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS })).valid;
    } else {
      const rows = await this.em.find(RecoveryCode, { user });
      for (const row of rows) {
        if (await this.cryptoService.verifyRecoveryCode(dto.recoveryCode!, row.codeHash)) {
          this.em.remove(row); // single-use: flushed by completeLogin below
          usedRecovery = true;
          valid = true;
          break;
        }
      }
    }

    if (!valid) {
      await this.auditService.log(user.id, AuditAction.TWO_FACTOR_FAILURE, ip, userAgent, {
        stage: 'authenticate',
      });
      throw new UnauthorizedException('Invalid code');
    }

    await this.redis.del(tokenKey, attemptsKey); // single-use token
    if (usedRecovery) {
      this.auditService.persistLog(user.id, AuditAction.RECOVERY_CODE_USED, ip, userAgent);
    }

    return this.authService.completeLogin(user, ip, userAgent, deviceIdCookie);
  }

  private async replaceRecoveryCodes(user: User): Promise<string[]> {
    await this.em.nativeDelete(RecoveryCode, { user });
    const codes = this.cryptoService.generateRecoveryCodes();
    for (const code of codes) {
      const codeHash = await this.cryptoService.hashRecoveryCode(code);
      this.em.persist(this.em.create(RecoveryCode, { user, codeHash, createdAt: new Date() } as never));
    }
    return codes;
  }
}
