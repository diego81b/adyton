// Tests for the biometric path added in Phase 8 to app/pages/unlock.vue.
// The pre-existing password form behaviour (covered by manual smoke + LockOverlay
// spec) is spot-checked here only where the biometric path touches it (error display,
// navigation guard). Pages are excluded from vitest coverage per vitest.config.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

// --- Mock pinned contract composables ----------------------------------------
const mockIsNative = ref(false);
vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: mockIsNative.value }),
}));

const mockIsEnrolled = vi.fn<[string], Promise<boolean>>();
const mockUnlockWithBiometrics = vi.fn<[string], Promise<boolean>>();
const mockUnenroll = vi.fn<[string], Promise<void>>();
vi.mock('../../app/composables/useBiometricUnlock', () => ({
  useBiometricUnlock: () => ({
    isEnrolled: mockIsEnrolled,
    unlockWithBiometrics: mockUnlockWithBiometrics,
    unenroll: mockUnenroll,
  }),
}));

// Argon2 worker is not exercised by the biometric path
vi.mock('../../app/composables/useArgon2Worker', () => ({ useArgon2Worker: vi.fn() }));

// --- Dynamic import of stores (must come after mocks) ------------------------
const { useAuthStore } = await import('../../app/stores/auth');
const { useCryptoStore } = await import('../../app/stores/crypto');
const { useVaultStore } = await import('../../app/stores/vault');

// --- Shared stubs for Nuxt/NuxtUI chrome ------------------------------------
const mockPush = vi.fn();
vi.stubGlobal('useRouter', () => ({ push: mockPush }));
vi.stubGlobal('definePageMeta', vi.fn());
// unlock.vue relies on Nuxt's auto-imported onMounted global; provide it from vue
// so the component setup does not throw "onMounted is not defined".
import { onMounted } from 'vue';
vi.stubGlobal('onMounted', onMounted);

const passthrough = (name: string) => ({ name, template: '<div><slot /><slot name="brand" /><slot name="footer" /></div>' });
const stubs = {
  AuthShell: passthrough('AuthShell'),
  AuthCard: passthrough('AuthCard'),
  BrandLogo: passthrough('BrandLogo'),
  KeyDerivationStatus: passthrough('KeyDerivationStatus'),
  UForm: {
    name: 'UForm',
    emits: ['submit'],
    template: '<form @submit.prevent="$emit(\'submit\', { preventDefault() {} })"><slot /></form>',
  },
  UFormField: passthrough('UFormField'),
  UAlert: {
    name: 'UAlert',
    props: ['description', 'color'],
    template: '<div class="ualert" :data-color="color">{{ description }}</div>',
  },
  UButton: {
    name: 'UButton',
    props: ['ariaLabel', 'loading', 'disabled', 'type'],
    emits: ['click'],
    template:
      '<button :aria-label="ariaLabel" :type="type || \'button\'" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
  },
  PasswordInput: {
    name: 'PasswordInput',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input class="password-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
};

import UnlockPage from '../../app/pages/unlock.vue';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockIsNative.value = false;
  mockPush.mockResolvedValue(undefined);

  const auth = useAuthStore();
  auth.user = { id: 'u1', email: 'test@example.com', kdfSalt: 'b'.repeat(64), totpEnabled: false };
});

function mountPage() {
  return mount(UnlockPage, { global: { stubs } });
}

// =============================================================================
describe('unlock page — biometric: web (not native)', () => {
  it('does not check enrollment or show biometric button on web', async () => {
    mockIsNative.value = false;
    mountPage();
    await flushPromises();
    expect(mockIsEnrolled).not.toHaveBeenCalled();
  });
});

// =============================================================================
describe('unlock page — biometric: native, not enrolled', () => {
  beforeEach(() => {
    mockIsNative.value = true;
    mockIsEnrolled.mockResolvedValue(false);
  });

  it('does not show the biometric button or auto-attempt when not enrolled', async () => {
    const w = mountPage();
    await flushPromises();
    expect(mockUnlockWithBiometrics).not.toHaveBeenCalled();
    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(false);
  });
});

// =============================================================================
describe('unlock page — biometric: native, enrolled', () => {
  beforeEach(() => {
    mockIsNative.value = true;
    mockIsEnrolled.mockResolvedValue(true);
  });

  it('auto-attempts biometric on mount and navigates to /vault on success', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    // unlockWithBiometrics sets the key in the crypto store (contract).
    mockUnlockWithBiometrics.mockImplementation(async () => {
      crypto.cryptoKey = { type: 'secret' } as unknown as CryptoKey;
      return true;
    });
    vi.spyOn(vault, 'fetchAll').mockResolvedValue();

    mountPage();
    await flushPromises();

    expect(mockUnlockWithBiometrics).toHaveBeenCalledWith('u1');
    expect(vault.fetchAll).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/vault');
  });

  it('renders the retry button after a cancelled biometric prompt (returns false)', async () => {
    mockUnlockWithBiometrics.mockResolvedValue(false);

    const w = mountPage();
    await flushPromises();

    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(true);
    expect(mockPush).not.toHaveBeenCalledWith('/vault');
  });

  it('retry button triggers another biometric attempt', async () => {
    // First call returns false (cancelled), second succeeds.
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    mockUnlockWithBiometrics
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        crypto.cryptoKey = { type: 'secret' } as unknown as CryptoKey;
        return true;
      });
    vi.spyOn(vault, 'fetchAll').mockResolvedValue();

    const w = mountPage();
    await flushPromises();

    await w.find('[aria-label="Unlock with biometrics"]').trigger('click');
    await flushPromises();

    expect(mockUnlockWithBiometrics).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledWith('/vault');
  });

  it('stale key: fetchAll fails → unenrolls, hides biometric button, shows password error', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    mockUnlockWithBiometrics.mockImplementation(async () => {
      crypto.cryptoKey = { type: 'secret' } as unknown as CryptoKey;
      return true;
    });
    vi.spyOn(vault, 'fetchAll').mockRejectedValue(new Error('OperationError: decrypt failed'));
    vi.spyOn(crypto, 'lock');
    vi.spyOn(vault, 'clear');
    mockUnenroll.mockResolvedValue(undefined);

    const w = mountPage();
    await flushPromises();

    expect(mockUnenroll).toHaveBeenCalledWith('u1');
    expect(crypto.lock).toHaveBeenCalled();
    expect(vault.clear).toHaveBeenCalled();
    // Biometric button gone after unenroll
    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(false);
    // Error message visible
    expect(w.find('.ualert').text()).toContain('out of date');
    expect(mockPush).not.toHaveBeenCalledWith('/vault');
  });

  it('plugin hardware error: unlockWithBiometrics throws → does not unenroll', async () => {
    // A non-cancel plugin failure means the stored key was never used — it must
    // NOT be treated as stale.
    mockUnlockWithBiometrics.mockRejectedValue(new Error('hardware failure'));

    const w = mountPage();
    await flushPromises();

    expect(mockUnenroll).not.toHaveBeenCalled();
    // Retry button still present, error message is not the stale-key one.
    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(true);
    expect(w.find('.ualert').text()).not.toContain('out of date');
    expect(w.find('.ualert').text()).toContain('Biometric authentication failed');
    expect(mockPush).not.toHaveBeenCalledWith('/vault');
  });

  it('network failure: fetchAll rejects with status → keeps enrollment, shows retry', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    mockUnlockWithBiometrics.mockImplementation(async () => {
      crypto.cryptoKey = { type: 'secret' } as unknown as CryptoKey;
      return true;
    });
    // apiFetch errors carry a `status` field — must NOT be treated as a stale key.
    const netErr = Object.assign(new Error('fetch failed'), { status: 503 });
    vi.spyOn(vault, 'fetchAll').mockRejectedValue(netErr);
    vi.spyOn(crypto, 'lock');

    const w = mountPage();
    await flushPromises();

    expect(mockUnenroll).not.toHaveBeenCalled();
    expect(crypto.lock).toHaveBeenCalled();
    // Biometric button still present — the user can retry once back online.
    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(true);
    expect(w.find('.ualert').text()).toContain('Could not reach the server');
    expect(mockPush).not.toHaveBeenCalledWith('/vault');
  });
});

// =============================================================================
describe('unlock page — password form (regression)', () => {
  it('navigates to /vault after a successful password unlock', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    vi.spyOn(crypto, 'deriveKey').mockImplementation(async () => {
      crypto.cryptoKey = { type: 'secret' } as unknown as CryptoKey;
    });
    vi.spyOn(vault, 'fetchAll').mockResolvedValue();

    const w = mountPage();
    await flushPromises();
    await w.find('.password-input').setValue('correct-password');
    await w.find('form').trigger('submit');
    await flushPromises();

    expect(crypto.deriveKey).toHaveBeenCalledWith('correct-password', 'b'.repeat(64));
    expect(vault.fetchAll).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/vault');
  });

  it('shows error and does not navigate on wrong password (decrypt throws)', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    vi.spyOn(crypto, 'deriveKey').mockImplementation(async () => {
      crypto.cryptoKey = { type: 'secret' } as unknown as CryptoKey;
    });
    vi.spyOn(vault, 'fetchAll').mockRejectedValue(new Error('OperationError'));
    vi.spyOn(crypto, 'lock');

    const w = mountPage();
    await flushPromises();
    await w.find('.password-input').setValue('wrong-pw');
    await w.find('form').trigger('submit');
    await flushPromises();

    expect(crypto.lock).toHaveBeenCalled();
    expect(w.find('.ualert').text()).toContain('Failed to unlock vault');
    expect(mockPush).not.toHaveBeenCalledWith('/vault');
  });
});
