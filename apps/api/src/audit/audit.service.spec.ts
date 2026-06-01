import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { AuditAction } from '../entities/audit-log.entity';
import { EntityManager } from '@mikro-orm/core';

describe('AuditService', () => {
  let service: AuditService;
  let mockCreate: jest.Mock;
  let mockPersist: jest.Mock;
  let mockFlush: jest.Mock;
  let mockGetReference: jest.Mock;

  beforeEach(async () => {
    mockCreate = jest.fn().mockImplementation((_, data) => ({ ...data }));
    mockPersist = jest.fn();
    mockFlush = jest.fn().mockResolvedValue(undefined);
    mockGetReference = jest.fn().mockImplementation((_, id) => ({ id }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: EntityManager,
          useValue: {
            create: mockCreate,
            persist: mockPersist,
            flush: mockFlush,
            getReference: mockGetReference,
          },
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe('persistLog', () => {
    it('creates and persists an audit log with user reference', () => {
      service.persistLog('user-123', AuditAction.VAULT_CREATE, '127.0.0.1', 'TestAgent', {
        entryId: 'entry-abc',
      });

      expect(mockGetReference).toHaveBeenCalledWith(expect.anything(), 'user-123');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: AuditAction.VAULT_CREATE,
          ipAddress: '127.0.0.1',
          userAgent: 'TestAgent',
          metadata: { entryId: 'entry-abc' },
        }),
      );
      expect(mockPersist).toHaveBeenCalled();
    });

    it('persists log with null user for failed login attempt', () => {
      service.persistLog(null, AuditAction.LOGIN_FAILURE, '10.0.0.1', 'Bot/1.0');

      expect(mockGetReference).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ user: null, action: AuditAction.LOGIN_FAILURE }),
      );
    });

    it('truncates ipAddress to 45 chars', () => {
      const longIp = 'a'.repeat(100);
      service.persistLog('user-1', AuditAction.LOGIN_SUCCESS, longIp, 'UA');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ipAddress: longIp.slice(0, 45) }),
      );
    });

    it('truncates userAgent to 512 chars', () => {
      const longUa = 'B'.repeat(600);
      service.persistLog('user-1', AuditAction.LOGOUT, '1.1.1.1', longUa);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userAgent: longUa.slice(0, 512) }),
      );
    });
  });

  describe('log', () => {
    it('persists and flushes audit log', async () => {
      await service.log('user-1', AuditAction.VAULT_READ, '1.2.3.4', 'Chrome/120');

      expect(mockPersist).toHaveBeenCalled();
      expect(mockFlush).toHaveBeenCalled();
    });

    it('resolves without error on flush', async () => {
      await expect(
        service.log('user-1', AuditAction.VAULT_DELETE, '1.1.1.1', 'Mozilla'),
      ).resolves.toBeUndefined();
    });
  });
});
