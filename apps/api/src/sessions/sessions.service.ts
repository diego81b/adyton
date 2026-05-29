import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { RefreshToken } from '../entities/refresh-token.entity';

export interface SessionSummary {
  id: string;
  familyId: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class SessionsService {
  constructor(private readonly em: EntityManager) {}

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const tokens = await this.em.find(
      RefreshToken,
      {
        user: userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { orderBy: { createdAt: 'DESC' } },
    );

    return tokens.map((t) => ({
      id: t.id,
      familyId: t.familyId,
      ipAddress: t.ipAddress,
      userAgent: t.userAgent,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const token = await this.em.findOne(
      RefreshToken,
      { id: sessionId },
      { populate: ['user'] },
    );

    if (!token) {
      throw new NotFoundException('Session not found');
    }

    if (token.user.id !== userId) {
      throw new ForbiddenException('You do not own this session');
    }

    token.revokedAt = new Date();
    await this.em.flush();
  }
}
