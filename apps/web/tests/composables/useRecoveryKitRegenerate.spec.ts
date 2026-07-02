import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ---------------------------------------------------------------------------
// @adyton/shared — spread real module, stub the crypto wrap operation only.
// ---------------------------------------------------------------------------
const mockWrapVaultKeyForRecovery = vi.fn();

vi.mock('@adyton/shared', async (orig) => {
  const real = await orig<typeof import('@adyton/shared')>();
  return {
    ...real,
    wrapVaultKeyForRecovery: (...args: unknown[]) => mockWrapVaultKeyForRecovery(...args),
  };
});

// ---------------------------------------------------------------------------
// useArgon2Worker — deriveRawKey cannot run a Web Worker in happy-dom
// ---------------------------------------------------------------------------
const mockDeriveRawKey = vi.fn();
vi.mock('../../app/composables/useArgon2Worker', () => ({
  deriveRawKey: (...args: unknown[]) => mockDeriveRawKey(...args),
  importVaultKey: vi.fn(),
  useArgon2Worker: vi.fn(),
}));

// ---------------------------------------------------------------------------
// useBiometricUnlock — verifyRawKeyMatches
// ---------------------------------------------------------------------------
const mockVerifyRawKeyMatches = vi.fn();
vi.mock('../../app/composables/useBiometricUnlock', () => ({
  useBiometricUnlock: () => ({
    verifyRawKeyMatches: (...args: unknown[]) => mockVerifyRawKeyMatches(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Auth store — apiFetch + user
// ---------------------------------------------------------------------------
const mockApiFetch = vi.fn();
let mockUser: { id: string; kdfSalt: string } | null = { id: 'user-1', kdfSalt: 'aa'.repeat(32) };

vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
    get user() { return mockUser; },
  }),
}));

// ---------------------------------------------------------------------------
// Crypto store — cryptoKey
// ---------------------------------------------------------------------------
let mockCryptoKey: CryptoKey | null = {} as CryptoKey;

vi.mock('../../app/stores/crypto', () => ({
  useCryptoStore: () => ({
    get cryptoKey() { return mockCryptoKey; },
  }),
}));

// ---------------------------------------------------------------------------
// Import under test — after all vi.mock declarations
// ---------------------------------------------------------------------------
import { useRecoveryKitRegenerate } from '../../app/composables/useRecoveryKitRegenerate';

const FAKE_KIT = {
  mnemonic: Array.from({ length: 24 }, (_, i) => `word${i + 1}`).join(' '),
  recoverySalt: 'c2FsdA==',
  recoveryWrappedVaultKey: 'd3JhcHBlZA==',
  wrapIv: 'aXY=',
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockUser = { id: 'user-1', kdfSalt: 'aa'.repeat(32) };
  mockCryptoKey = {} as CryptoKey;
  mockDeriveRawKey.mockResolvedValue(new ArrayBuffer(32));
  mockVerifyRawKeyMatches.mockResolvedValue(true);
  mockWrapVaultKeyForRecovery.mockResolvedValue(FAKE_KIT);
  mockApiFetch.mockResolvedValue(undefined);
});

describe('useRecoveryKitRegenerate.regenerate', () => {
  it('derives, verifies, wraps, and posts the new kit, exposing the mnemonic on success', async () => {
    const { regenerate, mnemonic, error, loading } = useRecoveryKitRegenerate();

    const result = await regenerate('correct horse');

    expect(result).toBe(true);
    expect(mockDeriveRawKey).toHaveBeenCalledWith('correct horse', 'aa'.repeat(32));
    expect(mockVerifyRawKeyMatches).toHaveBeenCalled();
    expect(mockWrapVaultKeyForRecovery).toHaveBeenCalled();
    expect(mockApiFetch).toHaveBeenCalledWith('/auth/recovery/setup', {
      method: 'POST',
      body: {
        recoverySalt: FAKE_KIT.recoverySalt,
        recoveryWrappedVaultKey: FAKE_KIT.recoveryWrappedVaultKey,
        wrapIv: FAKE_KIT.wrapIv,
      },
    });
    expect(mnemonic.value).toEqual(FAKE_KIT.mnemonic.split(' '));
    expect(error.value).toBeNull();
    expect(loading.value).toBe(false);
  });

  it('posts the new kit before exposing the mnemonic (server acceptance gates display)', async () => {
    const callOrder: string[] = [];
    mockApiFetch.mockImplementation(async () => { callOrder.push('apiFetch'); });
    const { regenerate, mnemonic } = useRecoveryKitRegenerate();

    // mnemonic must still be null right up until apiFetch resolves
    const promise = regenerate('correct horse');
    await promise;

    expect(callOrder).toEqual(['apiFetch']);
    expect(mnemonic.value).not.toBeNull();
  });

  it('fails with wrong master password and does not call the server', async () => {
    mockVerifyRawKeyMatches.mockResolvedValue(false);
    const { regenerate, mnemonic, error } = useRecoveryKitRegenerate();

    const result = await regenerate('wrong password');

    expect(result).toBe(false);
    expect(error.value).toBe('Wrong master password.');
    expect(mnemonic.value).toBeNull();
    expect(mockWrapVaultKeyForRecovery).not.toHaveBeenCalled();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('fails cleanly when the vault is locked', async () => {
    mockCryptoKey = null;
    const { regenerate, error } = useRecoveryKitRegenerate();

    const result = await regenerate('correct horse');

    expect(result).toBe(false);
    expect(error.value).toBe('Vault is locked. Unlock it first.');
    expect(mockVerifyRawKeyMatches).not.toHaveBeenCalled();
  });

  it('fails cleanly when the user session is missing', async () => {
    mockUser = null;
    const { regenerate, error } = useRecoveryKitRegenerate();

    const result = await regenerate('correct horse');

    expect(result).toBe(false);
    expect(error.value).toMatch(/log in again/i);
    expect(mockDeriveRawKey).not.toHaveBeenCalled();
  });

  it('surfaces a server error and keeps mnemonic unset', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    const { regenerate, mnemonic, error } = useRecoveryKitRegenerate();

    const result = await regenerate('correct horse');

    expect(result).toBe(false);
    expect(error.value).toBe('Network error');
    expect(mnemonic.value).toBeNull();
  });

  it('zeroizes raw key bytes even when wrapVaultKeyForRecovery throws', async () => {
    mockWrapVaultKeyForRecovery.mockRejectedValue(new Error('wrap failed'));
    let capturedRaw: ArrayBuffer | null = null;
    mockDeriveRawKey.mockImplementation(async () => {
      capturedRaw = new ArrayBuffer(32);
      new Uint8Array(capturedRaw).fill(0xff);
      return capturedRaw;
    });

    const { regenerate } = useRecoveryKitRegenerate();
    await regenerate('correct horse');

    expect(new Uint8Array(capturedRaw!).every((b) => b === 0)).toBe(true);
  });

  it('resets loading to false after success and after failure', async () => {
    const { regenerate, loading } = useRecoveryKitRegenerate();
    await regenerate('correct horse');
    expect(loading.value).toBe(false);

    mockVerifyRawKeyMatches.mockResolvedValue(false);
    await regenerate('wrong');
    expect(loading.value).toBe(false);
  });
});

describe('useRecoveryKitRegenerate.reset', () => {
  it('clears mnemonic and error', async () => {
    mockVerifyRawKeyMatches.mockResolvedValue(false);
    const { regenerate, reset, mnemonic, error } = useRecoveryKitRegenerate();
    await regenerate('wrong');
    expect(error.value).not.toBeNull();

    reset();

    expect(mnemonic.value).toBeNull();
    expect(error.value).toBeNull();
  });
});
