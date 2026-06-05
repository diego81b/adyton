import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EntityManager } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { User } from '../entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { TrustedDevice } from '../entities/trusted-device.entity';
import { CryptoService } from '../crypto/crypto.service';
import { ProgressiveDelayService } from './progressive-delay/progressive-delay.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { EmailNotifier, EMAIL_NOTIFIER } from '../notifications/email-notifier.interface';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { ChallengeService } from './challenge/challenge.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../entities/audit-log.entity';

export interface AuthResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    kdfSalt: string;
    totpEnabled: boolean;
  };
  newDeviceId?: string;
  rawRefreshToken: string;
}

/**
 * First login stage outcome for a 2FA-enabled user: NO tokens are issued.
 * mfaToken is an opaque random value held hashed in Redis — it is not a JWT
 * and cannot pass JwtAuthGuard, so no partially-authenticated session exists.
 */
export interface MfaRequiredResult {
  requiresMfa: true;
  mfaToken: string;
}

export type LoginOutcome = AuthResult | MfaRequiredResult;

const REFRESH_TOKEN_TTL_DAYS = 7;

// Pending-MFA login state: short window to enter the second factor.
export const MFA_TOKEN_PREFIX = 'mfa_token:';
export const MFA_ATTEMPTS_PREFIX = 'mfa_attempts:';
export const MFA_TOKEN_TTL_SECONDS = 300;
export const MFA_MAX_ATTEMPTS = 5;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function isUniqueConstraintError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e['code'] === '23505') return true;
    if (typeof e['name'] === 'string' && e['name'].includes('UniqueConstraint')) return true;
    const cause = e['cause'] as Record<string, unknown> | undefined;
    if (cause && cause['code'] === '23505') return true;
  }
  return false;
}

const DEVICE_OTP_TTL_SECONDS = 600;

@Injectable()
export class AuthService {
  constructor(
    private readonly em: EntityManager,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly progressiveDelay: ProgressiveDelayService,
    @Inject(EMAIL_NOTIFIER) private readonly emailNotifier: EmailNotifier,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly challengeService: ChallengeService,
    private readonly auditService: AuditService,
  ) {}

  private async checkPoW(challenge: string | undefined, nonce: string | undefined): Promise<void> {
    if (process.env.ENABLE_POW !== 'true') return;
    if (!challenge || !nonce) {
      throw new BadRequestException('Proof of work required');
    }
    await this.challengeService.verifyAndConsume(challenge, nonce);
  }

  private signAccessToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      // Semantics: "all factors required at issuance were satisfied". Always true
      // on issued tokens by construction — a 2FA-enabled login never reaches token
      // issuance before /auth/2fa/authenticate succeeds (it only gets an opaque
      // Redis mfaToken). Kept in the payload for future step-up auth checks.
      twoFactorPassed: true,
    };
    return this.jwtService.sign(payload, { algorithm: 'RS256', expiresIn: '15m' });
  }

  private async issueRefreshToken(
    user: User,
    familyId: string,
    ip: string,
    userAgent: string,
  ): Promise<string> {
    const rawToken = this.cryptoService.generateRefreshToken();
    const tokenHash = this.cryptoService.hashToken(rawToken);

    const refreshToken = this.em.create(RefreshToken, {
      user,
      tokenHash,
      familyId,
      expiresAt: addDays(new Date(), REFRESH_TOKEN_TTL_DAYS),
      ipAddress: ip.slice(0, 45),
      userAgent: userAgent.slice(0, 512),
      createdAt: new Date(),
    } as never);

    this.em.persist(refreshToken);
    return rawToken;
  }

  private async handleNewDevice(
    user: User,
    deviceIdCookie: string | undefined,
    ip: string,
    userAgent: string,
  ): Promise<string | undefined> {
    if (deviceIdCookie) {
      const deviceIdHash = this.cryptoService.hashToken(deviceIdCookie);
      const existing = await this.em.findOne(TrustedDevice, {
        deviceIdHash,
        user,
        revokedAt: null,
      });

      if (existing) {
        existing.lastSeenAt = new Date();
        return undefined; // known device
      }
    }

    // New device — issue a one-time Redis OTP (single-use, 600s TTL)
    // Store userId as value so DevicesService can scope-check redemption
    const otp = this.cryptoService.generateDeviceId();
    await this.redis.setex(`device_otp:${otp}`, DEVICE_OTP_TTL_SECONDS, user.id);

    await this.emailNotifier.sendNewDeviceAlert(user.email, ip, userAgent);
    this.auditService.persistLog(user.id, AuditAction.NEW_DEVICE_ALERT, ip, userAgent);

    return otp;
  }

  /**
   * Issue the full session (refresh token family + device handling + access token).
   * Reached only when every required factor is satisfied: directly from login for
   * users without 2FA, or from TwoFactorService.authenticate after code verification.
   */
  async completeLogin(
    user: User,
    ip: string,
    userAgent: string,
    deviceIdCookie: string | undefined,
    auditAction: AuditAction = AuditAction.LOGIN_SUCCESS,
  ): Promise<AuthResult> {
    const familyId = randomUUID();
    const rawRefreshToken = await this.issueRefreshToken(user, familyId, ip, userAgent);
    const newDeviceId = await this.handleNewDevice(user, deviceIdCookie, ip, userAgent);
    this.auditService.persistLog(user.id, auditAction, ip, userAgent);
    await this.em.flush();

    const accessToken = this.signAccessToken(user);

    return {
      accessToken,
      user: { id: user.id, email: user.email, kdfSalt: user.kdfSalt, totpEnabled: user.totpEnabled },
      newDeviceId,
      rawRefreshToken,
    };
  }

  /**
   * Create the opaque pending-MFA token for a password-verified, 2FA-enabled user.
   * Stored hashed in Redis (same hygiene as refresh tokens) with a 5-minute TTL.
   */
  private async createMfaToken(user: User): Promise<string> {
    const raw = this.cryptoService.generateMfaToken();
    const tokenHash = this.cryptoService.hashToken(raw);
    await this.redis.setex(`${MFA_TOKEN_PREFIX}${tokenHash}`, MFA_TOKEN_TTL_SECONDS, user.id);
    return raw;
  }

  async register(dto: RegisterDto, ip: string, userAgent: string): Promise<AuthResult> {
    await this.checkPoW(dto.powChallenge, dto.powNonce);
    const email = dto.email.toLowerCase();
    const passwordHash = await this.cryptoService.hashPassword(dto.password);
    const kdfSalt = this.cryptoService.generateKdfSalt();

    const user = this.em.create(User, {
      email,
      passwordHash,
      kdfSalt,
      totpEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    this.em.persist(user);

    try {
      await this.em.flush();
    } catch (err: unknown) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }

    return this.completeLogin(user, ip, userAgent, undefined, AuditAction.REGISTER);
  }

  async login(dto: LoginDto, ip: string, userAgent: string, deviceIdCookie?: string): Promise<LoginOutcome> {
    await this.checkPoW(dto.powChallenge, dto.powNonce);
    const email = dto.email.toLowerCase();

    await this.progressiveDelay.checkAndDelay(ip, email);

    const user = await this.em.findOne(User, { email });
    if (!user) {
      await this.progressiveDelay.recordFailure(ip, email);
      await this.auditService.log(null, AuditAction.LOGIN_FAILURE, ip, userAgent, { reason: 'unknown_email' });
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.cryptoService.verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      await this.progressiveDelay.recordFailure(ip, email);
      await this.auditService.log(user.id, AuditAction.LOGIN_FAILURE, ip, userAgent, { reason: 'wrong_password' });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.progressiveDelay.clearFailures(ip, email);

    if (user.totpEnabled) {
      // Password verified but a second factor is required: issue NO tokens.
      // LOGIN_SUCCESS is audited only after /auth/2fa/authenticate completes.
      const mfaToken = await this.createMfaToken(user);
      return { requiresMfa: true, mfaToken };
    }

    return this.completeLogin(user, ip, userAgent, deviceIdCookie);
  }

  async refresh(oldToken: RefreshToken, ip: string, userAgent: string): Promise<AuthResult> {
    // Revoke old token (same family, rotation)
    oldToken.revokedAt = new Date();

    // Issue new token in same family
    const rawRefreshToken = await this.issueRefreshToken(
      oldToken.user,
      oldToken.familyId,
      ip,
      userAgent,
    );

    await this.em.flush();

    const accessToken = this.signAccessToken(oldToken.user);

    return {
      accessToken,
      user: {
        id: oldToken.user.id,
        email: oldToken.user.email,
        kdfSalt: oldToken.user.kdfSalt,
        totpEnabled: oldToken.user.totpEnabled,
      },
      rawRefreshToken,
    };
  }

  async logout(refreshToken: RefreshToken, ip: string, userAgent: string): Promise<void> {
    refreshToken.revokedAt = new Date();
    this.auditService.persistLog(refreshToken.user.id, AuditAction.LOGOUT, ip, userAgent);
    await this.em.flush();
  }

  async getMe(userId: string): Promise<{ id: string; email: string; kdfSalt: string; totpEnabled: boolean }> {
    const user = await this.em.findOneOrFail(User, { id: userId });
    return { id: user.id, email: user.email, kdfSalt: user.kdfSalt, totpEnabled: user.totpEnabled };
  }

  /**
   * Permanently delete the authenticated user's account after re-verifying the
   * password. DB-level ON DELETE CASCADE removes refresh tokens, trusted devices,
   * WebAuthn credentials, and vault entries. Audit logs also cascade.
   *
   * No bespoke rate limiting here: the password check mirrors login, and the
   * endpoint is covered by the global rate limiter / progressive-delay layer at
   * the IP level. Wrong password yields the same generic message as login.
   */
  async deleteAccount(userId: string, password: string, ip: string, userAgent: string): Promise<void> {
    const user = await this.em.findOneOrFail(User, { id: userId });

    const valid = await this.cryptoService.verifyPassword(password, user.passwordHash);
    if (!valid) {
      await this.auditService.log(user.id, AuditAction.LOGIN_FAILURE, ip, userAgent, {
        reason: 'account_deletion_wrong_password',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.em.removeAndFlush(user);
  }
}
