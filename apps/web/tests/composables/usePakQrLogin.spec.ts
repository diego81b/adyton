import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ---------------------------------------------------------------------------
// Mock @adyton/shared crypto wrappers — state machine tests only, no real crypto
// ---------------------------------------------------------------------------
const mockGenerateEphemeralKeypair = vi.fn();
const mockExportPublicKeySpki = vi.fn();
const mockImportPublicKeySpki = vi.fn();
const mockDeriveQrSessionKey = vi.fn();
const mockDecryptFromTransport = vi.fn();

vi.mock('@adyton/shared', () => ({
  generateEphemeralKeypair: (...args: unknown[]) => mockGenerateEphemeralKeypair(...args),
  exportPublicKeySpki: (...args: unknown[]) => mockExportPublicKeySpki(...args),
  importPublicKeySpki: (...args: unknown[]) => mockImportPublicKeySpki(...args),
  deriveQrSessionKey: (...args: unknown[]) => mockDeriveQrSessionKey(...args),
  decryptFromTransport: (...args: unknown[]) => mockDecryptFromTransport(...args),
}));

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------
const mockApiFetch = vi.fn();
const mockUnlockWithRawKey = vi.fn();
const mockCryptoLock = vi.fn();
const mockFetchAll = vi.fn();
const mockVaultClear = vi.fn();
const mockRouterPush = vi.fn();

vi.mock('../../app/stores/auth', () => ({
  useAuthStore: vi.fn(() => ({ apiFetch: mockApiFetch })),
}));

vi.mock('../../app/stores/crypto', () => ({
  useCryptoStore: vi.fn(() => ({
    unlockWithRawKey: mockUnlockWithRawKey,
    lock: mockCryptoLock,
  })),
}));

vi.mock('../../app/stores/vault', () => ({
  useVaultStore: vi.fn(() => ({
    fetchAll: mockFetchAll,
    clear: mockVaultClear,
  })),
}));

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({ push: mockRouterPush })),
}));

// ---------------------------------------------------------------------------
// Mock crypto.getRandomValues to return predictable bytes
// ---------------------------------------------------------------------------
const FAKE_CHALLENGE_BYTES = new Uint8Array(32).fill(0xab);

// ---------------------------------------------------------------------------
// Import under test — after all vi.mock declarations
// ---------------------------------------------------------------------------
import { usePakQrLogin } from '../../app/composables/usePakQrLogin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fakeCryptoKey(): CryptoKey {
  return {
    type: 'secret',
    extractable: false,
    algorithm: { name: 'AES-GCM', length: 256 },
    usages: ['encrypt', 'decrypt'],
  } as unknown as CryptoKey;
}

function fakeKeypair(): CryptoKeyPair {
  return {
    privateKey: fakeCryptoKey(),
    publicKey: {
      type: 'public',
      extractable: true,
      algorithm: { name: 'ECDH', namedCurve: 'P-256' },
      usages: [],
    } as unknown as CryptoKey,
  };
}

const FAKE_SPKI = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...fake==';
const FAKE_SESSION_ID = 'test-session-id';
const FAKE_CHALLENGE_HEX = 'ab'.repeat(32);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();

  mockApiFetch.mockReset();
  mockUnlockWithRawKey.mockReset();
  mockCryptoLock.mockReset();
  mockFetchAll.mockReset();
  mockVaultClear.mockReset();
  mockRouterPush.mockReset();
  mockGenerateEphemeralKeypair.mockReset();
  mockExportPublicKeySpki.mockReset();
  mockImportPublicKeySpki.mockReset();
  mockDeriveQrSessionKey.mockReset();
  mockDecryptFromTransport.mockReset();

  // Default happy-path mock for getRandomValues
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView>(arr: T): T => {
    if (arr instanceof Uint8Array) arr.set(FAKE_CHALLENGE_BYTES.slice(0, arr.length));
    return arr;
  });

  // Default crypto mock returns
  mockGenerateEphemeralKeypair.mockResolvedValue(fakeKeypair());
  mockExportPublicKeySpki.mockResolvedValue(FAKE_SPKI);
  mockApiFetch.mockResolvedValue({ sessionId: FAKE_SESSION_ID, challengeHex: FAKE_CHALLENGE_HEX, ttlSeconds: 60 });
  mockFetchAll.mockResolvedValue(undefined);
  mockRouterPush.mockResolvedValue(undefined);
  mockUnlockWithRawKey.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePakQrLogin — start()', () => {
  it('transitions phase from idle → starting → pending', async () => {
    const pak = usePakQrLogin();
    expect(pak.phase.value).toBe('idle');

    const startPromise = pak.start();
    // After start() resolves fully, phase should be pending
    await startPromise;
    expect(pak.phase.value).toBe('pending');
  });

  it('builds a valid QR URL with adyton://pak?d= prefix', async () => {
    const pak = usePakQrLogin();
    await pak.start();

    expect(pak.qrUrl.value).not.toBeNull();
    expect(pak.qrUrl.value!.startsWith('adyton://pak?d=')).toBe(true);

    // Verify the payload decodes correctly
    const encoded = pak.qrUrl.value!.replace('adyton://pak?d=', '');
    const decoded = JSON.parse(atob(encoded));
    expect(decoded.s).toBe(FAKE_SESSION_ID);
    expect(decoded.p).toBe(FAKE_SPKI);
    // challenge hex should be 64 chars (32 bytes)
    expect(typeof decoded.c).toBe('string');
    expect(decoded.c.length).toBe(64);
  });

  it('is idempotent — second call while pending does nothing', async () => {
    const pak = usePakQrLogin();
    await pak.start();
    expect(pak.phase.value).toBe('pending');
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    // Second call — should be a no-op
    await pak.start();
    expect(mockApiFetch).toHaveBeenCalledTimes(1); // no additional call
    expect(pak.phase.value).toBe('pending');
  });

  it('sets phase to error on API failure', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'));
    const pak = usePakQrLogin();
    await pak.start();
    expect(pak.phase.value).toBe('error');
    expect(pak.error.value).toBe('Network error');
  });
});

describe('usePakQrLogin — poll()', () => {
  it('transitions to expired when server returns expired', async () => {
    const pak = usePakQrLogin();
    await pak.start();
    expect(pak.phase.value).toBe('pending');

    // Next apiFetch call (the poll) returns expired
    mockApiFetch.mockResolvedValueOnce({ status: 'expired' });
    await vi.runOnlyPendingTimersAsync();
    expect(pak.phase.value).toBe('expired');
  });

  it('transitions to denied when server returns denied', async () => {
    const pak = usePakQrLogin();
    await pak.start();

    mockApiFetch.mockResolvedValueOnce({ status: 'denied' });
    await vi.runOnlyPendingTimersAsync();
    expect(pak.phase.value).toBe('denied');
  });

  it('keeps polling when server returns pending (setTimeout called again)', async () => {
    const pak = usePakQrLogin();
    await pak.start();

    // First poll: still pending
    mockApiFetch.mockResolvedValueOnce({ status: 'pending' });
    await vi.runOnlyPendingTimersAsync();
    expect(pak.phase.value).toBe('pending');

    // Second poll: expired
    mockApiFetch.mockResolvedValueOnce({ status: 'expired' });
    await vi.runOnlyPendingTimersAsync();
    expect(pak.phase.value).toBe('expired');
  });

  it('keeps polling on transient fetch error', async () => {
    const pak = usePakQrLogin();
    await pak.start();

    // Poll throws network error
    mockApiFetch.mockRejectedValueOnce(new Error('timeout'));
    await vi.runOnlyPendingTimersAsync();
    // Still pending — should have rescheduled
    expect(pak.phase.value).toBe('pending');

    // Next poll succeeds with expired
    mockApiFetch.mockResolvedValueOnce({ status: 'expired' });
    await vi.runOnlyPendingTimersAsync();
    expect(pak.phase.value).toBe('expired');
  });
});

describe('usePakQrLogin — handleApproved()', () => {
  const FAKE_PHONE_PUB = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...phone==';
  const FAKE_CIPHERTEXT = 'encryptedPayload==';
  const FAKE_IV = 'aW5pdHZlY3Rvcg==';
  const FAKE_RAW_BYTES = new Uint8Array(32).fill(0xcc) as Uint8Array<ArrayBuffer>;

  beforeEach(() => {
    mockImportPublicKeySpki.mockResolvedValue(fakeCryptoKey());
    mockDeriveQrSessionKey.mockResolvedValue(fakeCryptoKey());
    mockDecryptFromTransport.mockResolvedValue(FAKE_RAW_BYTES);
  });

  it('calls unlockWithRawKey + fetchAll + router.push(/vault) on approved', async () => {
    const pak = usePakQrLogin();
    await pak.start();

    mockApiFetch.mockResolvedValueOnce({
      status: 'approved',
      phoneEphemeralPub: FAKE_PHONE_PUB,
      ciphertext: FAKE_CIPHERTEXT,
      iv: FAKE_IV,
      deviceId: 'device-1',
    });
    await vi.runOnlyPendingTimersAsync();

    expect(pak.phase.value).toBe('approved');
    expect(mockUnlockWithRawKey).toHaveBeenCalledWith(FAKE_RAW_BYTES.buffer);
    expect(mockFetchAll).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith('/vault');
  });

  it('sets phase=error, locks crypto, clears vault on DOMException', async () => {
    mockDecryptFromTransport.mockRejectedValueOnce(
      new DOMException('The operation failed for an operation-specific reason', 'OperationError'),
    );

    const pak = usePakQrLogin();
    await pak.start();

    mockApiFetch.mockResolvedValueOnce({
      status: 'approved',
      phoneEphemeralPub: FAKE_PHONE_PUB,
      ciphertext: FAKE_CIPHERTEXT,
      iv: FAKE_IV,
    });
    await vi.runOnlyPendingTimersAsync();

    expect(pak.phase.value).toBe('error');
    expect(mockCryptoLock).toHaveBeenCalledOnce();
    expect(mockVaultClear).toHaveBeenCalledOnce();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

describe('usePakQrLogin — cancel()', () => {
  it('calls DELETE /auth/qr-relay/:id and resets to idle', async () => {
    const pak = usePakQrLogin();
    await pak.start();
    expect(pak.phase.value).toBe('pending');

    // cancel() makes a best-effort DELETE; reset the mock to track just this call
    mockApiFetch.mockResolvedValueOnce(undefined);
    await pak.cancel();

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/auth/qr-relay/${FAKE_SESSION_ID}`,
      { method: 'DELETE' },
    );
    expect(pak.phase.value).toBe('idle');
    expect(pak.qrUrl.value).toBeNull();
  });

  it('resets to idle even when DELETE throws', async () => {
    const pak = usePakQrLogin();
    await pak.start();

    mockApiFetch.mockRejectedValueOnce(new Error('Network error'));
    await pak.cancel();

    expect(pak.phase.value).toBe('idle');
  });
});

describe('usePakQrLogin — reset()', () => {
  it('returns to idle and clears error without calling DELETE', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('start failed'));
    const pak = usePakQrLogin();
    await pak.start();
    expect(pak.phase.value).toBe('error');
    expect(pak.error.value).toBeTruthy();

    const callCountBeforeReset = mockApiFetch.mock.calls.length;
    pak.reset();

    expect(pak.phase.value).toBe('idle');
    expect(pak.error.value).toBeNull();
    expect(pak.qrUrl.value).toBeNull();
    // No additional API calls
    expect(mockApiFetch.mock.calls.length).toBe(callCountBeforeReset);
  });

  it('allows start() again after reset() from terminal state', async () => {
    const pak = usePakQrLogin();
    await pak.start();
    // Move to expired
    mockApiFetch.mockResolvedValueOnce({ status: 'expired' });
    await vi.runOnlyPendingTimersAsync();
    expect(pak.phase.value).toBe('expired');

    // reset + start should work
    pak.reset();
    expect(pak.phase.value).toBe('idle');

    mockApiFetch.mockResolvedValue({ sessionId: 'new-session', challengeHex: FAKE_CHALLENGE_HEX, ttlSeconds: 60 });
    await pak.start();
    expect(pak.phase.value).toBe('pending');
  });
});
