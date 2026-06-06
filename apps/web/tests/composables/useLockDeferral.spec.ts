import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, effectScope } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../app/composables/useArgon2Worker', () => ({
  useArgon2Worker: vi.fn(),
}));

const { useLockDeferral } = await import('../../app/composables/useLockDeferral');
const { useCryptoStore } = await import('../../app/stores/crypto');
const { useSettingsStore } = await import('../../app/stores/settings');

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('useLockDeferral', () => {
  it('defers while dirty in absolute mode, releases when clean', async () => {
    useSettingsStore().settings.lockMode = 'absolute';
    const crypto = useCryptoStore();
    const dirty = ref(false);

    const scope = effectScope();
    scope.run(() => useLockDeferral(dirty));

    expect(crypto.deferrals).toBe(0);
    dirty.value = true;
    await nextTick();
    expect(crypto.deferrals).toBe(1);
    dirty.value = false;
    await nextTick();
    expect(crypto.deferrals).toBe(0);
    scope.stop();
  });

  it('does nothing in activity mode (typing already resets the timer)', async () => {
    const crypto = useCryptoStore(); // default lockMode: 'activity'
    const dirty = ref(false);

    const scope = effectScope();
    scope.run(() => useLockDeferral(dirty));

    dirty.value = true;
    await nextTick();
    expect(crypto.deferrals).toBe(0);
    scope.stop();
  });

  it('releases on scope dispose while still dirty', async () => {
    useSettingsStore().settings.lockMode = 'absolute';
    const crypto = useCryptoStore();
    const dirty = ref(true);

    const scope = effectScope();
    scope.run(() => useLockDeferral(dirty));
    await nextTick();
    expect(crypto.deferrals).toBe(1);

    scope.stop(); // unmount
    expect(crypto.deferrals).toBe(0);
  });

  it('reacts to a lock-mode change while dirty', async () => {
    const settings = useSettingsStore();
    settings.settings.lockMode = 'absolute';
    const crypto = useCryptoStore();
    const dirty = ref(true);

    const scope = effectScope();
    scope.run(() => useLockDeferral(dirty));
    await nextTick();
    expect(crypto.deferrals).toBe(1);

    settings.settings.lockMode = 'activity';
    await nextTick();
    expect(crypto.deferrals).toBe(0);
    scope.stop();
  });
});
