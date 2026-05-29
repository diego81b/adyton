import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SessionsService } from './sessions.service';
import { RefreshToken } from '../entities/refresh-token.entity';
import { User } from '../entities/user.entity';

function makeUser(id: string): User {
  return { id } as unknown as User;
}

function makeToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'token-id-1',
    familyId: 'family-1',
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    tokenHash: 'hash',
    user: makeUser('user-id-1'),
    ...overrides,
  } as unknown as RefreshToken;
}

describe('SessionsService', () => {
  let service: SessionsService;
  let mockEm: jest.Mocked<Pick<EntityManager, 'find' | 'findOne' | 'flush'>>;

  beforeEach(() => {
    mockEm = {
      find: jest.fn(),
      findOne: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    };
    service = new SessionsService(mockEm as unknown as EntityManager);
  });

  // ---------------------------------------------------------------------------
  describe('listSessions', () => {
    it('returns mapped sessions for the requesting user (newest first)', async () => {
      const t1 = makeToken({ id: 'token-1', createdAt: new Date('2026-01-02T00:00:00Z') });
      const t2 = makeToken({ id: 'token-2', createdAt: new Date('2026-01-01T00:00:00Z') });
      mockEm.find.mockResolvedValue([t1, t2]);

      const result = await service.listSessions('user-id-1');

      expect(mockEm.find).toHaveBeenCalledWith(
        RefreshToken,
        {
          user: 'user-id-1',
          revokedAt: null,
          expiresAt: { $gt: expect.any(Date) },
        },
        { orderBy: { createdAt: 'DESC' } },
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: t1.id,
        familyId: t1.familyId,
        ipAddress: t1.ipAddress,
        userAgent: t1.userAgent,
        createdAt: t1.createdAt,
        expiresAt: t1.expiresAt,
      });
      // tokenHash must not appear in any result
      expect(result[0]).not.toHaveProperty('tokenHash');
    });

    it('does not return tokens belonging to other users — find is called with the correct userId', async () => {
      mockEm.find.mockResolvedValue([]);

      const result = await service.listSessions('user-id-2');

      const callArgs = mockEm.find.mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs['user']).toBe('user-id-2');
      expect(result).toHaveLength(0);
    });

    it('returns empty array when no active sessions exist', async () => {
      mockEm.find.mockResolvedValue([]);
      const result = await service.listSessions('user-id-1');
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('revokeSession', () => {
    it('sets revokedAt and flushes on success', async () => {
      const token = makeToken({ id: 'token-1', user: makeUser('user-id-1') });
      mockEm.findOne.mockResolvedValue(token);

      await service.revokeSession('user-id-1', 'token-1');

      expect(mockEm.findOne).toHaveBeenCalledWith(
        RefreshToken,
        { id: 'token-1' },
        { populate: ['user'] },
      );
      expect(token.revokedAt).toBeInstanceOf(Date);
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when session does not exist', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(service.revokeSession('user-id-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockEm.flush).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when session belongs to a different user', async () => {
      const token = makeToken({ id: 'token-1', user: makeUser('user-id-OTHER') });
      mockEm.findOne.mockResolvedValue(token);

      await expect(service.revokeSession('user-id-1', 'token-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(token.revokedAt).toBeNull();
      expect(mockEm.flush).not.toHaveBeenCalled();
    });
  });
});
