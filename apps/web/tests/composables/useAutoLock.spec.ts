import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../app/composables/useArgon2Worker', () => ({
  useArgon2Worker: vi.fn(),
}));

const { useAutoLock } = await import('../../app/composables/useAutoLock');
const { useCryptoStore } = await import('../../app/stores/crypto');

function fakeKey(): CryptoKey {
  return { type: 'secret' } as unknown as CryptoKey;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-03T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutoLock', () => {
  it('formats the countdown from the crypto store lockAt', () => {
    const crypto = useCryptoStore();
    crypto.cryptoKey = fakeKey();
    crypto.lockAt = Date.now() + 90_000; // 1m30s

    const scope = effectScope();
    let countdown!: { value: string };
    scope.run(() => {
      ({ countdown } = useAutoLock());
    });
    expect(countdown.value).toBe('01:30');
    scope.stop();
  });

  it('shows 00:00 when locked (no lockAt)', () => {
    const scope = effectScope();
    let countdown!: { value: string };
    scope.run(() => {
      ({ countdown } = useAutoLock());
    });
    expect(countdown.value).toBe('00:00');
    scope.stop();
  });

  it('resets the lock timer on a window activity event when unlocked', () => {
    const crypto = useCryptoStore();
    crypto.cryptoKey = fakeKey();
    crypto.lockAt = Date.now() + 10_000;
    const spy = vi.spyOn(crypto, 'resetLockTimer');

    const scope = effectScope();
    scope.run(() => {
      useAutoLock();
    });

    window.dispatchEvent(new Event('keydown'));
    expect(spy).toHaveBeenCalled();
    scope.stop();
  });

  it('ticks the countdown down over time', async () => {
    const crypto = useCryptoStore();
    crypto.cryptoKey = fakeKey();
    crypto.lockAt = Date.now() + 60_000;

    const scope = effectScope();
    let countdown!: { value: string };
    scope.run(() => {
      ({ countdown } = useAutoLock());
    });
    expect(countdown.value).toBe('01:00');
    await vi.advanceTimersByTimeAsync(5000);
    expect(countdown.value).toBe('00:55');
    scope.stop();
  });
});

describe('useAutoLock — lock modes and "never"', () => {
  it('does NOT reset the timer on activity in absolute mode', async () => {
    const { useSettingsStore } = await import('../../app/stores/settings');
    useSettingsStore().settings.lockMode = 'absolute';

    const crypto = useCryptoStore();
    crypto.cryptoKey = fakeKey();
    crypto.lockAt = Date.now() + 10_000;
    const spy = vi.spyOn(crypto, 'resetLockTimer');

    const scope = effectScope();
    scope.run(() => useAutoLock());
    window.dispatchEvent(new Event('keydown'));
    expect(spy).not.toHaveBeenCalled();
    scope.stop();
  });

  it('shows "off" while unlocked with auto-lock disabled (lockAt null)', () => {
    const crypto = useCryptoStore();
    crypto.cryptoKey = fakeKey();
    crypto.lockAt = null; // duration 0 → no timer

    const scope = effectScope();
    let countdown!: { value: string };
    scope.run(() => {
      ({ countdown } = useAutoLock());
    });
    expect(countdown.value).toBe('off');
    scope.stop();
  });
});
