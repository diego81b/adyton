import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Redis } from 'ioredis';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { User } from '../entities/user.entity';
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

// Relying-party identity. rpID must be the effective domain of the web origin;
// production values land with Phase 8 deployment config.
const RP_NAME = 'Adyton';
function rpId(): string {
  return process.env.WEBAUTHN_RP_ID ?? 'localhost';
}
function expectedOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:30000';
}

// In-flight challenge keys (Redis, short TTL): registration is keyed by user,
// authentication by the pending-MFA token hash so it dies with the login attempt.
const REG_CHALLENGE_PREFIX = 'webauthn_reg:';
const AUTH_CHALLENGE_PREFIX = 'webauthn_auth:';
const CHALLENGE_TTL_SECONDS = 300;

export interface PasskeySummary {
  id: string;
  friendlyName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

@Injectable()
export class WebauthnService {
  constructor(
    private readonly em: EntityManager,
    private readonly cryptoService: CryptoService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Start passkey registration for the authenticated user. Requires TOTP to be
   * enabled first: recovery codes are issued at TOTP enrollment, so a passkey-only
   * account would have no recovery story (deliberate V1 constraint).
   */
  async registrationOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.em.findOneOrFail(User, { id: userId });
    if (!user.totpEnabled) {
      throw new BadRequestException('Enable two-factor authentication before adding passkeys');
    }

    const existing = await this.em.find(WebAuthnCredential, { user });
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpId(),
      userName: user.email,
      userID: Buffer.from(user.id, 'utf8'),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: parseTransports(c.transports),
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    await this.redis.setex(`${REG_CHALLENGE_PREFIX}${user.id}`, CHALLENGE_TTL_SECONDS, options.challenge);
    return options;
  }

  /** Complete passkey registration: verify the attestation, store the credential. */
  async registrationVerify(
    userId: string,
    response: RegistrationResponseJSON,
    friendlyName: string,
    ip: string,
    userAgent: string,
  ): Promise<PasskeySummary> {
    const user = await this.em.findOneOrFail(User, { id: userId });

    const expectedChallenge = await this.redis.getdel(`${REG_CHALLENGE_PREFIX}${user.id}`);
    if (!expectedChallenge) {
      throw new BadRequestException('Registration challenge expired — restart the flow');
    }

    let verified = false;
    let registrationInfo: Awaited<ReturnType<typeof verifyRegistrationResponse>>['registrationInfo'];
    try {
      ({ verified, registrationInfo } = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: expectedOrigin(),
        expectedRPID: rpId(),
      }));
    } catch {
      throw new BadRequestException('Passkey registration could not be verified');
    }
    if (!verified || !registrationInfo) {
      throw new BadRequestException('Passkey registration could not be verified');
    }

    const { credential, aaguid } = registrationInfo;
    const duplicate = await this.em.findOne(WebAuthnCredential, { credentialId: credential.id });
    if (duplicate) {
      throw new ConflictException('This passkey is already registered');
    }

    const row = this.em.create(WebAuthnCredential, {
      user,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      signCount: credential.counter,
      aaguid,
      friendlyName: friendlyName.slice(0, 255),
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      lastUsedAt: null,
      createdAt: new Date(),
    } as never);
    this.em.persist(row);
    this.auditService.persistLog(user.id, AuditAction.WEBAUTHN_REGISTERED, ip, userAgent, {
      friendlyName: row.friendlyName,
    });
    await this.em.flush();

    return toSummary(row);
  }

  async listCredentials(userId: string): Promise<PasskeySummary[]> {
    const rows = await this.em.find(
      WebAuthnCredential,
      { user: userId },
      { orderBy: { createdAt: 'ASC' } },
    );
    return rows.map(toSummary);
  }

  async removeCredential(userId: string, id: string, ip: string, userAgent: string): Promise<void> {
    const row = await this.em.findOne(WebAuthnCredential, { id });
    if (!row) throw new NotFoundException('Passkey not found');
    if (row.user.id !== userId) throw new ForbiddenException();

    this.em.remove(row);
    this.auditService.persistLog(userId, AuditAction.WEBAUTHN_REMOVED, ip, userAgent, {
      friendlyName: row.friendlyName,
    });
    await this.em.flush();
  }

  /**
   * Second login stage, passkey path: bound to the same opaque mfaToken as TOTP.
   * The generated challenge is keyed by the token hash so it cannot outlive or
   * cross over to another login attempt.
   */
  async authenticationOptions(mfaToken: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const tokenHash = this.cryptoService.hashToken(mfaToken);
    const userId = await this.redis.get(`${MFA_TOKEN_PREFIX}${tokenHash}`);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    const credentials = await this.em.find(WebAuthnCredential, { user: userId });
    if (credentials.length === 0) {
      throw new UnauthorizedException('No passkeys registered');
    }

    const options = await generateAuthenticationOptions({
      rpID: rpId(),
      userVerification: 'preferred',
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        transports: parseTransports(c.transports),
      })),
    });

    await this.redis.setex(`${AUTH_CHALLENGE_PREFIX}${tokenHash}`, CHALLENGE_TTL_SECONDS, options.challenge);
    return options;
  }

  /** Verify the passkey assertion and issue the full session. */
  async authenticationVerify(
    mfaToken: string,
    response: AuthenticationResponseJSON,
    ip: string,
    userAgent: string,
    deviceIdCookie?: string,
  ): Promise<AuthResult> {
    const tokenHash = this.cryptoService.hashToken(mfaToken);
    const tokenKey = `${MFA_TOKEN_PREFIX}${tokenHash}`;
    const attemptsKey = `${MFA_ATTEMPTS_PREFIX}${tokenHash}`;
    const challengeKey = `${AUTH_CHALLENGE_PREFIX}${tokenHash}`;

    const userId = await this.redis.get(tokenKey);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    // Shares the TOTP attempt budget: 5 wrong second-factor tries kill the token.
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) {
      await this.redis.expire(attemptsKey, MFA_TOKEN_TTL_SECONDS);
    }
    if (attempts > MFA_MAX_ATTEMPTS) {
      await this.redis.del(tokenKey, attemptsKey, challengeKey);
      await this.auditService.log(userId, AuditAction.TWO_FACTOR_FAILURE, ip, userAgent, {
        reason: 'too_many_attempts',
      });
      throw new UnauthorizedException('Too many attempts');
    }

    const expectedChallenge = await this.redis.getdel(challengeKey);
    if (!expectedChallenge) {
      throw new UnauthorizedException('Authentication challenge expired — request new options');
    }

    // populate user: completeLogin needs email/kdfSalt/totpEnabled, not a bare ref
    const credential = await this.em.findOne(
      WebAuthnCredential,
      { credentialId: response.id, user: userId },
      { populate: ['user'] },
    );
    if (!credential) {
      await this.auditService.log(userId, AuditAction.TWO_FACTOR_FAILURE, ip, userAgent, {
        method: 'webauthn',
        reason: 'unknown_credential',
      });
      throw new UnauthorizedException('Invalid passkey');
    }

    let verified = false;
    let newCounter = credential.signCount;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: expectedOrigin(),
        expectedRPID: rpId(),
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, 'base64url'),
          counter: credential.signCount,
          transports: parseTransports(credential.transports),
        },
      });
      verified = result.verified;
      newCounter = result.authenticationInfo.newCounter;
    } catch {
      verified = false;
    }

    if (!verified) {
      await this.auditService.log(userId, AuditAction.TWO_FACTOR_FAILURE, ip, userAgent, {
        method: 'webauthn',
      });
      throw new UnauthorizedException('Invalid passkey');
    }

    credential.signCount = newCounter;
    credential.lastUsedAt = new Date();

    await this.redis.del(tokenKey, attemptsKey); // single-use token
    const user = credential.user;
    return this.authService.completeLogin(user, ip, userAgent, deviceIdCookie);
  }
}

function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AuthenticatorTransportFuture[];
  } catch {
    return undefined;
  }
}

function toSummary(row: WebAuthnCredential): PasskeySummary {
  return {
    id: row.id,
    friendlyName: row.friendlyName,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}
