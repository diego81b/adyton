import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Redis } from 'ioredis';
import { RecoveryKit } from '../entities/recovery-kit.entity';
import { User } from '../entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../entities/audit-log.entity';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { SetupRecoveryKitDto } from './dto/recovery.dto';
import { RecoveryStatusResponseDto, RecoveryVaultKeyResponseDto } from './dto/recovery-response.dto';

// 3 retrievals per user per hour
const VAULT_KEY_RATE_LIMIT = 3;
const VAULT_KEY_WINDOW_SECONDS = 3600;

@Injectable()
export class RecoveryService {
  constructor(
    private readonly em: EntityManager,
    private readonly auditService: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async setup(userId: string, dto: SetupRecoveryKitDto, ip: string, ua: string): Promise<void> {
    const user = this.em.getReference(User, userId);

    const existing = await this.em.findOne(RecoveryKit, { user: userId });
    if (existing) {
      existing.recoverySalt = dto.recoverySalt;
      existing.recoveryWrappedVaultKey = dto.recoveryWrappedVaultKey;
      existing.wrapIv = dto.wrapIv;
      existing.confirmedAt = new Date();
      existing.revokedAt = null;
    } else {
      this.em.persist(
        this.em.create(RecoveryKit, {
          user,
          recoverySalt: dto.recoverySalt,
          recoveryWrappedVaultKey: dto.recoveryWrappedVaultKey,
          wrapIv: dto.wrapIv,
          confirmedAt: new Date(),
          revokedAt: null,
        } as never),
      );
    }

    this.auditService.persistLog(userId, AuditAction.PAK_RECOVERY_KIT_CREATED, ip, ua);
    await this.em.flush();
  }

  async revoke(userId: string, ip: string, ua: string): Promise<void> {
    const existing = await this.em.findOne(RecoveryKit, { user: userId });
    if (existing) {
      await this.em.nativeDelete(RecoveryKit, { user: userId });
    }
    this.auditService.persistLog(userId, AuditAction.PAK_RECOVERY_KIT_REVOKED, ip, ua);
    await this.em.flush();
  }

  async getStatus(userId: string): Promise<RecoveryStatusResponseDto> {
    const kit = await this.em.findOne(RecoveryKit, { user: userId });
    if (!kit) {
      return { hasKit: false };
    }
    return { hasKit: true, confirmedAt: kit.confirmedAt.toISOString() };
  }

  async getVaultKey(userId: string, ip: string, ua: string): Promise<RecoveryVaultKeyResponseDto> {
    const rateLimitKey = `recovery_vault_key:${userId}`;
    const count = await this.redis.incr(rateLimitKey);
    await this.redis.expire(rateLimitKey, VAULT_KEY_WINDOW_SECONDS);
    if (count > VAULT_KEY_RATE_LIMIT) {
      throw new HttpException('Recovery vault key rate limit exceeded (3 per hour)', HttpStatus.TOO_MANY_REQUESTS);
    }

    const kit = await this.em.findOne(RecoveryKit, { user: userId });
    if (!kit) {
      throw new NotFoundException('No recovery kit found for this user');
    }

    this.auditService.persistLog(userId, AuditAction.PAK_RECOVERY_KIT_USED, ip, ua);
    await this.em.flush();

    return {
      recoverySalt: kit.recoverySalt,
      recoveryWrappedVaultKey: kit.recoveryWrappedVaultKey,
      wrapIv: kit.wrapIv,
    };
  }
}
