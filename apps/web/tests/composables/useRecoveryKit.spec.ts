import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ---------------------------------------------------------------------------
// @adyton/shared — stub unwrapVaultKeyFromRecovery and validateRecoveryMnemonic
// ---------------------------------------------------------------------------
const mockUnwrapVaultKeyFromRecovery = vi.fn();
const mockValidateRecoveryMnemonic = vi.fn();

vi.mock('@adyton/shared', () => ({
  unwrapVaultKeyFromRecovery: (...args: unknown[]) => mockUnwrapVaultKeyFromRecovery(...args),
  validateRecoveryMnemonic: (...args: unknown[]) => mockValidateRecoveryMnemonic(...args),
}));

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
const mockApiFetch = vi.fn();
const mockUnlockWithRawKey = vi.fn();
const mockFetchAll = vi.fn();
const mockNavigateTo = vi.fn();

vi.mock('../../app/stores/auth', () => ({
  useAuthStore: vi.fn(() => ({ apiFetch: mockApiFetch })),
}));

vi.mock('../../app/stores/crypto', () => ({
  useCryptoStore: vi.fn(() => ({
    unlockWithRawKey: mockUnlockWithRawKey,
  })),
}));

vi.mock('../../app/stores/vault', () => ({
  useVaultStore: vi.fn(() => ({
    fetchAll: mockFetchAll,
  })),
}));

// navigateTo is a Nuxt auto-import — mock globally
vi.stubGlobal('navigateTo', mockNavigateTo);

// ---------------------------------------------------------------------------
// Import under test — after all vi.mock declarations
// ---------------------------------------------------------------------------
import { useRecoveryKit } from '../../app/composables/useRecoveryKit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function make24Words(): string[] {
  return Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
}

function fakeRawBytes(): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(32) as Uint8Array<ArrayBuffer>;
  buf.fill(0xcd);
  return buf;
}

function fakeKit() {
  return {
    recoverySalt: 'salt-b64',
    recoveryWrappedVaultKey: 'wrapped-b64',
    wrapIv: 'iv-b64',
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  mockApiFetch.mockReset();
  mockUnwrapVaultKeyFromRecovery.mockReset();
  mockValidateRecoveryMnemonic.mockReset();
  mockUnlockWithRawKey.mockReset();
  mockFetchAll.mockReset();
  mockNavigateTo.mockReset();

  // Defaults
  mockValidateRecoveryMnemonic.mockReturnValue(true);
  mockApiFetch.mockResolvedValue(fakeKit());
  mockUnwrapVaultKeyFromRecovery.mockResolvedValue(fakeRawBytes());
  mockUnlockWithRawKey.mockResolvedValue(undefined);
  mockFetchAll.mockResolvedValue(undefined);
  mockNavigateTo.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------
describe('useRecoveryKit.recover — success', () => {
  it('transitions through validating → recovering → done and navigates to /vault', async () => {
    const { status, recover } = useRecoveryKit();
    expect(status.value).toBe('idle');

    await recover(make24Words());

    expect(mockValidateRecoveryMnemonic).toHaveBeenCalledWith(make24Words().join(' '));
    expect(mockApiFetch).toHaveBeenCalledWith('/auth/recovery/vault-key');
    expect(mockUnwrapVaultKeyFromRecovery).toHaveBeenCalledWith(
      make24Words().join(' '),
      'salt-b64',
      'wrapped-b64',
      'iv-b64',
    );
    expect(mockUnlockWithRawKey).toHaveBeenCalled();
    expect(mockFetchAll).toHaveBeenCalled();
    expect(mockNavigateTo).toHaveBeenCalledWith('/vault');
    expect(status.value).toBe('done');
  });

  it('zeroizes raw bytes after successful unlock', async () => {
    const rawBytes = fakeRawBytes();
    mockUnwrapVaultKeyFromRecovery.mockResolvedValueOnce(rawBytes);

    const { recover } = useRecoveryKit();
    await recover(make24Words());

    // After unlockWithRawKey, bytes should be zeroed
    expect(rawBytes.every(b => b === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid mnemonic format (before API call)
// ---------------------------------------------------------------------------
describe('useRecoveryKit.recover — invalid format', () => {
  it('returns error without calling the API if mnemonic is invalid', async () => {
    mockValidateRecoveryMnemonic.mockReturnValueOnce(false);

    const { status, error, recover } = useRecoveryKit();
    await recover(['bad', 'words']);

    expect(status.value).toBe('error');
    expect(error.value).toMatch(/invalid/i);
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockUnwrapVaultKeyFromRecovery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 404 — no recovery kit
// ---------------------------------------------------------------------------
describe('useRecoveryKit.recover — 404', () => {
  it('shows the "No recovery kit" message when API returns 404', async () => {
    mockApiFetch.mockRejectedValueOnce({ status: 404, message: 'Not Found' });

    const { status, error, recover } = useRecoveryKit();
    await recover(make24Words());

    expect(status.value).toBe('error');
    expect(error.value).toContain('No recovery kit is set up');
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Wrong mnemonic (AES-GCM decryption fails)
// ---------------------------------------------------------------------------
describe('useRecoveryKit.recover — wrong mnemonic', () => {
  it('shows "Incorrect recovery phrase" message when decrypt throws', async () => {
    mockUnwrapVaultKeyFromRecovery.mockRejectedValueOnce(
      new DOMException('The operation failed for an operation-specific reason', 'OperationError'),
    );

    const { status, error, recover } = useRecoveryKit();
    await recover(make24Words());

    expect(status.value).toBe('error');
    expect(error.value).toContain('Incorrect recovery phrase');
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it('zeroizes raw bytes even when unlockWithRawKey throws after successful decrypt', async () => {
    const rawBytes = fakeRawBytes();
    mockUnwrapVaultKeyFromRecovery.mockResolvedValueOnce(rawBytes);
    mockUnlockWithRawKey.mockRejectedValueOnce(new Error('import failed'));

    const { status, recover } = useRecoveryKit();
    await recover(make24Words());

    expect(status.value).toBe('error');
    expect(rawBytes.every(b => b === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Network error
// ---------------------------------------------------------------------------
describe('useRecoveryKit.recover — network error', () => {
  it('shows the error message on a generic network failure', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    const { status, error, recover } = useRecoveryKit();
    await recover(make24Words());

    expect(status.value).toBe('error');
    expect(error.value).toBe('Failed to fetch');
  });
});
