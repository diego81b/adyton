import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { RecoveryService } from './recovery.service';
import { AuditAction } from '../entities/audit-log.entity';

// ---- Hand-rolled DI mocks ---------------------------------------------------

const mockEm = {
  findOne: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  create: jest.fn(),
  getReference: jest.fn(),
  nativeDelete: jest.fn(),
};

const mockAuditService = {
  persistLog: jest.fn(),
  log: jest.fn(),
};

const mockRedis = {
  incr: jest.fn(),
  expire: jest.fn(),
};

// ---- Fixtures ---------------------------------------------------------------

const USER_ID = 'user-uuid-1';
const IP = '127.0.0.1';
const UA = 'test-agent';

const SETUP_DTO = {
  recoverySalt: 'salt-base64',
  recoveryWrappedVaultKey: 'wrapped-vault-key-base64',
  wrapIv: 'iv-base64-24chars!!',
};

function makeKit(overrides: Partial<{
  recoverySalt: string;
  recoveryWrappedVaultKey: string;
  wrapIv: string;
  confirmedAt: Date;
  revokedAt: Date | null;
}> = {}) {
  return {
    recoverySalt: SETUP_DTO.recoverySalt,
    recoveryWrappedVaultKey: SETUP_DTO.recoveryWrappedVaultKey,
    wrapIv: SETUP_DTO.wrapIv,
    confirmedAt: new Date('2026-06-28T10:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

// ---- Tests ------------------------------------------------------------------

describe('RecoveryService', () => {
  let service: RecoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEm.flush.mockResolvedValue(undefined);
    mockEm.create.mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    );
    mockEm.getReference.mockImplementation((_entity: unknown, id: string) => ({ id }));
    mockEm.nativeDelete.mockResolvedValue(1);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    service = new RecoveryService(
      mockEm as never,
      mockAuditService as never,
      mockRedis as never,
    );
  });

  // --------------------------------------------------------------------------
  describe('setup', () => {
    it('creates a new kit when none exists', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await service.setup(USER_ID, SETUP_DTO, IP, UA);

      expect(mockEm.persist).toHaveBeenCalledTimes(1);
      const created = mockEm.create.mock.calls[0][1] as Record<string, unknown>;
      expect(created.recoverySalt).toBe(SETUP_DTO.recoverySalt);
      expect(created.recoveryWrappedVaultKey).toBe(SETUP_DTO.recoveryWrappedVaultKey);
      expect(created.wrapIv).toBe(SETUP_DTO.wrapIv);
      expect(created.revokedAt).toBeNull();
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        USER_ID,
        AuditAction.PAK_RECOVERY_KIT_CREATED,
        IP,
        UA,
      );
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });

    it('overwrites an existing kit without creating a second row', async () => {
      const existing = makeKit();
      mockEm.findOne.mockResolvedValue(existing);

      const newDto = {
        recoverySalt: 'new-salt',
        recoveryWrappedVaultKey: 'new-wrapped-key',
        wrapIv: 'new-iv-24chars!!!!!',
      };
      await service.setup(USER_ID, newDto, IP, UA);

      expect(mockEm.persist).not.toHaveBeenCalled();
      expect(existing.recoverySalt).toBe('new-salt');
      expect(existing.recoveryWrappedVaultKey).toBe('new-wrapped-key');
      expect(existing.wrapIv).toBe('new-iv-24chars!!!!!');
      expect(existing.revokedAt).toBeNull();
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  describe('revoke', () => {
    it('deletes the kit when one exists and emits audit log', async () => {
      mockEm.findOne.mockResolvedValue(makeKit());

      await service.revoke(USER_ID, IP, UA);

      expect(mockEm.nativeDelete).toHaveBeenCalledWith(expect.anything(), { user: USER_ID });
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        USER_ID,
        AuditAction.PAK_RECOVERY_KIT_REVOKED,
        IP,
        UA,
      );
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when no kit exists (still emits audit log and flushes)', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await service.revoke(USER_ID, IP, UA);

      expect(mockEm.nativeDelete).not.toHaveBeenCalled();
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        USER_ID,
        AuditAction.PAK_RECOVERY_KIT_REVOKED,
        IP,
        UA,
      );
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  describe('getStatus', () => {
    it('returns hasKit: false when no kit exists', async () => {
      mockEm.findOne.mockResolvedValue(null);

      const result = await service.getStatus(USER_ID);

      expect(result).toEqual({ hasKit: false });
    });

    it('returns hasKit: true with confirmedAt ISO string when kit exists', async () => {
      mockEm.findOne.mockResolvedValue(makeKit());

      const result = await service.getStatus(USER_ID);

      expect(result.hasKit).toBe(true);
      expect(result.confirmedAt).toBe('2026-06-28T10:00:00.000Z');
    });
  });

  // --------------------------------------------------------------------------
  describe('getVaultKey', () => {
    it('returns the three base64 fields and emits audit log', async () => {
      mockEm.findOne.mockResolvedValue(makeKit());

      const result = await service.getVaultKey(USER_ID, IP, UA);

      expect(result).toEqual({
        recoverySalt: SETUP_DTO.recoverySalt,
        recoveryWrappedVaultKey: SETUP_DTO.recoveryWrappedVaultKey,
        wrapIv: SETUP_DTO.wrapIv,
      });
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        USER_ID,
        AuditAction.PAK_RECOVERY_KIT_USED,
        IP,
        UA,
      );
    });

    it('throws NotFoundException when no kit exists', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(
        service.getVaultKey(USER_ID, IP, UA),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 429 HttpException when rate limit is exceeded', async () => {
      mockRedis.incr.mockResolvedValue(4);

      let caught: unknown;
      try {
        await service.getVaultKey(USER_ID, IP, UA);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(mockEm.findOne).not.toHaveBeenCalled();
    });

    it('sets expire only on the first call (count === 1)', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockEm.findOne.mockResolvedValue(makeKit());

      await service.getVaultKey(USER_ID, IP, UA);

      expect(mockRedis.expire).toHaveBeenCalledWith(`recovery_vault_key:${USER_ID}`, 3600);
    });

    it('sets expire on every call to prevent permanent lockout on Redis crash', async () => {
      mockRedis.incr.mockResolvedValue(2);
      mockEm.findOne.mockResolvedValue(makeKit());

      await service.getVaultKey(USER_ID, IP, UA);

      expect(mockRedis.expire).toHaveBeenCalledWith(`recovery_vault_key:${USER_ID}`, 3600);
    });
  });
});
