import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

// ---- Mocks ----------------------------------------------------------------

const mockEm = {
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  nativeUpdate: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-access-token'),
};

const mockCryptoService = {
  hashPassword: jest.fn().mockResolvedValue('$argon2id$hashed'),
  verifyPassword: jest.fn(),
  hashToken: jest.fn().mockImplementation((raw: string) => `hash-of-${raw}`),
  generateKdfSalt: jest.fn().mockReturnValue('aabbccdd'.repeat(8)),
  generateRefreshToken: jest.fn().mockReturnValue('raw-refresh-token'),
  generateDeviceId: jest.fn().mockReturnValue('raw-device-otp'),
};

const mockProgressiveDelay = {
  checkAndDelay: jest.fn().mockResolvedValue(undefined),
  recordFailure: jest.fn().mockResolvedValue(undefined),
  clearFailures: jest.fn().mockResolvedValue(undefined),
};

const mockEmailNotifier = {
  sendNewDeviceAlert: jest.fn().mockResolvedValue(undefined),
};

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
};

const mockChallengeService = {
  issueChallenge: jest.fn(),
  verifyAndConsume: jest.fn().mockResolvedValue(undefined),
};

const mockAuditService = {
  log: jest.fn().mockResolvedValue(undefined),
  persistLog: jest.fn(),
};

// ---- Helpers ---------------------------------------------------------------

function makeUser(overrides: Partial<{ id: string; email: string; passwordHash: string; kdfSalt: string; totpEnabled: boolean }> = {}) {
  return {
    id: 'user-uuid-1',
    email: 'test@example.com',
    passwordHash: '$argon2id$hashed',
    kdfSalt: 'aabbccdd'.repeat(8),
    totpEnabled: false,
    ...overrides,
  };
}

function makeRefreshToken(overrides: Partial<{
  id: string;
  user: ReturnType<typeof makeUser>;
  tokenHash: string;
  familyId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
}> = {}) {
  return {
    id: 'refresh-token-uuid',
    user: makeUser(),
    tokenHash: 'hash-of-raw-refresh-token',
    familyId: 'family-uuid',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test',
    ...overrides,
  };
}

// ---- Tests -----------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset em.create to return a stub object for both User and RefreshToken/TrustedDevice
    mockEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data }));
    mockEm.flush.mockResolvedValue(undefined);
    mockEm.findOne.mockResolvedValue(null);

    service = new AuthService(
      mockEm as never,
      mockJwtService as never,
      mockCryptoService as never,
      mockProgressiveDelay as never,
      mockEmailNotifier as never,
      mockRedis as never,
      mockChallengeService as never,
      mockAuditService as never,
    );
  });

  // --------------------------------------------------------------------------
  describe('register', () => {
    const dto: RegisterDto = { email: 'New@Example.com', password: 'supersecretpass123' };

    it('happy path: returns accessToken + user, calls em.flush()', async () => {
      // First flush succeeds (user insert), second flush succeeds (refresh token)
      mockEm.flush.mockResolvedValue(undefined);
      // em.create for User returns user with id
      mockEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
        id: 'user-uuid-1',
        totpEnabled: false,
        ...data,
      }));
      // findOne for TrustedDevice (no existing device — register passes undefined)
      mockEm.findOne.mockResolvedValue(null);

      const result = await service.register(dto, '127.0.0.1', 'test-agent');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.user.email).toBe('new@example.com'); // lowercased
      expect(result.rawRefreshToken).toBe('raw-refresh-token');
      // newDeviceId is now a Redis OTP, not a DB row
      expect(result.newDeviceId).toBe('raw-device-otp');
      expect(mockEm.flush).toHaveBeenCalledTimes(2);
      expect(mockCryptoService.hashPassword).toHaveBeenCalledWith(dto.password);
      expect(mockCryptoService.generateKdfSalt).toHaveBeenCalledTimes(1);
      // Redis OTP should have been stored
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'device_otp:raw-device-otp',
        600,
        'user-uuid-1',
      );
      // Email alert should have been sent
      expect(mockEmailNotifier.sendNewDeviceAlert).toHaveBeenCalledWith(
        expect.any(String),
        '127.0.0.1',
        'test-agent',
      );
    });

    it('throws ConflictException on duplicate email (unique constraint error)', async () => {
      const uniqueError = Object.assign(new Error('Unique constraint'), { code: '23505' });
      mockEm.flush.mockRejectedValueOnce(uniqueError);

      await expect(service.register(dto, '127.0.0.1', 'test-agent')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException with correct message on duplicate email', async () => {
      const uniqueError = Object.assign(new Error('Unique constraint'), { code: '23505' });
      mockEm.flush.mockRejectedValueOnce(uniqueError);

      await expect(service.register(dto, '127.0.0.1', 'test-agent')).rejects.toThrow(
        'Email already registered',
      );
    });

    it('re-throws non-unique errors', async () => {
      const randomError = new Error('Connection lost');
      mockEm.flush.mockRejectedValueOnce(randomError);

      await expect(service.register(dto, '127.0.0.1', 'test-agent')).rejects.toThrow(
        'Connection lost',
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('login', () => {
    const dto: LoginDto = { email: 'Test@Example.com', password: 'correctpassword123' };
    const user = makeUser({ email: 'test@example.com' });

    it('wrong password: calls recordFailure and throws UnauthorizedException', async () => {
      mockEm.findOne.mockResolvedValue(user);
      mockCryptoService.verifyPassword.mockResolvedValue(false);

      await expect(service.login(dto, '127.0.0.1', 'agent')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockProgressiveDelay.recordFailure).toHaveBeenCalledTimes(1);
      expect(mockProgressiveDelay.clearFailures).not.toHaveBeenCalled();
    });

    it('unknown email: calls recordFailure and throws UnauthorizedException', async () => {
      mockEm.findOne.mockResolvedValue(null); // user not found
      mockCryptoService.verifyPassword.mockResolvedValue(false);

      await expect(service.login(dto, '127.0.0.1', 'agent')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockProgressiveDelay.recordFailure).toHaveBeenCalledTimes(1);
    });

    it('success: calls clearFailures and returns accessToken', async () => {
      mockEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
        id: 'new-id',
        ...data,
      }));
      mockEm.findOne
        .mockResolvedValueOnce(user)   // User lookup
        .mockResolvedValue(null);       // TrustedDevice lookup — unknown device
      mockCryptoService.verifyPassword.mockResolvedValue(true);

      const result = await service.login(dto, '127.0.0.1', 'agent');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.user.email).toBe('test@example.com');
      expect(mockProgressiveDelay.clearFailures).toHaveBeenCalledTimes(1);
      expect(mockProgressiveDelay.recordFailure).not.toHaveBeenCalled();
      // Unknown device → Redis OTP issued
      expect(result.newDeviceId).toBe('raw-device-otp');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'device_otp:raw-device-otp',
        600,
        user.id,
      );
    });

    it('uses lowercase email for lookup', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(service.login(dto, '127.0.0.1', 'agent')).rejects.toThrow(UnauthorizedException);
      // The findOne for User should have been called with lowercase email
      expect(mockEm.findOne).toHaveBeenCalledWith(
        expect.anything(),
        { email: 'test@example.com' },
      );
    });

    it('recognises known device — no newDeviceId in result, updates lastSeenAt', async () => {
      mockEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
        id: 'new-id',
        ...data,
      }));

      const existingDevice = { id: 'device-id', lastSeenAt: null, revokedAt: null };

      mockEm.findOne
        .mockResolvedValueOnce(user)          // User lookup
        .mockResolvedValueOnce(existingDevice); // TrustedDevice lookup — found

      mockCryptoService.verifyPassword.mockResolvedValue(true);

      const result = await service.login(dto, '127.0.0.1', 'agent', 'raw-device-cookie');

      expect(result.newDeviceId).toBeUndefined();
      expect(existingDevice.lastSeenAt).toBeInstanceOf(Date);
    });
  });

  // --------------------------------------------------------------------------
  describe('refresh', () => {
    it('success: sets revokedAt on old token, creates new token with same familyId', async () => {
      const oldToken = makeRefreshToken({ familyId: 'original-family-id' });
      mockEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
        id: 'new-rt-id',
        ...data,
      }));
      mockEm.flush.mockResolvedValue(undefined);

      const result = await service.refresh(oldToken as never, '127.0.0.1', 'agent');

      expect(oldToken.revokedAt).toBeInstanceOf(Date);
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.rawRefreshToken).toBe('raw-refresh-token');

      // The new RefreshToken should inherit the same familyId
      const createCall = mockEm.create.mock.calls.find(
        ([, data]: [unknown, Record<string, unknown>]) => data['tokenHash'] !== undefined,
      );
      expect(createCall).toBeDefined();
      expect(createCall[1].familyId).toBe('original-family-id');
    });
  });

  // --------------------------------------------------------------------------
  describe('logout', () => {
    it('sets revokedAt on token and calls em.flush()', async () => {
      const token = makeRefreshToken();
      mockEm.flush.mockResolvedValue(undefined);

      await service.logout(token as never, '127.0.0.1', 'test-agent');

      expect(token.revokedAt).toBeInstanceOf(Date);
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  describe('getMe', () => {
    it('returns user profile', async () => {
      const user = makeUser();
      mockEm.findOneOrFail.mockResolvedValue(user);

      const result = await service.getMe('user-uuid-1');

      expect(result).toEqual({
        id: 'user-uuid-1',
        email: 'test@example.com',
        kdfSalt: 'aabbccdd'.repeat(8),
        totpEnabled: false,
      });
    });
  });

  // --------------------------------------------------------------------------
  describe('checkPoW (via register/login)', () => {
    const savedEnablePoW = process.env.ENABLE_POW;

    afterEach(() => {
      if (savedEnablePoW === undefined) {
        delete process.env.ENABLE_POW;
      } else {
        process.env.ENABLE_POW = savedEnablePoW;
      }
    });

    describe('ENABLE_POW=false (default)', () => {
      beforeEach(() => { delete process.env.ENABLE_POW; });

      it('register: skips PoW check — verifyAndConsume never called', async () => {
        mockEm.create.mockImplementation((_e: unknown, data: Record<string, unknown>) => ({
          id: 'u1', totpEnabled: false, ...data,
        }));
        const dto: RegisterDto = { email: 'x@x.com', password: 'longenoughpassword' };
        await service.register(dto, '1.2.3.4', 'ua');
        expect(mockChallengeService.verifyAndConsume).not.toHaveBeenCalled();
      });

      it('login: skips PoW check — verifyAndConsume never called', async () => {
        const user = makeUser();
        mockEm.findOne.mockResolvedValueOnce(user).mockResolvedValue(null);
        mockCryptoService.verifyPassword.mockResolvedValue(true);
        mockEm.create.mockImplementation((_e: unknown, data: Record<string, unknown>) => ({
          id: 'n', ...data,
        }));
        const dto: LoginDto = { email: 'test@example.com', password: 'pw' };
        await service.login(dto, '1.2.3.4', 'ua');
        expect(mockChallengeService.verifyAndConsume).not.toHaveBeenCalled();
      });
    });

    describe('ENABLE_POW=true', () => {
      beforeEach(() => { process.env.ENABLE_POW = 'true'; });

      it('register: throws 400 when powChallenge missing', async () => {
        const dto: RegisterDto = { email: 'x@x.com', password: 'longenoughpassword' };
        await expect(service.register(dto, '1.2.3.4', 'ua')).rejects.toBeInstanceOf(BadRequestException);
        expect(mockChallengeService.verifyAndConsume).not.toHaveBeenCalled();
      });

      it('login: throws 400 when powNonce missing', async () => {
        const dto: LoginDto = { email: 'x@x.com', password: 'pw', powChallenge: 'abc' };
        await expect(service.login(dto, '1.2.3.4', 'ua')).rejects.toBeInstanceOf(BadRequestException);
        expect(mockChallengeService.verifyAndConsume).not.toHaveBeenCalled();
      });

      it('login: calls verifyAndConsume with correct args when both fields provided', async () => {
        const user = makeUser();
        mockEm.findOne.mockResolvedValueOnce(user).mockResolvedValue(null);
        mockCryptoService.verifyPassword.mockResolvedValue(true);
        mockEm.create.mockImplementation((_e: unknown, data: Record<string, unknown>) => ({
          id: 'n', ...data,
        }));
        const dto: LoginDto = {
          email: 'test@example.com',
          password: 'pw',
          powChallenge: 'c'.repeat(64),
          powNonce: '42',
        };
        await service.login(dto, '1.2.3.4', 'ua');
        expect(mockChallengeService.verifyAndConsume).toHaveBeenCalledWith('c'.repeat(64), '42');
      });

      it('login: propagates BadRequestException from verifyAndConsume', async () => {
        mockChallengeService.verifyAndConsume.mockRejectedValueOnce(
          new BadRequestException('Challenge expired or already used'),
        );
        const dto: LoginDto = {
          email: 'x@x.com',
          password: 'pw',
          powChallenge: 'd'.repeat(64),
          powNonce: '1',
        };
        await expect(service.login(dto, '1.2.3.4', 'ua')).rejects.toThrow('Challenge expired or already used');
      });
    });
  });
});
