import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Mock useArgon2Worker so crypto store tests don't spin up real Workers.
const mockUseArgon2Worker = vi.fn();
vi.mock('../../app/composables/useArgon2Worker', () => ({
  useArgon2Worker: (...args: unknown[]) => mockUseArgon2Worker(...args),
  deriveRawKey: vi.fn(),
  importVaultKey: vi.fn(),
}));

const { useCryptoStore } = await import('../../app/stores/crypto');

function fakeRawKey(): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  new Uint8Array(buf).fill(0xcd);
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

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCryptoStore.unlockWithRawKey', () => {
  it('is exported from the store', () => {
    const store = useCryptoStore();
    expect(typeof store.unlockWithRawKey).toBe('function');
  });

  it('sets isUnlocked to true after calling with valid raw bytes', async () => {
    // importVaultKey is called internally — we need to intercept the dynamic import.
    // Patch the module mock to return a fake key when importVaultKey is called.
    const { importVaultKey } = await import('../../app/composables/useArgon2Worker');
    const key = fakeCryptoKey();
    vi.mocked(importVaultKey).mockResolvedValueOnce(key);

    const store = useCryptoStore();
    await store.unlockWithRawKey(fakeRawKey());

    expect(store.isUnlocked).toBe(true);
    expect(store.cryptoKey).toBe(key);
  });

  it('sets lockAt (i.e. resetLockTimer ran) after setting the key', async () => {
    // We cannot spy on resetLockTimer through the Pinia wrapper (it's a closure
    // reference, not a method called via `this`). Assert the observable side-effect
    // instead: lockAt is set to ~15 min from now when the timer fires.
    const { importVaultKey } = await import('../../app/composables/useArgon2Worker');
    vi.mocked(importVaultKey).mockResolvedValueOnce(fakeCryptoKey());

    const store = useCryptoStore();
    await store.unlockWithRawKey(fakeRawKey());

    // Default settings lockDurationMs = 15 min; lockAt should be non-null.
    expect(store.lockAt).not.toBeNull();
    expect(store.lockAt).toBeGreaterThan(Date.now());
  });

  it('auto-lock timer fires after unlock via raw key', async () => {
    const { importVaultKey } = await import('../../app/composables/useArgon2Worker');
    vi.mocked(importVaultKey).mockResolvedValueOnce(fakeCryptoKey());

    const store = useCryptoStore();
    await store.unlockWithRawKey(fakeRawKey());
    expect(store.isUnlocked).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(store.isUnlocked).toBe(false);
  });

  it('explicit lock after unlockWithRawKey clears the key immediately', async () => {
    const { importVaultKey } = await import('../../app/composables/useArgon2Worker');
    vi.mocked(importVaultKey).mockResolvedValueOnce(fakeCryptoKey());

    const store = useCryptoStore();
    await store.unlockWithRawKey(fakeRawKey());
    store.lock();

    expect(store.isUnlocked).toBe(false);
    expect(store.cryptoKey).toBeNull();
  });
});
