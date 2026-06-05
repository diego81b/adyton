import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { generate, generateSecret } from 'otplib';
import { TwoFactorService } from './two-factor.service';
import { encryptTotpSecret } from './totp-cipher';
import { AuditAction } from '../entities/audit-log.entity';
import {
  MFA_TOKEN_PREFIX,
  MFA_ATTEMPTS_PREFIX,
} from '../auth/auth.service';
import { AuthenticateTwoFactorDto } from './dto/authenticate-two-factor.dto';

// ---- TOTP encryption key fixture -------------------------------------------

const KEY_HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';
const KEY_BUFFER = Buffer.from(KEY_HEX, 'hex');
let tmpDir: string;
let savedKeyPath: string | undefined;

// ---- Mocks ------------------------------------------------------------------

const RECOVERY_CODES = [
  'aaaaa-bbbbb-ccccc-ddddd',
  'aaaa1-bbbb1-cccc1-dddd1',
  'aaaa2-bbbb2-cccc2-dddd2',
  'aaaa3-bbbb3-cccc3-dddd3',
  'aaaa4-bbbb4-cccc4-dddd4',
  'aaaa5-bbbb5-cccc5-dddd5',
  'aaaa6-bbbb6-cccc6-dddd6',
  'aaaa7-bbbb7-cccc7-dddd7',
];

const mockEm = {
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  find: jest.fn(),
  persist: jest.fn(),
  remove: jest.fn(),
  flush: jest.fn(),
  create: jest.fn(),
  nativeDelete: jest.fn(),
};

const mockCryptoService = {
  verifyPassword: jest.fn(),
  hashToken: jest.fn(),
  generateRecoveryCodes: jest.fn(),
  hashRecoveryCode: jest.fn(),
  verifyRecoveryCode: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
  persistLog: jest.fn(),
};

const mockAuthService = {
  completeLogin: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  setex: jest.fn(),
};

// ---- Helpers ----------------------------------------------------------------

function makeUser(
  overrides: Partial<{
    id: string;
    email: string;
    passwordHash: string;
    totpEnabled: boolean;
    totpSecretEncrypted: string | null;
  }> = {},
) {
  return {
    id: 'user-uuid-1',
    email: 'test@example.com',
    passwordHash: '$argon2id$hashed',
    totpEnabled: false,
    totpSecretEncrypted: null,
    ...overrides,
  };
}

const MFA_TOKEN = 'f'.repeat(64);
const TOKEN_HASH = `hash-of-${MFA_TOKEN}`;

// ---- Tests ------------------------------------------------------------------

describe('TwoFactorService', () => {
  let service: TwoFactorService;

  beforeAll(() => {
    savedKeyPath = process.env.TOTP_ENC_KEY_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adyton-totp-'));
    const keyFile = path.join(tmpDir, 'totp_enc.key');
    fs.writeFileSync(keyFile, KEY_HEX, 'utf8');
    process.env.TOTP_ENC_KEY_PATH = keyFile;
  });

  afterAll(() => {
    if (savedKeyPath === undefined) {
      delete process.env.TOTP_ENC_KEY_PATH;
    } else {
      process.env.TOTP_ENC_KEY_PATH = savedKeyPath;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockEm.flush.mockResolvedValue(undefined);
    mockEm.nativeDelete.mockResolvedValue(0);
    mockEm.create.mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    );
    mockCryptoService.hashToken.mockImplementation((raw: string) => `hash-of-${raw}`);
    mockCryptoService.generateRecoveryCodes.mockReturnValue([...RECOVERY_CODES]);
    mockCryptoService.hashRecoveryCode.mockImplementation(
      async (code: string) => `hash:${code}`,
    );
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);
    mockAuthService.completeLogin.mockResolvedValue({ accessToken: 'session-token' });

    service = new TwoFactorService(
      mockEm as never,
      mockCryptoService as never,
      mockAuditService as never,
      mockAuthService as never,
      mockRedis as never,
    );
  });

  // --------------------------------------------------------------------------
  describe('setup', () => {
    it('generates a secret, stores the encrypted secret, returns otpauth + QR data URIs', async () => {
      const user = makeUser();
      mockEm.findOneOrFail.mockResolvedValue(user);

      const result = await service.setup(user.id);

      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.secret).toHaveLength(32);
      expect(result.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
      expect(result.qrDataUri.startsWith('data:image/')).toBe(true);
      expect(user.totpSecretEncrypted).toEqual(expect.any(String));
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when 2FA is already enabled', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));

      await expect(service.setup('user-uuid-1')).rejects.toThrow(ConflictException);
    });
  });

  // --------------------------------------------------------------------------
  describe('enable', () => {
    it('valid code: enables 2FA, returns 8 well-formed codes, persists rows, audits TWO_FACTOR_ENABLED', async () => {
      const secret = generateSecret();
      const user = makeUser({ totpSecretEncrypted: encryptTotpSecret(secret, KEY_BUFFER) });
      mockEm.findOneOrFail.mockResolvedValue(user);
      const code = await generate({ secret });

      const codes = await service.enable(user.id, code, '127.0.0.1', 'agent');

      expect(user.totpEnabled).toBe(true);
      expect(codes).toHaveLength(8);
      for (const c of codes) {
        expect(c).toMatch(/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/);
      }
      expect(mockEm.persist).toHaveBeenCalledTimes(8);
      expect(mockCryptoService.hashRecoveryCode).toHaveBeenCalledTimes(8);
      const persisted = mockEm.create.mock.calls.map(([, data]) => (data as { codeHash: string }).codeHash);
      expect(persisted).toEqual(RECOVERY_CODES.map((c) => `hash:${c}`));
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        user.id,
        AuditAction.TWO_FACTOR_ENABLED,
        '127.0.0.1',
        'agent',
      );
      expect(mockEm.flush).toHaveBeenCalled();
    });

    it('wrong code: throws UnauthorizedException and audits TWO_FACTOR_FAILURE', async () => {
      const secret = generateSecret();
      const user = makeUser({ totpSecretEncrypted: encryptTotpSecret(secret, KEY_BUFFER) });
      mockEm.findOneOrFail.mockResolvedValue(user);
      const real = await generate({ secret });
      // Guard: ensure the bad code is never accidentally the current valid one.
      const bad = real === '000000' ? '111111' : '000000';

      await expect(service.enable(user.id, bad, '127.0.0.1', 'agent')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(user.totpEnabled).toBe(false);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        user.id,
        AuditAction.TWO_FACTOR_FAILURE,
        '127.0.0.1',
        'agent',
        { stage: 'enable' },
      );
    });

    it('no pending secret: throws BadRequestException', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpSecretEncrypted: null }));

      await expect(service.enable('user-uuid-1', '123456', 'ip', 'ua')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('already enabled: throws ConflictException', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));

      await expect(service.enable('user-uuid-1', '123456', 'ip', 'ua')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('disable', () => {
    it('wrong password: throws UnauthorizedException with Invalid credentials', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));
      mockCryptoService.verifyPassword.mockResolvedValue(false);

      await expect(service.disable('user-uuid-1', 'wrong', 'ip', 'ua')).rejects.toThrow(
        'Invalid credentials',
      );
      expect(mockEm.nativeDelete).not.toHaveBeenCalled();
    });

    it('correct password: clears secret/flag, deletes recovery codes, audits TWO_FACTOR_DISABLED', async () => {
      const user = makeUser({
        totpEnabled: true,
        totpSecretEncrypted: encryptTotpSecret('SECRET', KEY_BUFFER),
      });
      mockEm.findOneOrFail.mockResolvedValue(user);
      mockCryptoService.verifyPassword.mockResolvedValue(true);

      await service.disable(user.id, 'correct', '127.0.0.1', 'agent');

      expect(user.totpEnabled).toBe(false);
      expect(user.totpSecretEncrypted).toBeNull();
      expect(mockEm.nativeDelete).toHaveBeenCalledTimes(1);
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        user.id,
        AuditAction.TWO_FACTOR_DISABLED,
        '127.0.0.1',
        'agent',
      );
      expect(mockEm.flush).toHaveBeenCalled();
    });

    it('not enabled: throws BadRequestException', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: false }));
      mockCryptoService.verifyPassword.mockResolvedValue(true);

      await expect(service.disable('user-uuid-1', 'correct', 'ip', 'ua')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('regenerateRecoveryCodes', () => {
    it('wrong password: throws UnauthorizedException', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));
      mockCryptoService.verifyPassword.mockResolvedValue(false);

      await expect(
        service.regenerateRecoveryCodes('user-uuid-1', 'wrong', 'ip', 'ua'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('not enabled: throws BadRequestException', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: false }));
      mockCryptoService.verifyPassword.mockResolvedValue(true);

      await expect(
        service.regenerateRecoveryCodes('user-uuid-1', 'correct', 'ip', 'ua'),
      ).rejects.toThrow(BadRequestException);
    });

    it('ok: returns 8 new codes, deletes old, audits RECOVERY_CODES_REGENERATED', async () => {
      const user = makeUser({ totpEnabled: true });
      mockEm.findOneOrFail.mockResolvedValue(user);
      mockCryptoService.verifyPassword.mockResolvedValue(true);

      const codes = await service.regenerateRecoveryCodes(user.id, 'correct', '127.0.0.1', 'agent');

      expect(codes).toHaveLength(8);
      expect(mockEm.nativeDelete).toHaveBeenCalledTimes(1);
      expect(mockEm.persist).toHaveBeenCalledTimes(8);
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        user.id,
        AuditAction.RECOVERY_CODES_REGENERATED,
        '127.0.0.1',
        'agent',
      );
    });
  });

  // --------------------------------------------------------------------------
  describe('authenticate', () => {
    function dto(overrides: Partial<AuthenticateTwoFactorDto> = {}): AuthenticateTwoFactorDto {
      return { mfaToken: MFA_TOKEN, ...overrides };
    }

    const tokenKey = `${MFA_TOKEN_PREFIX}${TOKEN_HASH}`;
    const attemptsKey = `${MFA_ATTEMPTS_PREFIX}${TOKEN_HASH}`;

    it('throws BadRequestException when both code and recoveryCode are set', async () => {
      await expect(
        service.authenticate(dto({ code: '123456', recoveryCode: 'aaaaa-bbbbb-ccccc-ddddd' }), 'ip', 'ua'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when neither code nor recoveryCode is set', async () => {
      await expect(service.authenticate(dto(), 'ip', 'ua')).rejects.toThrow(BadRequestException);
    });

    it('unknown/expired mfaToken: throws UnauthorizedException', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.authenticate(dto({ code: '123456' }), 'ip', 'ua')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('too many attempts: deletes both keys, audits TWO_FACTOR_FAILURE, throws', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockRedis.incr.mockResolvedValue(6);

      await expect(service.authenticate(dto({ code: '123456' }), '127.0.0.1', 'agent')).rejects.toThrow(
        'Too many attempts',
      );
      expect(mockRedis.del).toHaveBeenCalledWith(tokenKey, attemptsKey);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        'user-uuid-1',
        AuditAction.TWO_FACTOR_FAILURE,
        '127.0.0.1',
        'agent',
        { reason: 'too_many_attempts' },
      );
    });

    it('valid TOTP code: consumes token, returns completeLogin result', async () => {
      const secret = generateSecret();
      const user = makeUser({
        totpEnabled: true,
        totpSecretEncrypted: encryptTotpSecret(secret, KEY_BUFFER),
      });
      mockRedis.get.mockResolvedValue(user.id);
      mockEm.findOne.mockResolvedValue(user);
      const code = await generate({ secret });

      const result = await service.authenticate(
        dto({ code }),
        '127.0.0.1',
        'agent',
        'device-cookie',
      );

      expect(mockRedis.del).toHaveBeenCalledWith(tokenKey, attemptsKey);
      expect(mockAuthService.completeLogin).toHaveBeenCalledWith(
        user,
        '127.0.0.1',
        'agent',
        'device-cookie',
      );
      expect(result).toEqual({ accessToken: 'session-token' });
    });

    it('stale TOTP code (120s old) is rejected — pins epochTolerance as SECONDS, not steps', async () => {
      // Discriminating test: a ±30-STEP window (15 min) would accept this code and
      // silently widen the replay window on a second factor. Locks the unit against
      // future otplib upgrades.
      const secret = generateSecret();
      const user = makeUser({
        totpEnabled: true,
        totpSecretEncrypted: encryptTotpSecret(secret, KEY_BUFFER),
      });
      mockRedis.get.mockResolvedValue(user.id);
      mockEm.findOne.mockResolvedValue(user);
      const stale = await generate({ secret, epoch: Math.floor(Date.now() / 1000) - 120 });

      await expect(service.authenticate(dto({ code: stale }), 'ip', 'ua')).rejects.toThrow(
        'Invalid code',
      );
    });

    it('wrong TOTP code: throws Invalid code, audits TWO_FACTOR_FAILURE, does not delete token', async () => {
      const secret = generateSecret();
      const user = makeUser({
        totpEnabled: true,
        totpSecretEncrypted: encryptTotpSecret(secret, KEY_BUFFER),
      });
      mockRedis.get.mockResolvedValue(user.id);
      mockEm.findOne.mockResolvedValue(user);
      const real = await generate({ secret });
      const bad = real === '000000' ? '111111' : '000000';

      await expect(service.authenticate(dto({ code: bad }), '127.0.0.1', 'agent')).rejects.toThrow(
        'Invalid code',
      );
      expect(mockAuditService.log).toHaveBeenCalledWith(
        user.id,
        AuditAction.TWO_FACTOR_FAILURE,
        '127.0.0.1',
        'agent',
        { stage: 'authenticate' },
      );
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('valid recovery code: removes the row, audits RECOVERY_CODE_USED, completes login', async () => {
      const user = makeUser({
        totpEnabled: true,
        totpSecretEncrypted: encryptTotpSecret('SECRET', KEY_BUFFER),
      });
      mockRedis.get.mockResolvedValue(user.id);
      mockEm.findOne.mockResolvedValue(user);
      const matchingRow = { id: 'rc-2', codeHash: 'hash:match' };
      mockEm.find.mockResolvedValue([{ id: 'rc-1', codeHash: 'hash:other' }, matchingRow]);
      mockCryptoService.verifyRecoveryCode.mockImplementation(
        async (_code: string, hash: string) => hash === 'hash:match',
      );

      const result = await service.authenticate(
        dto({ recoveryCode: 'aaaaa-bbbbb-ccccc-ddddd' }),
        '127.0.0.1',
        'agent',
        'device-cookie',
      );

      expect(mockEm.remove).toHaveBeenCalledWith(matchingRow);
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        user.id,
        AuditAction.RECOVERY_CODE_USED,
        '127.0.0.1',
        'agent',
      );
      expect(mockAuthService.completeLogin).toHaveBeenCalledWith(user, '127.0.0.1', 'agent', 'device-cookie');
      expect(result).toEqual({ accessToken: 'session-token' });
    });

    it('non-matching recovery code: throws UnauthorizedException', async () => {
      const user = makeUser({
        totpEnabled: true,
        totpSecretEncrypted: encryptTotpSecret('SECRET', KEY_BUFFER),
      });
      mockRedis.get.mockResolvedValue(user.id);
      mockEm.findOne.mockResolvedValue(user);
      mockEm.find.mockResolvedValue([{ id: 'rc-1', codeHash: 'hash:other' }]);
      mockCryptoService.verifyRecoveryCode.mockResolvedValue(false);

      await expect(
        service.authenticate(dto({ recoveryCode: 'aaaaa-bbbbb-ccccc-ddddd' }), 'ip', 'ua'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('user deleted after token lookup: throws UnauthorizedException', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockEm.findOne.mockResolvedValue(null);

      await expect(service.authenticate(dto({ code: '123456' }), 'ip', 'ua')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('totpEnabled false after token lookup: throws UnauthorizedException', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockEm.findOne.mockResolvedValue(makeUser({ totpEnabled: false }));

      await expect(service.authenticate(dto({ code: '123456' }), 'ip', 'ua')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
