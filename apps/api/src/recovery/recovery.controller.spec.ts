import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';

// ---- Mock service -----------------------------------------------------------

const mockRecoveryService = {
  setup: jest.fn(),
  revoke: jest.fn(),
  getStatus: jest.fn(),
  getVaultKey: jest.fn(),
};

// ---- Fixtures ---------------------------------------------------------------

const USER_ID = 'user-uuid-1';
const IP = '10.0.0.1';
const UA = 'test-agent/1.0';

function makeRequest(userId = USER_ID): { user: { userId: string }; ip: string } {
  return { user: { userId }, ip: IP };
}

const SETUP_DTO = {
  recoverySalt: 'salt-base64',
  recoveryWrappedVaultKey: 'wrapped-key-base64',
  wrapIv: 'iv-base64-24chars!!',
};

// ---- Tests ------------------------------------------------------------------

describe('RecoveryController', () => {
  let controller: RecoveryController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RecoveryController(mockRecoveryService as unknown as RecoveryService);
  });

  // --------------------------------------------------------------------------
  describe('POST /auth/recovery/setup', () => {
    it('calls setup and returns void (204)', async () => {
      mockRecoveryService.setup.mockResolvedValue(undefined);

      const result = await controller.setup(SETUP_DTO, makeRequest() as never, UA);

      expect(result).toBeUndefined();
      expect(mockRecoveryService.setup).toHaveBeenCalledWith(USER_ID, SETUP_DTO, IP, UA);
    });
  });

  // --------------------------------------------------------------------------
  describe('DELETE /auth/recovery/setup', () => {
    it('calls revoke and returns void (204)', async () => {
      mockRecoveryService.revoke.mockResolvedValue(undefined);

      const result = await controller.revoke(makeRequest() as never, UA);

      expect(result).toBeUndefined();
      expect(mockRecoveryService.revoke).toHaveBeenCalledWith(USER_ID, IP, UA);
    });
  });

  // --------------------------------------------------------------------------
  describe('GET /auth/recovery/status', () => {
    it('returns hasKit: false when no kit exists', async () => {
      mockRecoveryService.getStatus.mockResolvedValue({ hasKit: false });

      const result = await controller.getStatus(makeRequest() as never);

      expect(result).toEqual({ hasKit: false });
      expect(mockRecoveryService.getStatus).toHaveBeenCalledWith(USER_ID);
    });

    it('returns hasKit: true with confirmedAt when kit exists', async () => {
      mockRecoveryService.getStatus.mockResolvedValue({
        hasKit: true,
        confirmedAt: '2026-06-28T10:00:00.000Z',
      });

      const result = await controller.getStatus(makeRequest() as never);

      expect(result.hasKit).toBe(true);
      expect(result.confirmedAt).toBe('2026-06-28T10:00:00.000Z');
    });
  });

  // --------------------------------------------------------------------------
  describe('GET /auth/recovery/vault-key', () => {
    it('returns vault key fields on success', async () => {
      mockRecoveryService.getVaultKey.mockResolvedValue({
        recoverySalt: 'salt',
        recoveryWrappedVaultKey: 'wrapped',
        wrapIv: 'iv',
      });

      const result = await controller.getVaultKey(makeRequest() as never, UA);

      expect(result).toEqual({ recoverySalt: 'salt', recoveryWrappedVaultKey: 'wrapped', wrapIv: 'iv' });
      expect(mockRecoveryService.getVaultKey).toHaveBeenCalledWith(USER_ID, IP, UA);
    });

    it('propagates NotFoundException from service (404)', async () => {
      mockRecoveryService.getVaultKey.mockRejectedValue(new NotFoundException());

      await expect(
        controller.getVaultKey(makeRequest() as never, UA),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates 429 HttpException from service', async () => {
      const rateLimitErr = new HttpException('rate limited', HttpStatus.TOO_MANY_REQUESTS);
      mockRecoveryService.getVaultKey.mockRejectedValue(rateLimitErr);

      let caught: unknown;
      try {
        await controller.getVaultKey(makeRequest() as never, UA);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });
  });
});
