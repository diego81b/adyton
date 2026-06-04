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

describe('useCryptoStore — settings-driven duration', () => {
  it('uses the settings store duration for the timer', async () => {
    const { useSettingsStore } = await import('../../app/stores/settings');
    const settings = useSettingsStore();
    settings.settings.lockDurationMs = 5 * 60 * 1000;

    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'a'.repeat(64));
    expect(store.lockAt).toBe(Date.now() + 5 * 60 * 1000);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(store.isUnlocked).toBe(false);
  });

  it('never auto-locks when duration is 0 (Never)', async () => {
    const { useSettingsStore } = await import('../../app/stores/settings');
    useSettingsStore().settings.lockDurationMs = 0;

    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'b'.repeat(64));
    expect(store.lockAt).toBeNull();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(store.isUnlocked).toBe(true); // explicit lock still works
    store.lock();
    expect(store.isUnlocked).toBe(false);
  });
});

describe('useCryptoStore — lock deferral (unsaved edits)', () => {
  it('defers a timer-fired lock and locks on release', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'c'.repeat(64));

    store.deferLock();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1); // timer fires while deferred
    expect(store.isUnlocked).toBe(true); // key survives — unsaved edits

    store.releaseLockDeferral(); // form saved/closed → overdue lock fires now
    expect(store.isUnlocked).toBe(false);
  });

  it('release without a pending lock does not lock', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'd'.repeat(64));

    store.deferLock();
    store.releaseLockDeferral(); // timer never fired
    expect(store.isUnlocked).toBe(true);
  });

  it('explicit lock ignores deferrals and clears them', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'e'.repeat(64));

    store.deferLock();
    store.lock(); // user clicked the lock pill — always locks
    expect(store.isUnlocked).toBe(false);
    expect(store.deferrals).toBe(0);
  });

  it('nested deferrals only lock after the last release', async () => {
    mockDeriveKey.mockResolvedValueOnce(fakeCryptoKey());
    const store = useCryptoStore();
    await store.deriveKey('pw', 'f'.repeat(64));

    store.deferLock();
    store.deferLock();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    store.releaseLockDeferral();
    expect(store.isUnlocked).toBe(true); // one deferral still active
    store.releaseLockDeferral();
    expect(store.isUnlocked).toBe(false);
  });
});
