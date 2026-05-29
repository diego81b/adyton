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

const REFRESH_TOKEN_TTL_DAYS = 7;

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
      twoFactorPassed: false,
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
    // TODO: audit log — NEW_DEVICE_ALERT

    return otp;
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

    // TODO: audit log — REGISTER

    const familyId = randomUUID();
    const rawRefreshToken = await this.issueRefreshToken(user, familyId, ip, userAgent);
    const newDeviceId = await this.handleNewDevice(user, undefined, ip, userAgent);
    await this.em.flush();

    const accessToken = this.signAccessToken(user);

    return {
      accessToken,
      user: { id: user.id, email: user.email, kdfSalt: user.kdfSalt, totpEnabled: user.totpEnabled },
      newDeviceId,
      rawRefreshToken,
    };
  }

  async login(dto: LoginDto, ip: string, userAgent: string, deviceIdCookie?: string): Promise<AuthResult> {
    await this.checkPoW(dto.powChallenge, dto.powNonce);
    const email = dto.email.toLowerCase();

    await this.progressiveDelay.checkAndDelay(ip, email);

    const user = await this.em.findOne(User, { email });
    if (!user) {
      await this.progressiveDelay.recordFailure(ip, email);
      // TODO: audit log — LOGIN_FAILURE (no user)
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.cryptoService.verifyPassword(dto.password, user.passwordHash);
    if (!valid) {
      await this.progressiveDelay.recordFailure(ip, email);
      // TODO: audit log — LOGIN_FAILURE
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.progressiveDelay.clearFailures(ip, email);
    // TODO: audit log — LOGIN_SUCCESS

    const familyId = randomUUID();
    const rawRefreshToken = await this.issueRefreshToken(user, familyId, ip, userAgent);
    const newDeviceId = await this.handleNewDevice(user, deviceIdCookie, ip, userAgent);
    await this.em.flush();

    const accessToken = this.signAccessToken(user);

    return {
      accessToken,
      user: { id: user.id, email: user.email, kdfSalt: user.kdfSalt, totpEnabled: user.totpEnabled },
      newDeviceId,
      rawRefreshToken,
    };
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

  async logout(refreshToken: RefreshToken): Promise<void> {
    refreshToken.revokedAt = new Date();
    // TODO: audit log — LOGOUT
    await this.em.flush();
  }

  async getMe(userId: string): Promise<{ id: string; email: string; kdfSalt: string; totpEnabled: boolean }> {
    const user = await this.em.findOneOrFail(User, { id: userId });
    return { id: user.id, email: user.email, kdfSalt: user.kdfSalt, totpEnabled: user.totpEnabled };
  }
}
