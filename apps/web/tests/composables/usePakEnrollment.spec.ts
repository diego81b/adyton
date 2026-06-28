import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ---------------------------------------------------------------------------
// @adyton/shared — spread real module, stub the async crypto operations only.
// PAK_PROTOCOL and hexToBytes remain real so protocol constants + hex conversion
// stay authentic in tests.
// ---------------------------------------------------------------------------
const mockGenerateEphemeralKeypair = vi.fn();
const mockExportPublicKeySpki = vi.fn();
const mockImportPublicKeySpki = vi.fn();
const mockDeriveQrSessionKey = vi.fn();
const mockEncryptForTransport = vi.fn();

vi.mock('@adyton/shared', async (orig) => {
  const real = await orig<typeof import('@adyton/shared')>();
  return {
    ...real,
    generateEphemeralKeypair: () => mockGenerateEphemeralKeypair(),
    exportPublicKeySpki: (...args: unknown[]) => mockExportPublicKeySpki(...args),
    importPublicKeySpki: (...args: unknown[]) => mockImportPublicKeySpki(...args),
    deriveQrSessionKey: (...args: unknown[]) => mockDeriveQrSessionKey(...args),
    encryptForTransport: (...args: unknown[]) => mockEncryptForTransport(...args),
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
    isSupported: vi.fn(),
    isEnrolled: vi.fn(),
    enroll: vi.fn(),
    unenroll: vi.fn(),
    unlockWithBiometrics: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Auth store — apiFetch + user
// ---------------------------------------------------------------------------
const mockApiFetch = vi.fn();
let mockUser: { id: string; kdfSalt: string; email: string; totpEnabled: boolean } | null = {
  id: 'user-1',
  kdfSalt: 'aa'.repeat(32),
  email: 'test@example.com',
  totpEnabled: false,
};

vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
    get user() { return mockUser; },
  }),
}));

// ---------------------------------------------------------------------------
// Crypto store — cryptoKey
// ---------------------------------------------------------------------------
let mockCryptoKey: CryptoKey | null = null;

vi.mock('../../app/stores/crypto', () => ({
  useCryptoStore: () => ({
    get cryptoKey() { return mockCryptoKey; },
  }),
}));

// ---------------------------------------------------------------------------
// @capacitor/core — not native in composable tests
// ---------------------------------------------------------------------------
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
}));

// ---------------------------------------------------------------------------
// Import under test — after all vi.mock declarations
// ---------------------------------------------------------------------------
import { usePakEnrollment } from '../../app/composables/usePakEnrollment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fakeRawKey(): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  new Uint8Array(buf).fill(0xab);
  return buf;
}

function fakeCryptoKey(): CryptoKey {
  return {
    type: 'secret',
    extractable: false,
    algorithm: { name: 'AES-GCM', length: 256 },
    usages: ['encrypt', 'decrypt'],
  } as unknown as CryptoKey;
}

function fakeKeypair() {
  return {
    privateKey: fakeCryptoKey(),
    publicKey: fakeCryptoKey(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());

  mockUser = { id: 'user-1', kdfSalt: 'aa'.repeat(32), email: 'test@example.com', totpEnabled: false };
  mockCryptoKey = fakeCryptoKey();

  mockGenerateEphemeralKeypair.mockReset();
  mockExportPublicKeySpki.mockReset();
  mockImportPublicKeySpki.mockReset();
  mockDeriveQrSessionKey.mockReset();
  mockEncryptForTransport.mockReset();
  mockDeriveRawKey.mockReset();
  mockVerifyRawKeyMatches.mockReset();
  mockApiFetch.mockReset();

  // Default: crypto ops succeed
  mockGenerateEphemeralKeypair.mockResolvedValue(fakeKeypair());
  mockExportPublicKeySpki.mockResolvedValue('spki-base64');
  mockImportPublicKeySpki.mockResolvedValue(fakeCryptoKey());
  mockDeriveQrSessionKey.mockResolvedValue(fakeCryptoKey());
  mockEncryptForTransport.mockResolvedValue({ ciphertext: 'ct-base64', iv: 'iv-base64' });
  mockDeriveRawKey.mockResolvedValue(fakeRawKey());
  mockVerifyRawKeyMatches.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------
describe('usePakEnrollment.start', () => {
  it('transitions idle → starting → qr-shown and calls POST /auth/enroll-session', async () => {
    mockApiFetch.mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 });

    const { phase, qrUrl, start } = usePakEnrollment();
    expect(phase.value).toBe('idle');

    const started = start();
    expect(phase.value).toBe('starting');
    await started;

    expect(phase.value).toBe('qr-shown');
    expect(qrUrl.value).not.toBeNull();
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/auth/enroll-session',
      expect.objectContaining({ method: 'POST', body: expect.objectContaining({ desktopPublicKeySpki: 'spki-base64' }) }),
    );
  });

  it('builds QR URL with m:"enroll" in the payload', async () => {
    mockApiFetch.mockResolvedValueOnce({ sessionId: 'sess-abc', ttlSeconds: 60 });

    const { qrUrl, start } = usePakEnrollment();
    await start();

    expect(qrUrl.value).toMatch(/^adyton:\/\/pak\?d=/);
    const encoded = qrUrl.value!.replace('adyton://pak?d=', '');
    const payload = JSON.parse(atob(encoded));
    expect(payload.m).toBe('enroll');
    expect(payload.s).toBe('sess-abc');
    expect(payload.p).toBe('spki-base64');
  });

  it('does nothing if phase is not idle', async () => {
    mockApiFetch.mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 });
    const { phase, start } = usePakEnrollment();

    // Start once to move past idle
    await start();
    expect(phase.value).toBe('qr-shown');

    // Attempt to start again — must be no-op
    mockApiFetch.mockClear();
    await start();
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(phase.value).toBe('qr-shown');
  });

  it('transitions to error if the API call fails', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('network error'));

    const { phase, error, start } = usePakEnrollment();
    await start();

    expect(phase.value).toBe('error');
    expect(error.value).toBe('network error');
  });
});

// ---------------------------------------------------------------------------
// pollEnrollStatus — phone_ready
// ---------------------------------------------------------------------------
describe('usePakEnrollment.pollEnrollStatus — phone_ready', () => {
  it('sets connectedDeviceId and transitions to phone-connected when phone_ready', async () => {
    // First call: session creation; second: poll returning phone_ready
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockResolvedValueOnce({ status: 'phone_ready', phoneEphemeralPub: 'pub-b64', deviceId: 'dev-1' });

    const { phase, connectedDeviceId, start } = usePakEnrollment();
    await start();
    expect(phase.value).toBe('qr-shown');

    // Advance to trigger the scheduled poll
    await vi.advanceTimersByTimeAsync(2000);

    expect(phase.value).toBe('phone-connected');
    expect(connectedDeviceId.value).toBe('dev-1');
  });

  it('stops scheduling polls after phone_ready', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockResolvedValueOnce({ status: 'phone_ready', phoneEphemeralPub: 'pub-b64', deviceId: 'dev-1' });

    const { start } = usePakEnrollment();
    await start();
    await vi.advanceTimersByTimeAsync(2000);

    const callCountAfterPhoneReady = mockApiFetch.mock.calls.length;
    // Advance again — no more polls should fire
    await vi.advanceTimersByTimeAsync(4000);
    expect(mockApiFetch.mock.calls.length).toBe(callCountAfterPhoneReady);
  });
});

// ---------------------------------------------------------------------------
// pollEnrollStatus — waiting
// ---------------------------------------------------------------------------
describe('usePakEnrollment.pollEnrollStatus — waiting', () => {
  it('stays qr-shown and reschedules the next poll when status is waiting', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockResolvedValueOnce({ status: 'waiting' })
      .mockResolvedValueOnce({ status: 'waiting' });

    const { phase, start } = usePakEnrollment();
    await start();

    await vi.advanceTimersByTimeAsync(2000);
    expect(phase.value).toBe('qr-shown');

    await vi.advanceTimersByTimeAsync(2000);
    expect(phase.value).toBe('qr-shown');

    // Three apiFetch calls: session create + 2 polls
    expect(mockApiFetch).toHaveBeenCalledTimes(3);
  });

  it('keeps polling on transient network errors', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ status: 'waiting' });

    const { phase, start } = usePakEnrollment();
    await start();

    await vi.advanceTimersByTimeAsync(2000);
    expect(phase.value).toBe('qr-shown');

    await vi.advanceTimersByTimeAsync(2000);
    expect(phase.value).toBe('qr-shown');
  });
});

// ---------------------------------------------------------------------------
// confirmAndSend()
// ---------------------------------------------------------------------------
describe('usePakEnrollment.confirmAndSend', () => {
  it('does nothing if phase is not phone-connected', async () => {
    const { phase, confirmAndSend } = usePakEnrollment();
    expect(phase.value).toBe('idle');

    await confirmAndSend('password');
    expect(mockDeriveRawKey).not.toHaveBeenCalled();
    expect(phase.value).toBe('idle');
  });

  it('transitions to error with "Wrong master password." when verifyRawKeyMatches returns false', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockResolvedValueOnce({ status: 'phone_ready', phoneEphemeralPub: 'pub-b64', deviceId: 'dev-1' });
    mockVerifyRawKeyMatches.mockResolvedValue(false);

    const { phase, error, start, confirmAndSend } = usePakEnrollment();
    await start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(phase.value).toBe('phone-connected');

    await confirmAndSend('wrong-password');

    expect(phase.value).toBe('error');
    expect(error.value).toBe('Wrong master password.');
    expect(mockEncryptForTransport).not.toHaveBeenCalled();
  });

  it('derives session key, encrypts, POSTs enroll-vault, sets localStorage, transitions to enrolled', async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockResolvedValueOnce({ status: 'phone_ready', phoneEphemeralPub: 'pub-b64', deviceId: 'dev-42' })
      .mockResolvedValueOnce(undefined); // enroll-vault

    const { phase, start, confirmAndSend } = usePakEnrollment();
    await start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(phase.value).toBe('phone-connected');

    await confirmAndSend('correct-password');

    expect(mockDeriveRawKey).toHaveBeenCalledWith('correct-password', 'aa'.repeat(32));
    expect(mockVerifyRawKeyMatches).toHaveBeenCalled();
    expect(mockImportPublicKeySpki).toHaveBeenCalledWith('pub-b64');
    expect(mockDeriveQrSessionKey).toHaveBeenCalled();
    expect(mockEncryptForTransport).toHaveBeenCalled();

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/auth/enroll-vault/sess-1',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ ciphertext: 'ct-base64', iv: 'iv-base64' }),
      }),
    );

    expect(localStorageSpy).toHaveBeenCalledWith('adyton_pak_device_user-1', 'dev-42');
    expect(phase.value).toBe('enrolled');

    localStorageSpy.mockRestore();
  });

  it('transitions to error if vault is locked (cryptoKey is null)', async () => {
    mockCryptoKey = null;
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockResolvedValueOnce({ status: 'phone_ready', phoneEphemeralPub: 'pub-b64', deviceId: 'dev-1' });

    const { phase, error, start, confirmAndSend } = usePakEnrollment();
    await start();
    await vi.advanceTimersByTimeAsync(2000);

    await confirmAndSend('some-password');

    expect(phase.value).toBe('error');
    expect(error.value).toMatch(/locked/i);
    expect(mockEncryptForTransport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cancel()
// ---------------------------------------------------------------------------
describe('usePakEnrollment.cancel', () => {
  it('clears the poll timer, DELETEs the session, and resets to idle', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockResolvedValueOnce(undefined); // DELETE

    const { phase, start, cancel } = usePakEnrollment();
    await start();
    expect(phase.value).toBe('qr-shown');

    await cancel();

    expect(phase.value).toBe('idle');
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/auth/enroll-session/sess-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('still resets to idle even if DELETE fails', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ sessionId: 'sess-1', ttlSeconds: 60 })
      .mockRejectedValueOnce(new Error('server error'));

    const { phase, start, cancel } = usePakEnrollment();
    await start();
    await cancel();

    expect(phase.value).toBe('idle');
  });

  it('does not call DELETE if no session was started', async () => {
    const { cancel } = usePakEnrollment();
    await cancel();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------
describe('usePakEnrollment.reset', () => {
  it('resets phase to idle and clears error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('some failure'));

    const { phase, error, start, reset } = usePakEnrollment();
    await start();
    expect(phase.value).toBe('error');

    reset();

    expect(phase.value).toBe('idle');
    expect(error.value).toBeNull();
  });
});
