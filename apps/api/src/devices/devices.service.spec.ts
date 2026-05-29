import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { TrustedDevice } from '../entities/trusted-device.entity';

// ---- Mocks ----------------------------------------------------------------

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  getReference: jest.fn(),
};

const mockCryptoService = {
  generateDeviceId: jest.fn().mockReturnValue('raw-device-id'),
  hashToken: jest.fn().mockImplementation((raw: string) => `hash-of-${raw}`),
};

const mockRedis = {
  get: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  setex: jest.fn().mockResolvedValue('OK'),
};

// ---- Helpers ---------------------------------------------------------------

function makeDevice(overrides: Partial<{
  id: string;
  user: { id: string };
  userAgent: string;
  ipAddress: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}> = {}): TrustedDevice {
  return {
    id: 'device-uuid-1',
    user: { id: 'user-uuid-1' } as never,
    userAgent: 'Mozilla/5.0',
    ipAddress: '127.0.0.1',
    lastSeenAt: null,
    revokedAt: null,
    createdAt: new Date(),
    deviceIdHash: 'hash-of-raw-device-id',
    ...overrides,
  } as TrustedDevice;
}

// ---- Tests -----------------------------------------------------------------

describe('DevicesService', () => {
  let service: DevicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data }));
    mockEm.flush.mockResolvedValue(undefined);
    mockEm.getReference.mockImplementation((_entity: unknown, id: string) => ({ id }));

    service = new DevicesService(
      mockEm as never,
      mockCryptoService as never,
      mockRedis as never,
    );
  });

  // --------------------------------------------------------------------------
  describe('listDevices', () => {
    it('returns non-revoked devices for user ordered by newest first', async () => {
      const devices = [makeDevice({ id: 'dev-2' }), makeDevice({ id: 'dev-1' })];
      mockEm.find.mockResolvedValue(devices);

      const result = await service.listDevices('user-uuid-1');

      expect(result).toBe(devices);
      expect(mockEm.find).toHaveBeenCalledWith(
        TrustedDevice,
        { user: { id: 'user-uuid-1' }, revokedAt: null },
        { orderBy: { createdAt: 'DESC' } },
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('registerDevice', () => {
    it('success: consumes Redis key, creates device row, returns rawDeviceId', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');

      const result = await service.registerDevice(
        'user-uuid-1',
        'valid-otp',
        'Mozilla/5.0',
        '127.0.0.1',
      );

      expect(mockRedis.get).toHaveBeenCalledWith('device_otp:valid-otp');
      expect(mockRedis.del).toHaveBeenCalledWith('device_otp:valid-otp');
      expect(mockCryptoService.generateDeviceId).toHaveBeenCalledTimes(1);
      expect(mockCryptoService.hashToken).toHaveBeenCalledWith('raw-device-id');
      expect(mockEm.persist).toHaveBeenCalledTimes(1);
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
      expect(result).toBe('raw-device-id');
    });

    it('throws BadRequestException when OTP is expired / missing', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(
        service.registerDevice('user-uuid-1', 'expired-otp', 'agent', '1.2.3.4'),
      ).rejects.toThrow(BadRequestException);

      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(mockEm.flush).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when OTP belongs to a different user', async () => {
      mockRedis.get.mockResolvedValue('other-user-uuid');

      await expect(
        service.registerDevice('user-uuid-1', 'foreign-otp', 'agent', '1.2.3.4'),
      ).rejects.toThrow(BadRequestException);

      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  describe('revokeDevice', () => {
    it('success: sets revokedAt and flushes', async () => {
      const device = makeDevice({ user: { id: 'user-uuid-1' } as never });
      mockEm.findOne.mockResolvedValue(device);

      await service.revokeDevice('user-uuid-1', 'device-uuid-1');

      expect(device.revokedAt).toBeInstanceOf(Date);
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when device does not exist', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(service.revokeDevice('user-uuid-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when device belongs to a different user', async () => {
      const device = makeDevice({ user: { id: 'other-user' } as never });
      mockEm.findOne.mockResolvedValue(device);

      await expect(service.revokeDevice('user-uuid-1', 'device-uuid-1')).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockEm.flush).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  describe('revokeAllDevices', () => {
    it('success: sets revokedAt on all non-revoked devices and flushes', async () => {
      const devices = [makeDevice({ id: 'dev-1' }), makeDevice({ id: 'dev-2' })];
      mockEm.find.mockResolvedValue(devices);

      await service.revokeAllDevices('user-uuid-1');

      expect(devices[0].revokedAt).toBeInstanceOf(Date);
      expect(devices[1].revokedAt).toBeInstanceOf(Date);
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });

    it('flushes even when no devices exist', async () => {
      mockEm.find.mockResolvedValue([]);

      await service.revokeAllDevices('user-uuid-1');

      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });
  });
});
