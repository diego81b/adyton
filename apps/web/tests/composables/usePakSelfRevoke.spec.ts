import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ---------------------------------------------------------------------------
// All plugin imports inside usePakSelfRevoke are dynamic (await import(...)).
// We mock each module at the vi.mock level so those dynamic imports resolve to
// our fakes.
// ---------------------------------------------------------------------------

// --- @adyton/capacitor-keystore ---
const mockKeystoreUnsealVaultKey = vi.fn();
const mockKeystoreDeleteKeys = vi.fn();
vi.mock('@adyton/capacitor-keystore', () => ({
  AdytonKeystore: {
    unsealVaultKey: (...args: unknown[]) => mockKeystoreUnsealVaultKey(...args),
    deleteKeys: (...args: unknown[]) => mockKeystoreDeleteKeys(...args),
  },
}));

// --- @aparajita/capacitor-secure-storage ---
const mockStorageSet = vi.fn();
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    set: (...args: unknown[]) => mockStorageSet(...args),
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

// --- useArgon2Worker (required by useCryptoStore, transitively) ---
vi.mock('../../app/composables/useArgon2Worker', () => ({
  useArgon2Worker: vi.fn(),
  deriveRawKey: vi.fn(),
  importVaultKey: vi.fn(),
}));

// ---------------------------------------------------------------------------
// localStorage shim — same pattern as useBiometricUnlock.spec.ts.
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
import { usePakSelfRevoke } from '../../app/composables/usePakSelfRevoke';
import { useAuthStore } from '../../app/stores/auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAK_DEVICE_KEY_PREFIX = 'adyton_pak_device_';
const KEY_PREFIX = 'adyton.vaultKey.';

// 32 bytes of 0xab encoded as base64 (matches what unsealVaultKey returns)
const RAW_0XAB_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(0xab)));

// Expected hex encoding of 32 bytes of 0xab (what SecureStorage.set should receive)
const HEX_0XAB = 'ab'.repeat(32);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  setActivePinia(createPinia());
  isNativePlatform = true;
  mockKeystoreUnsealVaultKey.mockReset();
  mockKeystoreDeleteKeys.mockReset();
  mockStorageSet.mockReset();
  localStorageStore.clear();

  // Defaults: operations succeed
  mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: RAW_0XAB_B64 });
  mockKeystoreDeleteKeys.mockResolvedValue(undefined);
  mockStorageSet.mockResolvedValue(undefined);
});

afterEach(() => {
  localStorageStore.clear();
});

// ---------------------------------------------------------------------------
// isPakDevice
// ---------------------------------------------------------------------------
describe('usePakSelfRevoke.isPakDevice', () => {
  it('returns false when no localStorage entry exists for the user', async () => {
    // localStorage is empty
    const { isPakDevice } = usePakSelfRevoke();
    expect(await isPakDevice('user-1')).toBe(false);
  });

  it('returns true when a PAK device ID entry exists in localStorage', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const { isPakDevice } = usePakSelfRevoke();
    expect(await isPakDevice('user-1')).toBe(true);
  });

  it('returns false on web platform even when localStorage has an entry', async () => {
    isNativePlatform = false;
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const { isPakDevice } = usePakSelfRevoke();
    expect(await isPakDevice('user-1')).toBe(false);
  });

  it('isolates by userId — does not return true for a different user', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'other-user', 'device-uuid-pak');
    const { isPakDevice } = usePakSelfRevoke();
    expect(await isPakDevice('user-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// revokeThisDevice
// ---------------------------------------------------------------------------
describe('usePakSelfRevoke.revokeThisDevice', () => {
  it('throws when called on web platform', async () => {
    isNativePlatform = false;
    const { revokeThisDevice } = usePakSelfRevoke();
    await expect(revokeThisDevice('user-1')).rejects.toThrow(/web platform/i);
  });

  it('throws when this device is not enrolled (no localStorage marker)', async () => {
    // No localStorage entry
    const { revokeThisDevice } = usePakSelfRevoke();
    await expect(revokeThisDevice('user-1')).rejects.toThrow(
      'This device is not enrolled as a PAK key',
    );
    // No plugin calls made
    expect(mockKeystoreUnsealVaultKey).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
    expect(mockKeystoreDeleteKeys).not.toHaveBeenCalled();
  });

  it('completes the full revocation flow in correct order', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const auth = useAuthStore();
    const apiFetchSpy = vi.spyOn(auth, 'apiFetch').mockResolvedValue(undefined);

    const { revokeThisDevice } = usePakSelfRevoke();
    const result = await revokeThisDevice('user-1');

    // Returns true on success
    expect(result).toBe(true);

    // Step 3: unsealVaultKey called with correct deviceId
    expect(mockKeystoreUnsealVaultKey).toHaveBeenCalledWith({ deviceId: 'device-uuid-pak' });

    // Step 4: SecureStorage.set called with base64-decoded hex (not raw base64)
    expect(mockStorageSet).toHaveBeenCalledWith(KEY_PREFIX + 'user-1', HEX_0XAB);

    // Step 5: SE keys deleted
    expect(mockKeystoreDeleteKeys).toHaveBeenCalledWith({ deviceId: 'device-uuid-pak' });

    // Step 6: localStorage marker removed
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBeNull();

    // Step 7: DELETE API called with correct URL and method
    expect(apiFetchSpy).toHaveBeenCalledWith(
      '/pak/devices/device-uuid-pak?reason=safe',
      { method: 'DELETE' },
    );
  });

  it('stores Phase-8 fallback BEFORE deleting SE keys (order is safety-critical)', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const auth = useAuthStore();
    vi.spyOn(auth, 'apiFetch').mockResolvedValue(undefined);

    const callOrder: string[] = [];
    mockStorageSet.mockImplementation(async () => { callOrder.push('SecureStorage.set'); });
    mockKeystoreDeleteKeys.mockImplementation(async () => { callOrder.push('deleteKeys'); });

    const { revokeThisDevice } = usePakSelfRevoke();
    await revokeThisDevice('user-1');

    expect(callOrder).toEqual(['SecureStorage.set', 'deleteKeys']);
  });

  it('returns false on user cancel (code = userCancel) without setting error', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const cancelErr = Object.assign(new Error('user cancelled'), { code: 'userCancel' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(cancelErr);

    const { revokeThisDevice, error } = usePakSelfRevoke();
    const result = await revokeThisDevice('user-1');

    expect(result).toBe(false);
    // User cancel is not an error condition
    expect(error.value).toBeNull();
    // No Phase-8 write or SE deletion attempted
    expect(mockStorageSet).not.toHaveBeenCalled();
    expect(mockKeystoreDeleteKeys).not.toHaveBeenCalled();
    // localStorage marker preserved — keys are still intact
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBe('device-uuid-pak');
  });

  it('returns false on systemCancel without touching enrollment', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const cancelErr = Object.assign(new Error('system cancel'), { code: 'systemCancel' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(cancelErr);

    const { revokeThisDevice, error } = usePakSelfRevoke();
    const result = await revokeThisDevice('user-1');

    expect(result).toBe(false);
    expect(error.value).toBeNull();
    expect(localStorage.getItem(PAK_DEVICE_KEY_PREFIX + 'user-1')).toBe('device-uuid-pak');
  });

  it('throws on plugin hardware error (code not in CANCEL_CODES) and sets error', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const hwErr = Object.assign(new Error('ECDH failed'), { code: 'keystoreError' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(hwErr);

    const { revokeThisDevice, error } = usePakSelfRevoke();
    await expect(revokeThisDevice('user-1')).rejects.toThrow('ECDH failed');

    // Error is recorded on the ref
    expect(error.value).toBe('ECDH failed');
    // Nothing written to SecureStorage, no SE deletion
    expect(mockStorageSet).not.toHaveBeenCalled();
    expect(mockKeystoreDeleteKeys).not.toHaveBeenCalled();
  });

  it('resets loading to false after success', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const auth = useAuthStore();
    vi.spyOn(auth, 'apiFetch').mockResolvedValue(undefined);

    const { revokeThisDevice, loading } = usePakSelfRevoke();
    await revokeThisDevice('user-1');

    expect(loading.value).toBe(false);
  });

  it('resets loading to false after hardware error', async () => {
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    const hwErr = Object.assign(new Error('hardware failure'), { code: 'keystoreError' });
    mockKeystoreUnsealVaultKey.mockRejectedValue(hwErr);

    const { revokeThisDevice, loading } = usePakSelfRevoke();
    await expect(revokeThisDevice('user-1')).rejects.toThrow();
    expect(loading.value).toBe(false);
  });

  it('throws and sets error when unsealed key is not 32 bytes (corrupt SE data)', async () => {
    // 16 bytes (truncated key) — should be rejected before touching SecureStorage
    const shortKeyB64 = btoa(String.fromCharCode(...new Uint8Array(16).fill(0xcc)));
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: shortKeyB64 });

    const { revokeThisDevice, error } = usePakSelfRevoke();
    await expect(revokeThisDevice('user-1')).rejects.toThrow(/16 bytes.*expected 32/i);

    // Corrupt key must NOT be written to Phase 8 fallback
    expect(mockStorageSet).not.toHaveBeenCalled();
    // SE keys must NOT be deleted when we never confirmed a valid key
    expect(mockKeystoreDeleteKeys).not.toHaveBeenCalled();
    // Error surfaced to UI
    expect(error.value).toMatch(/16 bytes.*expected 32/i);
  });

  it('stores the correct hex value from base64-decoded vault key bytes', async () => {
    // 32 bytes of 0x01 — a different fill value to confirm the decode path
    const RAW_0X01_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(0x01)));
    localStorage.setItem(PAK_DEVICE_KEY_PREFIX + 'user-1', 'device-uuid-pak');
    mockKeystoreUnsealVaultKey.mockResolvedValue({ vaultKeyRaw: RAW_0X01_B64 });
    const auth = useAuthStore();
    vi.spyOn(auth, 'apiFetch').mockResolvedValue(undefined);

    const { revokeThisDevice } = usePakSelfRevoke();
    await revokeThisDevice('user-1');

    // Should store '01'.repeat(32), not the raw base64 string
    expect(mockStorageSet).toHaveBeenCalledWith(KEY_PREFIX + 'user-1', '01'.repeat(32));
  });
});
