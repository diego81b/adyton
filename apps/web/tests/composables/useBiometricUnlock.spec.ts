import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ---------------------------------------------------------------------------
// All plugin imports inside useBiometricUnlock are dynamic (await import(...)).
// We mock each module at the vi.mock level so those dynamic imports resolve to
// our fakes. We also mock useArgon2Worker to keep crypto store tests hermetic.
// ---------------------------------------------------------------------------

// --- useArgon2Worker (used by crypto store deriveKey + unlockWithRawKey) ---
const mockImportVaultKey = vi.fn();
vi.mock('../../app/composables/useArgon2Worker', () => ({
  useArgon2Worker: vi.fn(),
  deriveRawKey: vi.fn(),
  importVaultKey: (...args: unknown[]) => mockImportVaultKey(...args),
}));

// --- @aparajita/capacitor-secure-storage ---
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockStorageRemove = vi.fn();
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: (...args: unknown[]) => mockStorageGet(...args),
    set: (...args: unknown[]) => mockStorageSet(...args),
    remove: (...args: unknown[]) => mockStorageRemove(...args),
  },
  StorageErrorType: {
    missingKey: 'missingKey',
    invalidData: 'invalidData',
    osError: 'osError',
    unknownError: 'unknownError',
  },
  StorageError: class StorageError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

// --- @aparajita/capacitor-biometric-auth ---
const mockCheckBiometry = vi.fn();
const mockAuthenticate = vi.fn();
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: () => mockCheckBiometry(),
    authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  },
  BiometryErrorType: {
    none: '',
    userCancel: 'userCancel',
    systemCancel: 'systemCancel',
    appCancel: 'appCancel',
    userFallback: 'userFallback',
    biometryLockout: 'biometryLockout',
    authenticationFailed: 'authenticationFailed',
  },
  BiometryError: class BiometryError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

// --- @capacitor/core ---
let isNativePlatform = true; // default: native for most tests
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform,
    getPlatform: () => (isNativePlatform ? 'ios' : 'web'),
  },
}));

// ---------------------------------------------------------------------------
// Import under test — after all vi.mock declarations.
// ---------------------------------------------------------------------------
import { useBiometricUnlock } from '../../app/composables/useBiometricUnlock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fakeRawKey(fill = 0xab): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  new Uint8Array(buf).fill(fill);
  return buf;
}

function fakeCryptoKey(extractable = false): CryptoKey {
  return {
    type: 'secret',
    extractable,
    algorithm: { name: 'AES-GCM', length: 256 },
    usages: ['encrypt', 'decrypt'],
  } as unknown as CryptoKey;
}

// Hex of a 32-byte buffer filled with 0xab
const HEX_0XAB = 'ab'.repeat(32);

beforeEach(() => {
  setActivePinia(createPinia());
  isNativePlatform = true;
  mockStorageGet.mockReset();
  mockStorageSet.mockReset();
  mockStorageRemove.mockReset();
  mockCheckBiometry.mockReset();
  mockAuthenticate.mockReset();
  mockImportVaultKey.mockReset();

  // Default: biometry available
  mockCheckBiometry.mockResolvedValue({ isAvailable: true });
  // Default: auth succeeds (no throw)
  mockAuthenticate.mockResolvedValue(undefined);
  // Default: importVaultKey returns a fake key
  mockImportVaultKey.mockResolvedValue(fakeCryptoKey());
});

// ---------------------------------------------------------------------------
// isSupported
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.isSupported', () => {
  it('returns false on web platform (never calls BiometricAuth)', async () => {
    isNativePlatform = false;
    const { isSupported } = useBiometricUnlock();
    expect(await isSupported()).toBe(false);
    expect(mockCheckBiometry).not.toHaveBeenCalled();
  });

  it('returns true when BiometricAuth.checkBiometry().isAvailable is true', async () => {
    mockCheckBiometry.mockResolvedValue({ isAvailable: true });
    const { isSupported } = useBiometricUnlock();
    expect(await isSupported()).toBe(true);
  });

  it('returns false when BiometricAuth.checkBiometry().isAvailable is false', async () => {
    mockCheckBiometry.mockResolvedValue({ isAvailable: false });
    const { isSupported } = useBiometricUnlock();
    expect(await isSupported()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEnrolled
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.isEnrolled', () => {
  it('returns false when storage key is absent (null)', async () => {
    mockStorageGet.mockResolvedValue(null);
    const { isEnrolled } = useBiometricUnlock();
    expect(await isEnrolled('user-1')).toBe(false);
    expect(mockStorageGet).toHaveBeenCalledWith('adyton.vaultKey.user-1');
  });

  it('returns true when storage has an entry for the userId', async () => {
    mockStorageGet.mockResolvedValue(HEX_0XAB);
    const { isEnrolled } = useBiometricUnlock();
    expect(await isEnrolled('user-1')).toBe(true);
  });

  it('uses the correct storage key prefix + userId', async () => {
    mockStorageGet.mockResolvedValue(null);
    const { isEnrolled } = useBiometricUnlock();
    await isEnrolled('test-user-xyz');
    expect(mockStorageGet).toHaveBeenCalledWith('adyton.vaultKey.test-user-xyz');
  });
});

// ---------------------------------------------------------------------------
// enroll
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.enroll', () => {
  it('throws on web platform', async () => {
    isNativePlatform = false;
    const { enroll } = useBiometricUnlock();
    await expect(enroll('user-1', fakeRawKey())).rejects.toThrow(/web platform/i);
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('stores hex encoding of raw bytes under the correct key', async () => {
    const raw = fakeRawKey(0xab);
    const { enroll } = useBiometricUnlock();
    await enroll('user-1', raw);
    expect(mockStorageSet).toHaveBeenCalledWith('adyton.vaultKey.user-1', HEX_0XAB);
  });

  it('stores different hex for different raw bytes', async () => {
    const rawA = fakeRawKey(0x01);
    const rawB = fakeRawKey(0x02);
    const { enroll } = useBiometricUnlock();

    await enroll('user-A', rawA);
    await enroll('user-B', rawB);

    const callA = mockStorageSet.mock.calls[0];
    const callB = mockStorageSet.mock.calls[1];
    expect(callA[1]).toBe('01'.repeat(32));
    expect(callB[1]).toBe('02'.repeat(32));
    expect(callA[1]).not.toBe(callB[1]);
  });

  it('stores under user-specific key (two users isolated)', async () => {
    const { enroll } = useBiometricUnlock();
    await enroll('alice', fakeRawKey());
    await enroll('bob', fakeRawKey());
    expect(mockStorageSet.mock.calls[0][0]).toBe('adyton.vaultKey.alice');
    expect(mockStorageSet.mock.calls[1][0]).toBe('adyton.vaultKey.bob');
  });
});

// ---------------------------------------------------------------------------
// unenroll
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.unenroll', () => {
  it('calls storage.remove with the correct key', async () => {
    mockStorageRemove.mockResolvedValue(true);
    const { unenroll } = useBiometricUnlock();
    await unenroll('user-1');
    expect(mockStorageRemove).toHaveBeenCalledWith('adyton.vaultKey.user-1');
  });

  it('does not throw when the key is absent (remove returns false)', async () => {
    mockStorageRemove.mockResolvedValue(false);
    const { unenroll } = useBiometricUnlock();
    await expect(unenroll('user-1')).resolves.toBeUndefined();
  });

  it('does not throw when storage.remove rejects (key never existed)', async () => {
    mockStorageRemove.mockRejectedValue(new Error('key not found'));
    const { unenroll } = useBiometricUnlock();
    await expect(unenroll('user-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// unlockWithBiometrics
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.unlockWithBiometrics', () => {
  it('returns false when not enrolled (no storage entry)', async () => {
    mockStorageGet.mockResolvedValue(null);
    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('returns true and unlocks store on successful biometric auth', async () => {
    mockStorageGet.mockResolvedValue(HEX_0XAB);
    mockAuthenticate.mockResolvedValue(undefined); // success
    const key = fakeCryptoKey();
    mockImportVaultKey.mockResolvedValue(key);

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(true);
    // importVaultKey was called with the decoded bytes
    expect(mockImportVaultKey).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  it('returns false on userCancel', async () => {
    mockStorageGet.mockResolvedValue(HEX_0XAB);
    const { BiometryError, BiometryErrorType } = await import('@aparajita/capacitor-biometric-auth');
    mockAuthenticate.mockRejectedValue(new BiometryError('cancelled', BiometryErrorType.userCancel));

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
  });

  it('returns false on systemCancel', async () => {
    mockStorageGet.mockResolvedValue(HEX_0XAB);
    const { BiometryError, BiometryErrorType } = await import('@aparajita/capacitor-biometric-auth');
    mockAuthenticate.mockRejectedValue(new BiometryError('sys cancel', BiometryErrorType.systemCancel));

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
  });

  it('returns false on appCancel', async () => {
    mockStorageGet.mockResolvedValue(HEX_0XAB);
    const { BiometryError, BiometryErrorType } = await import('@aparajita/capacitor-biometric-auth');
    mockAuthenticate.mockRejectedValue(new BiometryError('app cancel', BiometryErrorType.appCancel));

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
  });

  it('returns false on userFallback (user chose PIN entry instead)', async () => {
    mockStorageGet.mockResolvedValue(HEX_0XAB);
    const { BiometryError, BiometryErrorType } = await import('@aparajita/capacitor-biometric-auth');
    mockAuthenticate.mockRejectedValue(new BiometryError('fallback', BiometryErrorType.userFallback));

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
  });

  it('returns false on biometryLockout', async () => {
    mockStorageGet.mockResolvedValue(HEX_0XAB);
    const { BiometryError, BiometryErrorType } = await import('@aparajita/capacitor-biometric-auth');
    mockAuthenticate.mockRejectedValue(new BiometryError('lockout', BiometryErrorType.biometryLockout));

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
  });

  it('unenrolls and returns false when stored data is corrupt (StorageErrorType.invalidData)', async () => {
    const { StorageError, StorageErrorType } = await import('@aparajita/capacitor-secure-storage');
    mockStorageGet.mockRejectedValue(new StorageError('corrupt', StorageErrorType.invalidData));
    mockStorageRemove.mockResolvedValue(true);

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(false);
    expect(mockStorageRemove).toHaveBeenCalledWith('adyton.vaultKey.user-1');
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('unenrolls and returns false when stored hex is undecodable (wrong length)', async () => {
    // A valid-looking but odd-length hex string that cannot decode to 32 bytes
    mockStorageGet.mockResolvedValue('not-valid-hex!!!');
    mockStorageRemove.mockResolvedValue(true);

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(false);
    expect(mockStorageRemove).toHaveBeenCalledWith('adyton.vaultKey.user-1');
  });

  it('unenrolls and returns false when stored hex is valid but wrong byte count (33 bytes)', async () => {
    // 66 hex chars = 33 bytes — syntactically valid hex, but not a 256-bit key.
    // Pins the exact-length enforcement of the stored-value validator.
    mockStorageGet.mockResolvedValue('ab'.repeat(33));
    mockStorageRemove.mockResolvedValue(true);

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(false);
    expect(mockStorageRemove).toHaveBeenCalledWith('adyton.vaultKey.user-1');
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('re-throws unexpected errors (not cancel/corrupt) to surface bugs', async () => {
    mockStorageGet.mockResolvedValue(HEX_0XAB);
    mockAuthenticate.mockRejectedValue(new Error('unexpected hardware failure'));

    const { unlockWithBiometrics } = useBiometricUnlock();
    await expect(unlockWithBiometrics('user-1')).rejects.toThrow('unexpected hardware failure');
  });
});

// ---------------------------------------------------------------------------
// verifyRawKeyMatches
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.verifyRawKeyMatches', () => {
  it('returns true when candidate raw bytes produce a key that decrypts correctly', async () => {
    const rawBytes = fakeRawKey(0x77);

    // Import a real CryptoKey for this round-trip test (Web Crypto available in happy-dom)
    const currentKey = await crypto.subtle.importKey(
      'raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
    );

    const { verifyRawKeyMatches } = useBiometricUnlock();
    expect(await verifyRawKeyMatches(rawBytes, currentKey)).toBe(true);
  });

  it('returns false when candidate raw bytes differ from the current key', async () => {
    const rawCurrent = fakeRawKey(0x11);
    const rawCandidate = fakeRawKey(0x22);

    const currentKey = await crypto.subtle.importKey(
      'raw', rawCurrent, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
    );

    const { verifyRawKeyMatches } = useBiometricUnlock();
    expect(await verifyRawKeyMatches(rawCandidate, currentKey)).toBe(false);
  });

  it('never calls crypto.subtle.exportKey (non-extractable invariant)', async () => {
    const exportSpy = vi.spyOn(crypto.subtle, 'exportKey');
    const rawBytes = fakeRawKey(0x55);
    const currentKey = await crypto.subtle.importKey(
      'raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
    );

    const { verifyRawKeyMatches } = useBiometricUnlock();
    await verifyRawKeyMatches(rawBytes, currentKey);

    expect(exportSpy).not.toHaveBeenCalled();
    exportSpy.mockRestore();
  });

  it('handles very different keys reliably (encrypt/decrypt mismatch)', async () => {
    const rawA = new ArrayBuffer(32); new Uint8Array(rawA).fill(0xaa);
    const rawB = new ArrayBuffer(32); new Uint8Array(rawB).fill(0xbb);

    const keyA = await crypto.subtle.importKey('raw', rawA, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

    const { verifyRawKeyMatches } = useBiometricUnlock();
    expect(await verifyRawKeyMatches(rawB, keyA)).toBe(false);
  });
});
