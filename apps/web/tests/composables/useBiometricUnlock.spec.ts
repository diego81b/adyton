import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// --- @adyton/capacitor-keystore ---
const mockKeystoreHasKeys = vi.fn();
const mockKeystoreHasRawKey = vi.fn();
const mockKeystoreUnsealVaultKey = vi.fn();
const mockKeystoreSealVaultKey = vi.fn();
const mockKeystoreDeleteKeys = vi.fn();
vi.mock('@adyton/capacitor-keystore', () => ({
  AdytonKeystore: {
    hasKeys: (...args: unknown[]) => mockKeystoreHasKeys(...args),
    hasRawKey: (...args: unknown[]) => mockKeystoreHasRawKey(...args),
    unsealVaultKey: (...args: unknown[]) => mockKeystoreUnsealVaultKey(...args),
    sealVaultKey: (...args: unknown[]) => mockKeystoreSealVaultKey(...args),
    deleteKeys: (...args: unknown[]) => mockKeystoreDeleteKeys(...args),
  },
}));

// --- @aparajita/capacitor-biometric-auth (used only by isSupported) ---
const mockCheckBiometry = vi.fn();
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: () => mockCheckBiometry(),
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
    getPlatform: () => (isNativePlatform ? 'android' : 'web'),
  },
}));

// ---------------------------------------------------------------------------
// localStorage shim — happy-dom exposes it on window but not as a bare global
// in the Node/Vitest test runner context. Provide a simple Map-backed shim
// so tests can use localStorage.setItem / getItem / removeItem / clear.
// ---------------------------------------------------------------------------
const localStorageStore = new Map<string, string>();
const localStorageShim = {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageStore.set(key, value); },
  removeItem: (key: string) => { localStorageStore.delete(key); },
  clear: () => { localStorageStore.clear(); },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageShim,
  writable: true,
  configurable: true,
});

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

// Base64 encoding of 32 bytes of 0xab — matches vaultKeyRaw from unsealVaultKey
const RAW_0XAB_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(0xab)));

const PAK_DEVICE_KEY_PREFIX = 'adyton_pak_device_';
const PHASE8_DEVICE_KEY_PREFIX = 'adyton.phase8_device_';

beforeEach(() => {
  setActivePinia(createPinia());
  isNativePlatform = true;
  mockCheckBiometry.mockReset();
  mockImportVaultKey.mockReset();
  mockKeystoreHasKeys.mockReset();
  mockKeystoreHasRawKey.mockReset();
  mockKeystoreUnsealVaultKey.mockReset();
  mockKeystoreSealVaultKey.mockReset();
  mockKeystoreDeleteKeys.mockReset();

  // Default: biometry available
  mockCheckBiometry.mockResolvedValue({ isAvailable: true });
  // Default: importVaultKey returns a fake key
  mockImportVaultKey.mockResolvedValue(fakeCryptoKey());
  // Default: keystore keys exist
  mockKeystoreHasKeys.mockResolvedValue({ exists: true });
  mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
  // Default: unseal returns valid 32-byte key in base64
  mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: RAW_0XAB_B64 });
  // Default: seal and delete succeed
  mockKeystoreSealVaultKey.mockResolvedValue(undefined);
  mockKeystoreDeleteKeys.mockResolvedValue(undefined);
  // Clear localStorage between tests
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

afterEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
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
// isEnrolled — PAK path
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.isEnrolled (PAK path)', () => {
  it('returns true when PAK device ID is in localStorage and SE keys exist', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockResolvedValue({ exists: true });

    const { isEnrolled } = useBiometricUnlock();
    expect(await isEnrolled('user-1')).toBe(true);
    expect(mockKeystoreHasKeys).toHaveBeenCalledWith({ deviceId: 'device-uuid-pak' });
    expect(mockKeystoreHasRawKey).not.toHaveBeenCalled();
  });

  it('cleans up stale PAK entry and falls through to Phase 8 check when SE keys are absent', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'stale-device-id');
    mockKeystoreHasKeys.mockResolvedValue({ exists: false });
    mockKeystoreHasRawKey.mockResolvedValue({ exists: false });

    const { isEnrolled } = useBiometricUnlock();
    const result = await isEnrolled('user-1');

    expect(result).toBe(false);
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
  });

  it('guards against keystore plugin throwing (returns false gracefully)', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockRejectedValue(new Error('plugin unavailable'));

    const { isEnrolled } = useBiometricUnlock();
    const result = await isEnrolled('user-1');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEnrolled — Phase 8 path
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.isEnrolled (Phase 8 path)', () => {
  it('returns false when no localStorage entry for Phase 8 (not enrolled)', async () => {
    const { isEnrolled } = useBiometricUnlock();
    expect(await isEnrolled('user-1')).toBe(false);
    expect(mockKeystoreHasKeys).not.toHaveBeenCalled();
    expect(mockKeystoreHasRawKey).not.toHaveBeenCalled();
  });

  it('returns true when Phase 8 device ID is in localStorage and wrap key exists', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-device-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });

    const { isEnrolled } = useBiometricUnlock();
    expect(await isEnrolled('user-1')).toBe(true);
    expect(mockKeystoreHasRawKey).toHaveBeenCalledWith({ deviceId: 'phase8-device-uuid' });
    expect(mockKeystoreHasKeys).not.toHaveBeenCalled();
  });

  it('cleans up stale Phase 8 entry when wrap key is gone', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'stale-phase8-id');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: false });

    const { isEnrolled } = useBiometricUnlock();
    const result = await isEnrolled('user-1');

    expect(result).toBe(false);
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
  });

  it('falls through to Phase 8 when PAK check fails', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'pak-id');
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-id');
    mockKeystoreHasKeys.mockResolvedValue({ exists: false });
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });

    const { isEnrolled } = useBiometricUnlock();
    expect(await isEnrolled('user-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// enroll — Phase 8 path
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.enroll', () => {
  it('throws on web platform', async () => {
    isNativePlatform = false;
    const { enroll } = useBiometricUnlock();
    await expect(enroll('user-1', fakeRawKey())).rejects.toThrow(/web platform/i);
    expect(mockKeystoreSealVaultKey).not.toHaveBeenCalled();
  });

  it('generates a Phase 8 device ID, stores in localStorage, and calls sealVaultKey', async () => {
    const { enroll } = useBiometricUnlock();
    await enroll('user-1', fakeRawKey(0xab));

    // Phase 8 device ID written to localStorage
    const phase8Id = localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1');
    expect(phase8Id).not.toBeNull();
    expect(typeof phase8Id).toBe('string');

    // sealVaultKey called with that device ID and the base64-encoded key
    expect(mockKeystoreSealVaultKey).toHaveBeenCalledWith({
      deviceId: phase8Id,
      vaultKeyRaw: btoa(String.fromCharCode(...new Uint8Array(32).fill(0xab))),
    });
  });

  it('reuses existing Phase 8 device ID on re-enroll', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'existing-phase8-id');
    const { enroll } = useBiometricUnlock();
    await enroll('user-1', fakeRawKey());

    expect(mockKeystoreSealVaultKey).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'existing-phase8-id' }),
    );
    // ID must not change
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBe('existing-phase8-id');
  });

  it('encodes different raw bytes as different base64 values', async () => {
    const { enroll } = useBiometricUnlock();
    await enroll('user-A', fakeRawKey(0x01));
    await enroll('user-B', fakeRawKey(0x02));

    const callA = mockKeystoreSealVaultKey.mock.calls[0][0].vaultKeyRaw as string;
    const callB = mockKeystoreSealVaultKey.mock.calls[1][0].vaultKeyRaw as string;
    expect(callA).not.toBe(callB);
    expect(callA).toBe(btoa(String.fromCharCode(...new Uint8Array(32).fill(0x01))));
    expect(callB).toBe(btoa(String.fromCharCode(...new Uint8Array(32).fill(0x02))));
  });

  // VULN-001 regression: biometric must be OS-enforced (sealVaultKey shows BiometricPrompt
  // internally via CryptoObject) — the composable must NOT call a separate authenticate().
  it('does not call a standalone BiometricAuth.authenticate (biometric is internal to sealVaultKey)', async () => {
    const { enroll } = useBiometricUnlock();
    await enroll('user-1', fakeRawKey());
    // No direct call to any separate biometric auth — it's inside sealVaultKey plugin.
    // Assert sealVaultKey was called (the OS prompt happens within the Kotlin plugin).
    expect(mockKeystoreSealVaultKey).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// unenroll
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.unenroll', () => {
  it('deletes PAK keys and removes localStorage entry when PAK enrolled', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'pak-device-id');

    const { unenroll } = useBiometricUnlock();
    await unenroll('user-1');

    expect(mockKeystoreDeleteKeys).toHaveBeenCalledWith({ deviceId: 'pak-device-id' });
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
  });

  it('deletes Phase 8 keys and removes localStorage entry when Phase 8 enrolled', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-device-id');

    const { unenroll } = useBiometricUnlock();
    await unenroll('user-1');

    expect(mockKeystoreDeleteKeys).toHaveBeenCalledWith({ deviceId: 'phase8-device-id' });
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
  });

  it('deletes both PAK and Phase 8 keys when both are enrolled', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'pak-id');
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-id');

    const { unenroll } = useBiometricUnlock();
    await unenroll('user-1');

    expect(mockKeystoreDeleteKeys).toHaveBeenCalledWith({ deviceId: 'pak-id' });
    expect(mockKeystoreDeleteKeys).toHaveBeenCalledWith({ deviceId: 'phase8-id' });
    expect(mockKeystoreDeleteKeys).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when not enrolled (no localStorage entries)', async () => {
    const { unenroll } = useBiometricUnlock();
    await expect(unenroll('user-1')).resolves.toBeUndefined();
    expect(mockKeystoreDeleteKeys).not.toHaveBeenCalled();
  });

  it('ignores keystore deletion errors (keys already absent on reinstall)', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'pak-id');
    mockKeystoreDeleteKeys.mockRejectedValue(new Error('keys not found'));

    const { unenroll } = useBiometricUnlock();
    await expect(unenroll('user-1')).resolves.toBeUndefined();
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// unlockWithBiometrics — PAK path
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.unlockWithBiometrics (PAK path)', () => {
  it('uses AdytonKeystore.unsealVaultKey and unlocks vault on success', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockResolvedValue({ exists: true });
    mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: RAW_0XAB_B64 });

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(true);
    expect(mockKeystoreUnsealVaultKey).toHaveBeenCalledWith({ deviceId: 'device-uuid-pak' });
    expect(mockImportVaultKey).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(mockKeystoreHasRawKey).not.toHaveBeenCalled();
  });

  it('cleans up stale entry and returns false when SE keys are absent', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockResolvedValue({ exists: false });

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(false);
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
    expect(mockKeystoreUnsealVaultKey).not.toHaveBeenCalled();
  });

  it('returns false and cleans up when vaultKeyRaw decodes to wrong byte length', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockResolvedValue({ exists: true });
    const shortKey = btoa(String.fromCharCode(...new Uint8Array(31).fill(0xcc)));
    mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: shortKey });

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(false);
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
  });

  it('returns false on userCancel from unsealVaultKey (cancel code)', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockResolvedValue({ exists: true });
    const cancelErr = Object.assign(new Error('user cancelled'), { code: 'userCancel' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(cancelErr);

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBe('device-uuid-pak');
  });

  it('returns false on biometryLockout from unsealVaultKey', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockResolvedValue({ exists: true });
    const lockErr = Object.assign(new Error('lockout'), { code: 'biometryLockout' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(lockErr);

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBe('device-uuid-pak');
  });

  it('re-throws PAK hardware errors (not cancel codes) without unenrolling', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockResolvedValue({ exists: true });
    const hwErr = Object.assign(new Error('hardware failure'), { code: 'keystoreError' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(hwErr);

    const { unlockWithBiometrics } = useBiometricUnlock();
    await expect(unlockWithBiometrics('user-1')).rejects.toThrow('hardware failure');
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBe('device-uuid-pak');
  });
});

// ---------------------------------------------------------------------------
// unlockWithBiometrics — native call timeout safety net
//
// Regression: observed on a real Android device that after ~10s+ in the
// background, the native plugin call silently never resolves (no success, no
// error, no log at all reaching the Capacitor bridge) — leaving the caller's
// `biometricLoading` stuck true forever, and the "Unlock with biometrics"
// button permanently disabled with no way to recover short of a force-close.
// Root cause is still unconfirmed; this bounds the failure mode regardless.
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.unlockWithBiometrics — native call timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with a timeout error if hasKeys never resolves (PAK path)', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockReturnValue(new Promise(() => {}));

    const { unlockWithBiometrics } = useBiometricUnlock();
    const assertion = expect(unlockWithBiometrics('user-1')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it('rejects with a timeout error if unsealVaultKey never resolves (PAK path)', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreHasKeys.mockResolvedValue({ exists: true });
    mockKeystoreUnsealVaultKey.mockReturnValue(new Promise(() => {}));

    const { unlockWithBiometrics } = useBiometricUnlock();
    const assertion = expect(unlockWithBiometrics('user-1')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it('rejects with a timeout error if unsealVaultKey never resolves (Phase 8 path)', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-phase8');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
    mockKeystoreUnsealVaultKey.mockReturnValue(new Promise(() => {}));

    const { unlockWithBiometrics } = useBiometricUnlock();
    const assertion = expect(unlockWithBiometrics('user-1')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it('does not time out when the native call resolves well within the window', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const { unlockWithBiometrics } = useBiometricUnlock();

    expect(await unlockWithBiometrics('user-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unlockWithBiometrics — Phase 8 path
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.unlockWithBiometrics (Phase 8 path)', () => {
  it('returns false when not enrolled (no Phase 8 localStorage entry)', async () => {
    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
    expect(mockKeystoreHasRawKey).not.toHaveBeenCalled();
    expect(mockKeystoreUnsealVaultKey).not.toHaveBeenCalled();
  });

  it('uses AdytonKeystore.unsealVaultKey and unlocks vault on success', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
    mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: RAW_0XAB_B64 });

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(true);
    expect(mockKeystoreHasRawKey).toHaveBeenCalledWith({ deviceId: 'phase8-uuid' });
    expect(mockKeystoreUnsealVaultKey).toHaveBeenCalledWith({ deviceId: 'phase8-uuid' });
    expect(mockImportVaultKey).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  // VULN-001 regression: OS-enforced biometric via CryptoObject — no separate JS
  // authenticate() call. The BiometricPrompt is inside unsealVaultKey (Kotlin plugin).
  it('does not call a standalone BiometricAuth.authenticate (biometric is OS-enforced in plugin)', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
    mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: RAW_0XAB_B64 });

    const { unlockWithBiometrics } = useBiometricUnlock();
    await unlockWithBiometrics('user-1');

    // No separate authenticate() call — proof that biometric ordering cannot be bypassed
    // by a DevTools call that reads the key before JS reaches the authenticate() line.
    expect(mockCheckBiometry).not.toHaveBeenCalled();
  });

  it('cleans up stale entry and returns false when wrap key is absent', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: false });

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(false);
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
    expect(mockKeystoreUnsealVaultKey).not.toHaveBeenCalled();
  });

  it('returns false and cleans up when vaultKeyRaw decodes to wrong byte length', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
    const shortKey = btoa(String.fromCharCode(...new Uint8Array(31).fill(0xdd)));
    mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: shortKey });

    const { unlockWithBiometrics } = useBiometricUnlock();
    const result = await unlockWithBiometrics('user-1');

    expect(result).toBe(false);
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();
  });

  it('returns false on userCancel from unsealVaultKey without unenrolling', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
    const cancelErr = Object.assign(new Error('user cancelled'), { code: 'userCancel' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(cancelErr);

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBe('phase8-uuid');
  });

  it('returns false on systemCancel without unenrolling', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
    const cancelErr = Object.assign(new Error('system cancel'), { code: 'systemCancel' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(cancelErr);

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBe('phase8-uuid');
  });

  it('returns false on biometryLockout without unenrolling', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
    const lockErr = Object.assign(new Error('lockout'), { code: 'biometryLockout' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(lockErr);

    const { unlockWithBiometrics } = useBiometricUnlock();
    expect(await unlockWithBiometrics('user-1')).toBe(false);
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBe('phase8-uuid');
  });

  it('re-throws unexpected hardware errors without unenrolling', async () => {
    localStorage.setItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1', 'phase8-uuid');
    mockKeystoreHasRawKey.mockResolvedValue({ exists: true });
    mockKeystoreUnsealVaultKey.mockRejectedValue(new Error('unexpected hardware failure'));

    const { unlockWithBiometrics } = useBiometricUnlock();
    await expect(unlockWithBiometrics('user-1')).rejects.toThrow('unexpected hardware failure');
    expect(localStorage.getItem(PHASE8_DEVICE_KEY_PREFIX + 'user-1')).toBe('phase8-uuid');
  });
});

// ---------------------------------------------------------------------------
// verifyRawKeyMatches
// ---------------------------------------------------------------------------
describe('useBiometricUnlock.verifyRawKeyMatches', () => {
  it('returns true when candidate raw bytes produce a key that decrypts correctly', async () => {
    const rawBytes = fakeRawKey(0x77);

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
