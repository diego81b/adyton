import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { WebauthnService } from './webauthn.service';
import { AuditAction } from '../entities/audit-log.entity';
import {
  MFA_TOKEN_PREFIX,
  MFA_ATTEMPTS_PREFIX,
} from '../auth/auth.service';

// ---- @simplewebauthn/server mock -------------------------------------------
// Real attestation/assertion crypto is integration territory — the unit only
// orchestrates around these four functions, so we stub them outright.

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

const mockGenerateRegistrationOptions = generateRegistrationOptions as jest.Mock;
const mockVerifyRegistrationResponse = verifyRegistrationResponse as jest.Mock;
const mockGenerateAuthenticationOptions = generateAuthenticationOptions as jest.Mock;
const mockVerifyAuthenticationResponse = verifyAuthenticationResponse as jest.Mock;

// ---- Hand-rolled DI mocks (mirrors the TwoFactorService harness) -----------

const mockEm = {
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  find: jest.fn(),
  persist: jest.fn(),
  remove: jest.fn(),
  flush: jest.fn(),
  create: jest.fn(),
};

const mockCryptoService = {
  hashToken: jest.fn(),
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
  getdel: jest.fn(),
  setex: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
};

// ---- Fixtures ---------------------------------------------------------------

const MFA_TOKEN = 'f'.repeat(64);
const TOKEN_HASH = `hash-of-${MFA_TOKEN}`;

const REG_CHALLENGE_KEY = `webauthn_reg:user-uuid-1`;
const AUTH_CHALLENGE_KEY = `webauthn_auth:${TOKEN_HASH}`;
const MFA_TOKEN_KEY = `${MFA_TOKEN_PREFIX}${TOKEN_HASH}`;
const MFA_ATTEMPTS_KEY = `${MFA_ATTEMPTS_PREFIX}${TOKEN_HASH}`;

// Known public-key bytes so the persisted base64url encoding is assertable.
const PUBLIC_KEY_BYTES = new Uint8Array([1, 2, 3, 4, 5]);
const PUBLIC_KEY_B64URL = Buffer.from(PUBLIC_KEY_BYTES).toString('base64url');

function makeUser(
  overrides: Partial<{ id: string; email: string; totpEnabled: boolean }> = {},
) {
  return {
    id: 'user-uuid-1',
    email: 'test@example.com',
    totpEnabled: false,
    ...overrides,
  };
}

function makeCredentialRow(
  overrides: Partial<{
    id: string;
    credentialId: string;
    publicKey: string;
    signCount: number;
    transports: string | null;
    friendlyName: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    user: { id: string };
  }> = {},
) {
  return {
    id: 'cred-row-1',
    credentialId: 'cred-id-abc',
    publicKey: PUBLIC_KEY_B64URL,
    signCount: 0,
    transports: JSON.stringify(['internal']),
    friendlyName: 'My Passkey',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastUsedAt: null,
    user: { id: 'user-uuid-1' },
    ...overrides,
  };
}

// ---- Tests ------------------------------------------------------------------

describe('WebauthnService', () => {
  let service: WebauthnService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEm.flush.mockResolvedValue(undefined);
    // create returns the payload plus a synthetic id (the service payload has none).
    mockEm.create.mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ id: 'cred-row-1', ...data }),
    );
    mockCryptoService.hashToken.mockImplementation((raw: string) => `hash-of-${raw}`);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.setex.mockResolvedValue('OK');
    mockAuthService.completeLogin.mockResolvedValue({ accessToken: 'session-token' });
    mockGenerateRegistrationOptions.mockResolvedValue({ challenge: 'reg-challenge' });
    mockGenerateAuthenticationOptions.mockResolvedValue({ challenge: 'auth-challenge' });

    service = new WebauthnService(
      mockEm as never,
      mockCryptoService as never,
      mockAuditService as never,
      mockAuthService as never,
      mockRedis as never,
    );
  });

  // --------------------------------------------------------------------------
  describe('registrationOptions', () => {
    it('throws BadRequestException when the user has not enabled two-factor', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: false }));

      await expect(service.registrationOptions('user-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.registrationOptions('user-uuid-1')).rejects.toThrow(
        /Enable two-factor/,
      );
      expect(mockGenerateRegistrationOptions).not.toHaveBeenCalled();
    });

    it('returns options, stores the challenge in redis, and excludes existing credentials', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));
      mockEm.find.mockResolvedValue([
        makeCredentialRow({ credentialId: 'existing-1', transports: JSON.stringify(['usb']) }),
      ]);

      const result = await service.registrationOptions('user-uuid-1');

      expect(result).toEqual({ challenge: 'reg-challenge' });
      const optsArg = mockGenerateRegistrationOptions.mock.calls[0][0];
      expect(optsArg.excludeCredentials).toEqual([
        { id: 'existing-1', transports: ['usb'] },
      ]);
      expect(mockRedis.setex).toHaveBeenCalledWith(REG_CHALLENGE_KEY, 300, 'reg-challenge');
    });
  });

  // --------------------------------------------------------------------------
  describe('registrationVerify', () => {
    const RESPONSE = { id: 'cred-id-abc' } as never;

    function primeVerified() {
      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred-id-abc',
            publicKey: PUBLIC_KEY_BYTES,
            counter: 0,
            transports: ['internal'],
          },
          aaguid: 'aaguid-xyz',
        },
      });
    }

    it('throws BadRequestException when the challenge has expired (redis getdel null)', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));
      mockRedis.getdel.mockResolvedValue(null);

      await expect(
        service.registrationVerify('user-uuid-1', RESPONSE, 'My Passkey', 'ip', 'ua'),
      ).rejects.toThrow(/expired/);
      expect(mockVerifyRegistrationResponse).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when verification resolves verified:false', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));
      mockRedis.getdel.mockResolvedValue('reg-challenge');
      mockVerifyRegistrationResponse.mockResolvedValue({ verified: false, registrationInfo: undefined });

      await expect(
        service.registrationVerify('user-uuid-1', RESPONSE, 'My Passkey', 'ip', 'ua'),
      ).rejects.toThrow(BadRequestException);
      expect(mockEm.persist).not.toHaveBeenCalled();
    });

    it('maps a thrown verification error to BadRequestException (not unhandled)', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));
      mockRedis.getdel.mockResolvedValue('reg-challenge');
      mockVerifyRegistrationResponse.mockRejectedValue(new Error('boom'));

      await expect(
        service.registrationVerify('user-uuid-1', RESPONSE, 'My Passkey', 'ip', 'ua'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the credentialId is already registered', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser({ totpEnabled: true }));
      mockRedis.getdel.mockResolvedValue('reg-challenge');
      primeVerified();
      mockEm.findOne.mockResolvedValue(makeCredentialRow()); // duplicate

      await expect(
        service.registrationVerify('user-uuid-1', RESPONSE, 'My Passkey', 'ip', 'ua'),
      ).rejects.toThrow(ConflictException);
      expect(mockEm.persist).not.toHaveBeenCalled();
    });

    it('happy path: persists the credential row, audits WEBAUTHN_REGISTERED, returns a summary', async () => {
      const user = makeUser({ totpEnabled: true });
      mockEm.findOneOrFail.mockResolvedValue(user);
      mockRedis.getdel.mockResolvedValue('reg-challenge');
      primeVerified();
      mockEm.findOne.mockResolvedValue(null); // no duplicate

      const summary = await service.registrationVerify(
        'user-uuid-1',
        RESPONSE,
        'My Passkey',
        '127.0.0.1',
        'agent',
      );

      expect(mockEm.persist).toHaveBeenCalledTimes(1);
      const persisted = mockEm.create.mock.calls[0][1] as Record<string, unknown>;
      expect(persisted.credentialId).toBe('cred-id-abc');
      expect(persisted.publicKey).toBe(PUBLIC_KEY_B64URL);
      expect(persisted.signCount).toBe(0);
      expect(persisted.transports).toBe(JSON.stringify(['internal']));

      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        user.id,
        AuditAction.WEBAUTHN_REGISTERED,
        '127.0.0.1',
        'agent',
        { friendlyName: 'My Passkey' },
      );
      expect(mockEm.flush).toHaveBeenCalledTimes(1);

      expect(Object.keys(summary).sort()).toEqual(
        ['createdAt', 'friendlyName', 'id', 'lastUsedAt'].sort(),
      );
      expect(summary.id).toBe('cred-row-1');
      expect(summary.friendlyName).toBe('My Passkey');
    });
  });

  // --------------------------------------------------------------------------
  describe('listCredentials', () => {
    it('maps rows to summaries and never leaks publicKey or credentialId', async () => {
      mockEm.find.mockResolvedValue([
        makeCredentialRow({ id: 'a', friendlyName: 'Key A' }),
        makeCredentialRow({ id: 'b', friendlyName: 'Key B', lastUsedAt: new Date('2026-02-02') }),
      ]);

      const result = await service.listCredentials('user-uuid-1');

      expect(result).toHaveLength(2);
      for (const summary of result) {
        expect(Object.keys(summary).sort()).toEqual(
          ['createdAt', 'friendlyName', 'id', 'lastUsedAt'].sort(),
        );
      }
      expect(result[0].id).toBe('a');
      expect(result[1].friendlyName).toBe('Key B');
    });
  });

  // --------------------------------------------------------------------------
  describe('removeCredential', () => {
    it('throws NotFoundException when the credential does not exist', async () => {
      mockEm.findOne.mockResolvedValue(null);

      await expect(
        service.removeCredential('user-uuid-1', 'missing', 'ip', 'ua'),
      ).rejects.toThrow(NotFoundException);
      expect(mockEm.remove).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the credential belongs to another user', async () => {
      mockEm.findOne.mockResolvedValue(makeCredentialRow({ user: { id: 'someone-else' } }));

      await expect(
        service.removeCredential('user-uuid-1', 'cred-row-1', 'ip', 'ua'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockEm.remove).not.toHaveBeenCalled();
    });

    it('removes the row and audits WEBAUTHN_REMOVED', async () => {
      const row = makeCredentialRow({ friendlyName: 'Doomed' });
      mockEm.findOne.mockResolvedValue(row);

      await service.removeCredential('user-uuid-1', 'cred-row-1', '127.0.0.1', 'agent');

      expect(mockEm.remove).toHaveBeenCalledWith(row);
      expect(mockAuditService.persistLog).toHaveBeenCalledWith(
        'user-uuid-1',
        AuditAction.WEBAUTHN_REMOVED,
        '127.0.0.1',
        'agent',
        { friendlyName: 'Doomed' },
      );
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  describe('authenticationOptions', () => {
    it('throws UnauthorizedException for an unknown/expired mfaToken', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.authenticationOptions(MFA_TOKEN)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockGenerateAuthenticationOptions).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the user has no registered passkeys', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockEm.find.mockResolvedValue([]);

      await expect(service.authenticationOptions(MFA_TOKEN)).rejects.toThrow(
        /No passkeys/,
      );
    });

    it('stores the challenge keyed by token hash and builds allowCredentials from rows', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockEm.find.mockResolvedValue([
        makeCredentialRow({ credentialId: 'cred-id-abc', transports: JSON.stringify(['internal']) }),
      ]);

      const result = await service.authenticationOptions(MFA_TOKEN);

      expect(result).toEqual({ challenge: 'auth-challenge' });
      const optsArg = mockGenerateAuthenticationOptions.mock.calls[0][0];
      expect(optsArg.allowCredentials).toEqual([
        { id: 'cred-id-abc', transports: ['internal'] },
      ]);
      expect(mockRedis.setex).toHaveBeenCalledWith(AUTH_CHALLENGE_KEY, 300, 'auth-challenge');
    });
  });

  // --------------------------------------------------------------------------
  describe('authenticationVerify', () => {
    const RESPONSE = { id: 'cred-id-abc' } as never;

    function primeAuthVerified(newCounter = 5) {
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter },
      });
    }

    it('throws UnauthorizedException for an unknown/expired mfaToken', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(
        service.authenticationVerify(MFA_TOKEN, RESPONSE, 'ip', 'ua'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('too many attempts: deletes all three keys, audits too_many_attempts, throws', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockRedis.incr.mockResolvedValue(6);

      await expect(
        service.authenticationVerify(MFA_TOKEN, RESPONSE, '127.0.0.1', 'agent'),
      ).rejects.toThrow('Too many attempts');

      expect(mockRedis.del).toHaveBeenCalledWith(
        MFA_TOKEN_KEY,
        MFA_ATTEMPTS_KEY,
        AUTH_CHALLENGE_KEY,
      );
      expect(mockAuditService.log).toHaveBeenCalledWith(
        'user-uuid-1',
        AuditAction.TWO_FACTOR_FAILURE,
        '127.0.0.1',
        'agent',
        { reason: 'too_many_attempts' },
      );
      expect(mockRedis.getdel).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the challenge has expired (getdel null)', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockRedis.getdel.mockResolvedValue(null);

      await expect(
        service.authenticationVerify(MFA_TOKEN, RESPONSE, 'ip', 'ua'),
      ).rejects.toThrow(/challenge expired/);
    });

    it('credential not found for response.id: audits unknown_credential, throws Invalid passkey', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockRedis.getdel.mockResolvedValue('auth-challenge');
      mockEm.findOne.mockResolvedValue(null);

      await expect(
        service.authenticationVerify(MFA_TOKEN, RESPONSE, '127.0.0.1', 'agent'),
      ).rejects.toThrow('Invalid passkey');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        'user-uuid-1',
        AuditAction.TWO_FACTOR_FAILURE,
        '127.0.0.1',
        'agent',
        { method: 'webauthn', reason: 'unknown_credential' },
      );
    });

    it('verification resolves verified:false: audits, throws Invalid passkey, does not delete token', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockRedis.getdel.mockResolvedValue('auth-challenge');
      mockEm.findOne.mockResolvedValue(makeCredentialRow());
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: false,
        authenticationInfo: { newCounter: 0 },
      });

      await expect(
        service.authenticationVerify(MFA_TOKEN, RESPONSE, '127.0.0.1', 'agent'),
      ).rejects.toThrow('Invalid passkey');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        'user-uuid-1',
        AuditAction.TWO_FACTOR_FAILURE,
        '127.0.0.1',
        'agent',
        { method: 'webauthn' },
      );
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('verification throws: treated as failure, throws Invalid passkey, does not delete token', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockRedis.getdel.mockResolvedValue('auth-challenge');
      mockEm.findOne.mockResolvedValue(makeCredentialRow());
      mockVerifyAuthenticationResponse.mockRejectedValue(new Error('bad assertion'));

      await expect(
        service.authenticationVerify(MFA_TOKEN, RESPONSE, '127.0.0.1', 'agent'),
      ).rejects.toThrow('Invalid passkey');
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('happy path: updates signCount + lastUsedAt, drops token, completes login, returns its result', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      mockRedis.getdel.mockResolvedValue('auth-challenge');
      const populatedUser = makeUser({ totpEnabled: true });
      const row = makeCredentialRow({ signCount: 2, user: populatedUser });
      mockEm.findOne.mockResolvedValue(row);
      primeAuthVerified(7);

      const result = await service.authenticationVerify(
        MFA_TOKEN,
        RESPONSE,
        '127.0.0.1',
        'agent',
        'device-cookie',
      );

      expect(row.signCount).toBe(7);
      expect(row.lastUsedAt).toBeInstanceOf(Date);
      expect(mockRedis.del).toHaveBeenCalledWith(MFA_TOKEN_KEY, MFA_ATTEMPTS_KEY);
      expect(mockAuthService.completeLogin).toHaveBeenCalledWith(
        populatedUser,
        '127.0.0.1',
        'agent',
        'device-cookie',
      );
      expect(result).toEqual({ accessToken: 'session-token' });
    });
  });
});
