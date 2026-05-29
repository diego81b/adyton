import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { RefreshGuard } from './refresh.guard';
import { RefreshToken } from '../../entities/refresh-token.entity';

// ---- Mocks ----------------------------------------------------------------

const mockEm = {
  findOne: jest.fn(),
  nativeUpdate: jest.fn(),
};

const mockCryptoService = {
  hashToken: jest.fn().mockImplementation((raw: string) => `hash-of-${raw}`),
};

function makeToken(overrides: Partial<{
  id: string;
  revokedAt: Date | null;
  familyId: string;
  expiresAt: Date;
  user: { id: string };
}> = {}) {
  return {
    id: 'token-id',
    revokedAt: null,
    familyId: 'family-uuid',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    user: { id: 'user-uuid' },
    ...overrides,
  };
}

function makeContext(cookieValue: string | undefined): ExecutionContext {
  const req: Record<string, unknown> = {
    cookies: cookieValue !== undefined ? { refreshToken: cookieValue } : {},
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

// ---- Tests -----------------------------------------------------------------

describe('RefreshGuard', () => {
  let guard: RefreshGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEm.nativeUpdate.mockResolvedValue(0);
    guard = new RefreshGuard(mockEm as never, mockCryptoService as never);
  });

  it('throws UnauthorizedException when no refresh cookie present', async () => {
    const ctx = makeContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token not found in DB', async () => {
    mockEm.findOne.mockResolvedValue(null);
    const ctx = makeContext('some-raw-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches refreshToken to request and returns true for valid token', async () => {
    const token = makeToken();
    mockEm.findOne.mockResolvedValue(token);
    const req: Record<string, unknown> = { cookies: { refreshToken: 'raw-token' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req['refreshToken']).toBe(token);
  });

  it('revokes entire family and throws UnauthorizedException on token reuse (family theft)', async () => {
    const revokedToken = makeToken({ revokedAt: new Date(Date.now() - 1000) });
    mockEm.findOne.mockResolvedValue(revokedToken);
    const ctx = makeContext('reused-raw-token');

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Token reuse detected');

    // nativeUpdate should have been called to revoke the entire family
    expect(mockEm.nativeUpdate).toHaveBeenCalledWith(
      RefreshToken,
      { familyId: revokedToken.familyId, user: revokedToken.user },
      { revokedAt: expect.any(Date) },
    );
  });
});
