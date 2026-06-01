import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { AuditLog, AuditAction } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class AuditService {
  constructor(private readonly em: EntityManager) {}

  persistLog(
    userId: string | null,
    action: AuditAction,
    ipAddress: string,
    userAgent: string,
    metadata?: Record<string, unknown>,
  ): void {
    const user = userId ? this.em.getReference(User, userId) : null;
    this.em.persist(
      this.em.create(AuditLog, {
        user,
        action,
        ipAddress: ipAddress.slice(0, 45),
        userAgent: userAgent.slice(0, 512),
        metadata: metadata ?? null,
        createdAt: new Date(),
      } as never),
    );
  }

  async log(
    userId: string | null,
    action: AuditAction,
    ipAddress: string,
    userAgent: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.persistLog(userId, action, ipAddress, userAgent, metadata);
    await this.em.flush();
  }
}
