import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { PakService } from './pak.service';
import { AuditAction } from '../entities/audit-log.entity';
import { PakEnrollmentMethod, PakPlatform, PakRevocationReason } from '../entities/device-vault-key.entity';

// ---- Hand-rolled DI mocks ---------------------------------------------------

const mockEm = {
  findOne: jest.fn(),
  find: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  create: jest.fn(),
  getReference: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
  persistLog: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  getdel: jest.fn(),
  setex: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
};

const mockEmailNotifier = {
  sendNewDeviceAlert: jest.fn(),
  sendPakDeviceEnrolledAlert: jest.fn(),
};

// ---- Fixtures ---------------------------------------------------------------

const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-2';
const SESSION_ID = '00000000-0000-4000-a000-000000000001';
const DEVICE_ID = 'device-uuid-1';

const VALID_CHALLENGE = 'a'.repeat(64); // 64-char hex

function makeDevice(overrides: Partial<{
  id: string;
  deviceName: string;
  platform: PakPlatform;
  enrollmentMethod: PakEnrollmentMethod;
  enrolledAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  revokedReason: PakRevocationReason | null;
  publicKeyFingerprint: string;
  devicePublicKey: string;
  reCipherCompleted: boolean;
}> = {}) {
  return {
    id: DEVICE_ID,
    user: { id: USER_ID } as never,
    deviceName: 'Test Phone',
    platform: PakPlatform.ANDROID,
    enrollmentMethod: PakEnrollmentMethod.MASTER_PASSWORD,
    enrolledAt: new Date('2026-01-01T00:00:00.000Z'),
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    revokedReason: null,
    publicKeyFingerprint: 'fp-hex-64-chars-' + 'a'.repeat(48),
    devicePublicKey: 'base64-spki-key',
    reCipherCompleted: false,
    ...overrides,
  };
}

function makeEnrollDto(overrides: Partial<{
  devicePublicKeySpki: string;
  deviceName: string;
  platform: string;
  enrollmentMethod: string;
  enrollmentEphemeralPub: string;
  signature: string;
  enrollmentSessionId: string;
}> = {}) {
  return {
    devicePublicKeySpki: 'base64-spki-key',
    deviceName: 'Test Phone',
    platform: 'android',
    enrollmentMethod: 'master_password',
    enrollmentEphemeralPub: 'ephemeral-pub',
    signature: 'sig-hex',
    ...overrides,
  };
}

function makeRelayPayload() {
  return {
    phoneEphemeralPub: 'phone-eph-pub',
    ciphertext: 'cipher',
    iv: 'ivhex',
    deviceId: 'dev-uuid',
    signature: 'sig',
  };
}

// ---- Tests ------------------------------------------------------------------

describe('PakService', () => {
  let service: PakService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEm.flush.mockResolvedValue(undefined);
    mockEm.create.mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ id: DEVICE_ID, ...data }),
    );
    mockEm.getReference.mockImplementation((_entity: unknown, id: string) => ({ id }));
    mockEm.findOne.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.ttl.mockResolvedValue(45);
    mockRedis.incr.mockResolvedValue(1); // default: first enrollment attempt
    mockRedis.expire.mockResolvedValue(1);
    mockEmailNotifier.sendPakDeviceEnrolledAlert.mockResolvedValue(undefined);

    service = new PakService(
      mockEm as never,
      mockAuditService as never,
      mockRedis as never,
      mockEmailNotifier as never,
    );
  });

  // --------------------------------------------------------------------------
  describe('issueQrSession', () => {
    it('throws ConflictException for a non-64-char challengeHex', async () => {
      await expect(
        service.issueQrSession('spki-key', 'tooshort'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException for challengeHex with non-hex chars', async () => {
      await expect(
        service.issueQrSession('spki-key', 'z'.repeat(64)),
      ).rejects.toThrow(ConflictException);
    });

    it('stores a QR session in Redis with 60s TTL and returns sessionId', async () => {
      const result = await service.issueQrSession('spki-key', VALID_CHALLENGE);

      expect(result.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('pak_qr:'),
        60,
        expect.stringContaining(VALID_CHALLENGE),
      );
      const stored = JSON.parse(mockRedis.setex.mock.calls[0][2] as string);
      expect(stored.desktopPublicKeySpki).toBe('spki-key');
      expect(stored.challengeHex).toBe(VALID_CHALLENGE);
      expect(stored.consumed).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  describe('pollQrSession', () => {
    it('returns expired when Redis has no key', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.pollQrSession(SESSION_ID);

      expect(result.status).toBe('expired');
    });

    it('returns approved and deletes both keys when a payload is present', async () => {
      const session = JSON.stringify({ desktopPublicKeySpki: 'k', challengeHex: VALID_CHALLENGE, createdAt: Date.now(), consumed: false });
      const payload = JSON.stringify(makeRelayPayload());
      mockRedis.get.mockImplementation((key: string) => {
        if (key.startsWith('pak_qr:')) return Promise.resolve(session);
        if (key.startsWith('pak_qr_payload:')) return Promise.resolve(payload);
        return Promise.resolve(null);
      });

      const result = await service.pollQrSession(SESSION_ID);

      expect(result.status).toBe('approved');
      expect(result.phoneEphemeralPub).toBe('phone-eph-pub');
      expect(result.ciphertext).toBe('cipher');
      expect(mockRedis.del).toHaveBeenCalledWith(
        `pak_qr:${SESSION_ID}`,
        `pak_qr_payload:${SESSION_ID}`,
      );
    });

    it('returns denied when session exists, no payload, but consumed=true', async () => {
      const session = JSON.stringify({ desktopPublicKeySpki: 'k', challengeHex: VALID_CHALLENGE, createdAt: Date.now(), consumed: true });
      mockRedis.get.mockImplementation((key: string) => {
        if (key.startsWith('pak_qr:')) return Promise.resolve(session);
        return Promise.resolve(null);
      });

      const result = await service.pollQrSession(SESSION_ID);

      expect(result.status).toBe('denied');
    });

    it('returns pending when session exists, no payload, consumed=false', async () => {
      const session = JSON.stringify({ desktopPublicKeySpki: 'k', challengeHex: VALID_CHALLENGE, createdAt: Date.now(), consumed: false });
      mockRedis.get.mockImplementation((key: string) => {
        if (key.startsWith('pak_qr:')) return Promise.resolve(session);
        return Promise.resolve(null);
      });

      const result = await service.pollQrSession(SESSION_ID);

      expect(result.status).toBe('pending');
    });
  });

  // --------------------------------------------------------------------------
  describe('submitRelayPayload', () => {
    it('throws NotFoundException when the QR session does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(
        service.submitRelayPayload(SESSION_ID, makeRelayPayload(), USER_ID, '1.2.3.4', 'test-ua'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the session is already consumed', async () => {
      const session = JSON.stringify({ desktopPublicKeySpki: 'k', challengeHex: VALID_CHALLENGE, createdAt: Date.now(), consumed: true });
      mockRedis.get.mockResolvedValue(session);

      await expect(
        service.submitRelayPayload(SESSION_ID, makeRelayPayload(), USER_ID, '1.2.3.4', 'test-ua'),
      ).rejects.toThrow(ConflictException);
    });

    it('marks the session consumed and stores the payload with 30s TTL', async () => {
      const session = JSON.stringify({ desktopPublicKeySpki: 'k', challengeHex: VALID_CHALLENGE, createdAt: Date.now(), consumed: false });
      mockRedis.get.mockResolvedValue(session);
      mockRedis.ttl.mockResolvedValue(45);
      // device lookup returns null — non-fatal
      mockEm.findOne.mockResolvedValueOnce(null);

      await service.submitRelayPayload(SESSION_ID, makeRelayPayload(), USER_ID, '1.2.3.4', 'test-ua');

      // The session should be updated with consumed=true
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `pak_qr:${SESSION_ID}`,
        45,
        expect.stringContaining('"consumed":true'),
      );
      // The payload should be stored with 30s TTL
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `pak_qr_payload:${SESSION_ID}`,
        30,
        expect.stringContaining('phone-eph-pub'),
      );
    });

    it('logs PAK_QR_APPROVED audit event on success', async () => {
      const session = JSON.stringify({ desktopPublicKeySpki: 'spki', challengeHex: 'a'.repeat(64), createdAt: Date.now(), consumed: false });
      mockRedis.get.mockResolvedValueOnce(session);
      mockRedis.ttl.mockResolvedValueOnce(45);
      mockEm.findOne.mockResolvedValueOnce(null); // device lookup returns null — non-fatal

      await service.submitRelayPayload(SESSION_ID, makeRelayPayload(), USER_ID, '1.2.3.4', 'ua');

      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        USER_ID,
        AuditAction.PAK_QR_APPROVED,
        '1.2.3.4',
        'ua',
        expect.objectContaining({ deviceId: expect.any(String) }),
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('cancelQrSession', () => {
    it('deletes both the session and payload keys', async () => {
      await service.cancelQrSession(SESSION_ID);

      expect(mockRedis.del).toHaveBeenCalledWith(
        `pak_qr:${SESSION_ID}`,
        `pak_qr_payload:${SESSION_ID}`,
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('enrollDevice', () => {
    it('throws ConflictException when fingerprint already exists', async () => {
      // first findOne = duplicate device found; second = user email lookup (irrelevant, won't reach it)
      mockEm.findOne.mockResolvedValueOnce(makeDevice());

      await expect(
        service.enrollDevice(USER_ID, makeEnrollDto(), '127.0.0.1', 'ua'),
      ).rejects.toThrow(ConflictException);
      expect(mockEm.persist).not.toHaveBeenCalled();
    });

    it('creates the device, audits PAK_DEVICE_ENROLLED, flushes, and returns the entity', async () => {
      // first findOne = no duplicate; second findOne = user email lookup
      mockEm.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ email: 'test@adyton.test' });

      const device = await service.enrollDevice(USER_ID, makeEnrollDto(), '127.0.0.1', 'agent');

      expect(mockEm.persist).toHaveBeenCalledTimes(1);
      const created = mockEm.create.mock.calls[0][1] as Record<string, unknown>;
      expect(created.devicePublicKey).toBe('base64-spki-key');
      // Fingerprint must be server-derived (64-char hex), never the client-supplied value
      expect(created.publicKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(created.enrollmentMethod).toBe(PakEnrollmentMethod.MASTER_PASSWORD);
      expect(created.platform).toBe(PakPlatform.ANDROID);
      expect(created.revokedAt).toBeNull();

      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        USER_ID,
        AuditAction.PAK_DEVICE_ENROLLED,
        '127.0.0.1',
        'agent',
        { deviceName: 'Test Phone', platform: 'android', enrollmentMethod: 'master_password' },
      );
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
      expect(device.id).toBe(DEVICE_ID);
      expect(mockEmailNotifier.sendPakDeviceEnrolledAlert).toHaveBeenCalledWith(
        'test@adyton.test',
        'Test Phone',
        '127.0.0.1',
        'agent',
      );
    });

    it('stores pak_enroll_phone when enrollmentSessionId is provided', async () => {
      // first findOne = no duplicate; second = user email lookup
      mockEm.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const dto = makeEnrollDto({ enrollmentSessionId: SESSION_ID });

      await service.enrollDevice(USER_ID, dto, '127.0.0.1', 'ua');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `pak_enroll_phone:${SESSION_ID}`,
        300,
        expect.stringContaining(USER_ID),
      );
      const stored = JSON.parse(
        mockRedis.setex.mock.calls.find(
          (c: string[]) => c[0] === `pak_enroll_phone:${SESSION_ID}`,
        )[2] as string,
      );
      expect(stored.userId).toBe(USER_ID);
      expect(stored.deviceId).toBe(DEVICE_ID);
      expect(stored.phoneEphemeralPub).toBe('ephemeral-pub');
    });

    it('does not touch ENROLL_PHONE key when enrollmentSessionId is absent', async () => {
      // first findOne = no duplicate; second = user email lookup
      mockEm.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await service.enrollDevice(USER_ID, makeEnrollDto(), '127.0.0.1', 'ua');

      const enrollPhoneCall = mockRedis.setex.mock.calls.find(
        (c: string[]) => c[0].startsWith('pak_enroll_phone:'),
      );
      expect(enrollPhoneCall).toBeUndefined();
    });

    it('throws 429 when enrollment rate limit is exceeded', async () => {
      mockRedis.incr.mockResolvedValue(6); // exceeds ENROLL_RATE_LIMIT=5

      await expect(
        service.enrollDevice(USER_ID, makeEnrollDto(), '127.0.0.1', 'ua'),
      ).rejects.toThrow(HttpException);
    });

    it('does not send email alert when user entity is not found', async () => {
      // first findOne = no duplicate; second = user email lookup returns null
      mockEm.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await service.enrollDevice(USER_ID, makeEnrollDto(), '127.0.0.1', 'ua');

      expect(mockEmailNotifier.sendPakDeviceEnrolledAlert).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  describe('listDevices', () => {
    it('queries only non-revoked devices ordered by enrolledAt', async () => {
      mockEm.find.mockResolvedValue([makeDevice()]);

      const result = await service.listDevices(USER_ID);

      expect(mockEm.find).toHaveBeenCalledWith(
        expect.anything(),
        { user: USER_ID, revokedAt: null },
        { orderBy: { enrolledAt: 'ASC' } },
      );
      expect(result).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  describe('revokeDevice', () => {
    it('throws NotFoundException when device does not belong to user', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(
        service.revokeDevice(USER_ID, DEVICE_ID, 'safe', '127.0.0.1', 'ua'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when device is already revoked', async () => {
      mockEm.findOne.mockResolvedValue(makeDevice({ revokedAt: new Date() }));

      await expect(
        service.revokeDevice(USER_ID, DEVICE_ID, 'safe', '127.0.0.1', 'ua'),
      ).rejects.toThrow(ConflictException);
    });

    it('sets revokedAt + revokedReason, audits PAK_DEVICE_REVOKED', async () => {
      const device = makeDevice();
      mockEm.findOne.mockResolvedValue(device);

      await service.revokeDevice(USER_ID, DEVICE_ID, 'compromised', '127.0.0.1', 'agent');

      expect(device.revokedAt).toBeInstanceOf(Date);
      expect(device.revokedReason).toBe(PakRevocationReason.COMPROMISED);
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        USER_ID,
        AuditAction.PAK_DEVICE_REVOKED,
        '127.0.0.1',
        'agent',
        { deviceName: 'Test Phone', reason: 'compromised' },
      );
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });

    it('uses safe reason by default', async () => {
      const device = makeDevice();
      mockEm.findOne.mockResolvedValue(device);

      await service.revokeDevice(USER_ID, DEVICE_ID, 'safe', '127.0.0.1', 'ua');

      expect(device.revokedReason).toBe(PakRevocationReason.SAFE);
    });
  });

  // --------------------------------------------------------------------------
  describe('renameDevice', () => {
    it('throws NotFoundException when device does not exist', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(
        service.renameDevice(USER_ID, DEVICE_ID, { deviceName: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates deviceName, flushes, and returns the updated device', async () => {
      const device = makeDevice();
      mockEm.findOne.mockResolvedValue(device);

      const result = await service.renameDevice(USER_ID, DEVICE_ID, { deviceName: 'Renamed Phone' });

      expect(device.deviceName).toBe('Renamed Phone');
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
      expect(result.deviceName).toBe('Renamed Phone');
    });
  });

  // --------------------------------------------------------------------------
  describe('toDeviceResponse', () => {
    it('maps all expected fields and never leaks devicePublicKey', () => {
      const device = makeDevice();
      const dto = service.toDeviceResponse(device);

      expect(Object.keys(dto).sort()).toEqual([
        'deviceName', 'enrolledAt', 'enrollmentMethod',
        'id', 'lastUsedAt', 'platform', 'publicKeyFingerprint', 'revokedAt',
      ].sort());
      expect('devicePublicKey' in dto).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  describe('issueEnrollSession', () => {
    it('throws ConflictException for a short challengeHex', async () => {
      await expect(
        service.issueEnrollSession('spki-key', 'tooshort'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException for non-hex challengeHex', async () => {
      await expect(
        service.issueEnrollSession('spki-key', 'z'.repeat(64)),
      ).rejects.toThrow(ConflictException);
    });

    it('stores session in Redis with 300s TTL and returns {sessionId, ttlSeconds:300}', async () => {
      const result = await service.issueEnrollSession('spki-key', VALID_CHALLENGE);

      expect(result.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.ttlSeconds).toBe(300);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `pak_enroll:${result.sessionId}`,
        300,
        expect.stringContaining(VALID_CHALLENGE),
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('getEnrollStatus', () => {
    it('returns {status:"waiting"} when session key is missing', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getEnrollStatus(SESSION_ID);

      expect(result.status).toBe('waiting');
    });

    it('returns {status:"waiting"} when session exists but phone has not connected', async () => {
      const session = JSON.stringify({ desktopPublicKeySpki: 'k', challengeHex: VALID_CHALLENGE, createdAt: Date.now() });
      mockRedis.get.mockImplementation((key: string) => {
        if (key === `pak_enroll:${SESSION_ID}`) return Promise.resolve(session);
        return Promise.resolve(null);
      });

      const result = await service.getEnrollStatus(SESSION_ID);

      expect(result.status).toBe('waiting');
      expect(result.phoneEphemeralPub).toBeUndefined();
    });

    it('returns {status:"phone_ready", phoneEphemeralPub, deviceId} when phone has connected', async () => {
      const session = JSON.stringify({ desktopPublicKeySpki: 'k', challengeHex: VALID_CHALLENGE, createdAt: Date.now() });
      const phoneData = JSON.stringify({ phoneEphemeralPub: 'phone-eph', deviceId: DEVICE_ID, userId: USER_ID });
      mockRedis.get.mockImplementation((key: string) => {
        if (key === `pak_enroll:${SESSION_ID}`) return Promise.resolve(session);
        if (key === `pak_enroll_phone:${SESSION_ID}`) return Promise.resolve(phoneData);
        return Promise.resolve(null);
      });

      const result = await service.getEnrollStatus(SESSION_ID);

      expect(result.status).toBe('phone_ready');
      expect(result.phoneEphemeralPub).toBe('phone-eph');
      expect(result.deviceId).toBe(DEVICE_ID);
    });
  });

  // --------------------------------------------------------------------------
  describe('submitEnrollVault', () => {
    const vaultDto = { ciphertext: 'ct-base64', iv: 'iv-base64' };

    it('throws NotFoundException when ENROLL_PHONE key is missing', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(
        service.submitEnrollVault(SESSION_ID, USER_ID, vaultDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when userId does not match phoneData.userId', async () => {
      const phoneData = JSON.stringify({ phoneEphemeralPub: 'pub', deviceId: DEVICE_ID, userId: OTHER_USER_ID });
      mockRedis.get.mockImplementation((key: string) => {
        if (key === `pak_enroll_phone:${SESSION_ID}`) return Promise.resolve(phoneData);
        return Promise.resolve(null);
      });

      await expect(
        service.submitEnrollVault(SESSION_ID, USER_ID, vaultDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when ENROLL_VAULT already exists', async () => {
      const phoneData = JSON.stringify({ phoneEphemeralPub: 'pub', deviceId: DEVICE_ID, userId: USER_ID });
      const existingVault = JSON.stringify({ ciphertext: 'old-ct', iv: 'old-iv' });
      mockRedis.get.mockImplementation((key: string) => {
        if (key === `pak_enroll_phone:${SESSION_ID}`) return Promise.resolve(phoneData);
        if (key === `pak_enroll_vault:${SESSION_ID}`) return Promise.resolve(existingVault);
        return Promise.resolve(null);
      });

      await expect(
        service.submitEnrollVault(SESSION_ID, USER_ID, vaultDto),
      ).rejects.toThrow(ConflictException);
    });

    it('stores ciphertext+iv with 60s TTL on success', async () => {
      const phoneData = JSON.stringify({ phoneEphemeralPub: 'pub', deviceId: DEVICE_ID, userId: USER_ID });
      mockRedis.get.mockImplementation((key: string) => {
        if (key === `pak_enroll_phone:${SESSION_ID}`) return Promise.resolve(phoneData);
        return Promise.resolve(null);
      });

      await service.submitEnrollVault(SESSION_ID, USER_ID, vaultDto);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `pak_enroll_vault:${SESSION_ID}`,
        60,
        expect.stringContaining('ct-base64'),
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('getEnrollVault', () => {
    it('throws NotFoundException when ENROLL_PHONE key is missing', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(
        service.getEnrollVault(SESSION_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when userId does not match', async () => {
      const phoneData = JSON.stringify({ phoneEphemeralPub: 'pub', deviceId: DEVICE_ID, userId: OTHER_USER_ID });
      mockRedis.get.mockImplementation((key: string) => {
        if (key === `pak_enroll_phone:${SESSION_ID}`) return Promise.resolve(phoneData);
        return Promise.resolve(null);
      });

      await expect(
        service.getEnrollVault(SESSION_ID, USER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns {status:"waiting"} when vault key not yet submitted', async () => {
      const phoneData = JSON.stringify({ phoneEphemeralPub: 'pub', deviceId: DEVICE_ID, userId: USER_ID });
      mockRedis.get.mockImplementation((key: string) => {
        if (key === `pak_enroll_phone:${SESSION_ID}`) return Promise.resolve(phoneData);
        return Promise.resolve(null);
      });

      const result = await service.getEnrollVault(SESSION_ID, USER_ID);

      expect(result.status).toBe('waiting');
      expect(result.ciphertext).toBeUndefined();
    });

    it('returns {status:"ready", ciphertext, iv} and deletes vault key (single-use)', async () => {
      const phoneData = JSON.stringify({ phoneEphemeralPub: 'pub', deviceId: DEVICE_ID, userId: USER_ID });
      const vaultData = JSON.stringify({ ciphertext: 'ct-base64', iv: 'iv-base64' });
      mockRedis.get.mockImplementation((key: string) => {
        if (key === `pak_enroll_phone:${SESSION_ID}`) return Promise.resolve(phoneData);
        if (key === `pak_enroll_vault:${SESSION_ID}`) return Promise.resolve(vaultData);
        return Promise.resolve(null);
      });

      const result = await service.getEnrollVault(SESSION_ID, USER_ID);

      expect(result.status).toBe('ready');
      expect(result.ciphertext).toBe('ct-base64');
      expect(result.iv).toBe('iv-base64');
      expect(mockRedis.del).toHaveBeenCalledWith(`pak_enroll_vault:${SESSION_ID}`);
    });
  });

  // --------------------------------------------------------------------------
  describe('cancelEnrollSession', () => {
    it('deletes all three Redis keys atomically', async () => {
      await service.cancelEnrollSession(SESSION_ID);

      expect(mockRedis.del).toHaveBeenCalledWith(
        `pak_enroll:${SESSION_ID}`,
        `pak_enroll_phone:${SESSION_ID}`,
        `pak_enroll_vault:${SESSION_ID}`,
      );
    });
  });
});
