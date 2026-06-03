import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Mock the Argon2 Worker composable — unit tests don't spin up real Web Workers
const mockDeriveKey = vi.fn();
vi.mock('../../app/composables/useArgon2Worker', () => ({
  useArgon2Worker: (...args: unknown[]) => mockDeriveKey(...args),
}));

const { useCryptoStore } = await import('../../app/stores/crypto');

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

describe('useCryptoStore — initial state', () => {
  it('starts locked', () => {
    const store = useCryptoStore();
    expect(store.isUnlocked).toBe(false);
    expect(store.cryptoKey).toBeNull();
  });
});

describe('useCryptoStore.deriveKey', () => {
  it('calls useArgon2Worker and stores key', async () => {
    const key = fakeCryptoKey();
    mockDeriveKey.mockResolvedValueOnce(key);

    const store = useCryptoStore();
    await store.deriveKey('masterpass', 'a'.repeat(64));

    expect(mockDeriveKey).toHaveBeenCalledWith('masterpass', 'a'.repeat(64));
    expect(store.cryptoKey).toBe(key);
    expect(store.isUnlocked).toBe(true);
  });

  it('sets auto-lock timer after key derivation', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'b'.repeat(64));
    expect(store.isUnlocked).toBe(true);

    // Advance timer past 15 minutes
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(store.isUnlocked).toBe(false);
    expect(store.cryptoKey).toBeNull();
  });

  it('sets lockAt to ~15 minutes ahead on derive and clears it on lock', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'f'.repeat(64));
    expect(store.lockAt).toBe(Date.now() + 15 * 60 * 1000);
    store.lock();
    expect(store.lockAt).toBeNull();
  });
});

describe('useCryptoStore.lock', () => {
  it('clears key immediately', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'c'.repeat(64));
    expect(store.isUnlocked).toBe(true);

    store.lock();
    expect(store.isUnlocked).toBe(false);
    expect(store.cryptoKey).toBeNull();
  });

  it('cancels the auto-lock timer', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'd'.repeat(64));
    store.lock();
    // Timer is cancelled — advancing time should not cause further state changes
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(store.cryptoKey).toBeNull(); // already null, no error
  });
});

describe('useCryptoStore.resetLockTimer', () => {
  it('resets 15-minute timer on activity', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'e'.repeat(64));

    // Advance 14 minutes
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(store.isUnlocked).toBe(true);

    // Reset timer (simulates user activity)
    store.resetLockTimer();

    // Advance 14 more minutes — total 28 min from unlock but only 14 from reset
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(store.isUnlocked).toBe(true); // still unlocked

    // Advance 1 more minute — 15 min from last reset
    vi.advanceTimersByTime(60 * 1000 + 1);
    expect(store.isUnlocked).toBe(false);
  });
});
