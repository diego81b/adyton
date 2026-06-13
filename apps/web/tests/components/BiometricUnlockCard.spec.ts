import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

// --- Mock pinned contract composables ----------------------------------------
// These files are owned by the parallel agent and may not exist yet.
// All tests code against the published contract interface only.

const mockIsNative = ref(false);
vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: mockIsNative.value }),
}));

const mockIsSupported = vi.fn<[], Promise<boolean>>();
const mockIsEnrolled = vi.fn<[string], Promise<boolean>>();
const mockEnroll = vi.fn<[string, ArrayBuffer], Promise<void>>();
const mockUnenroll = vi.fn<[string], Promise<void>>();
const mockVerifyRawKeyMatches = vi.fn<[ArrayBuffer, CryptoKey], Promise<boolean>>();
vi.mock('../../app/composables/useBiometricUnlock', () => ({
  useBiometricUnlock: () => ({
    isSupported: mockIsSupported,
    isEnrolled: mockIsEnrolled,
    enroll: mockEnroll,
    unenroll: mockUnenroll,
    verifyRawKeyMatches: mockVerifyRawKeyMatches,
  }),
}));

// vi.mock is hoisted before const declarations by vitest, so we cannot reference
// a const fn directly in the factory. Use a module-level let that the factory
// closes over, then reassign in beforeEach for clean-slate isolation.
let mockDeriveRawKeyImpl: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('../../app/composables/useArgon2Worker', () => ({
  deriveRawKey: (...args: unknown[]) => mockDeriveRawKeyImpl(...args),
}));

// --- Mock stores --------------------------------------------------------------
const mockCryptoKey = { type: 'secret' } as unknown as CryptoKey;
const mockStoreKey = ref<CryptoKey | null>(mockCryptoKey);
vi.mock('../../app/stores/crypto', () => ({
  useCryptoStore: () => ({
    get cryptoKey() {
      return mockStoreKey.value;
    },
  }),
}));

const mockUser = ref<{ id: string; kdfSalt: string } | null>({
  id: 'user-1',
  kdfSalt: 'a'.repeat(64),
});
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ user: mockUser.value }),
}));

import BiometricUnlockCard from '../../app/components/BiometricUnlockCard.vue';

// --- Stubs -------------------------------------------------------------------
const UButtonStub = {
  name: 'UButton',
  props: ['color', 'icon', 'ariaLabel', 'loading', 'disabled'],
  emits: ['click'],
  template:
    '<button :aria-label="ariaLabel" :data-loading="loading" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
};
const PromptStub = {
  name: 'PasswordPromptModal',
  props: ['open', 'title', 'confirmLabel', 'loading', 'error'],
  emits: ['confirm', 'update:open'],
  template:
    '<div class="prompt" :data-open="open" :data-loading="loading" :data-error="error"><slot /></div>',
};

function mountCard() {
  return mount(BiometricUnlockCard, {
    global: {
      stubs: {
        UButton: UButtonStub,
        UIcon: true,
        PasswordPromptModal: PromptStub,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeriveRawKeyImpl = vi.fn();
  mockIsNative.value = false;
  mockStoreKey.value = mockCryptoKey;
  mockUser.value = { id: 'user-1', kdfSalt: 'a'.repeat(64) };
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});

// =============================================================================
describe('BiometricUnlockCard — web (not native)', () => {
  it('renders nothing when not on a native platform', async () => {
    mockIsNative.value = false;
    const w = mountCard();
    await flushPromises();
    // No probing, no buttons — the whole card is gated
    expect(mockIsSupported).not.toHaveBeenCalled();
    expect(w.find('button').exists()).toBe(false);
    expect(w.text()).toBe('');
  });
});

// =============================================================================
describe('BiometricUnlockCard — native, no device biometrics', () => {
  beforeEach(() => {
    mockIsNative.value = true;
    mockIsSupported.mockResolvedValue(false);
    mockIsEnrolled.mockResolvedValue(false);
  });

  it('shows the "no biometrics on device" hint and no enable button', async () => {
    const w = mountCard();
    await flushPromises();
    expect(w.text()).toContain('Set up Face ID, Touch ID, or a fingerprint on this device first');
    expect(w.find('[aria-label="Enable biometric unlock"]').exists()).toBe(false);
  });
});

// =============================================================================
describe('BiometricUnlockCard — native, supported, not enrolled', () => {
  beforeEach(() => {
    mockIsNative.value = true;
    mockIsSupported.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);
  });

  it('renders the not-enrolled state with an "Enable biometric unlock" button', async () => {
    const w = mountCard();
    await flushPromises();
    expect(w.find('[aria-label="Enable biometric unlock"]').exists()).toBe(true);
    expect(w.find('[aria-label="Disable biometric unlock"]').exists()).toBe(false);
  });

  it('opens the password prompt on enable click', async () => {
    const w = mountCard();
    await flushPromises();
    const prompt = w.findComponent(PromptStub);
    expect(prompt.props('open')).toBe(false);
    await w.find('[aria-label="Enable biometric unlock"]').trigger('click');
    expect(prompt.props('open')).toBe(true);
  });
});

// =============================================================================
describe('BiometricUnlockCard — native, supported, enrolled', () => {
  beforeEach(() => {
    mockIsNative.value = true;
    mockIsSupported.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
  });

  it('renders the enrolled state with a "Disable biometric unlock" button', async () => {
    const w = mountCard();
    await flushPromises();
    expect(w.find('[aria-label="Disable biometric unlock"]').exists()).toBe(true);
    expect(w.find('[aria-label="Enable biometric unlock"]').exists()).toBe(false);
  });

  it('disable: calls unenroll, removes enrolled state, shows success toast', async () => {
    const toastAdd = vi.fn();
    vi.stubGlobal('useToast', () => ({ add: toastAdd }));
    mockUnenroll.mockResolvedValue(undefined);

    const w = mountCard();
    await flushPromises();
    await w.find('[aria-label="Disable biometric unlock"]').trigger('click');
    await flushPromises();

    expect(mockUnenroll).toHaveBeenCalledWith('user-1');
    expect(w.find('[aria-label="Enable biometric unlock"]').exists()).toBe(true);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Biometric unlock disabled', color: 'success' }),
    );
  });

  it('disable: shows error toast when unenroll throws', async () => {
    const toastAdd = vi.fn();
    vi.stubGlobal('useToast', () => ({ add: toastAdd }));
    mockUnenroll.mockRejectedValue(new Error('storage error'));

    const w = mountCard();
    await flushPromises();
    await w.find('[aria-label="Disable biometric unlock"]').trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'error' }),
    );
    // Enrolled state unchanged on failure
    expect(w.find('[aria-label="Disable biometric unlock"]').exists()).toBe(true);
  });
});

// =============================================================================
describe('BiometricUnlockCard — enable flow (password prompt)', () => {
  beforeEach(() => {
    mockIsNative.value = true;
    mockIsSupported.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);
  });

  it('happy path: derive → verify → enroll → success toast → Enabled badge', async () => {
    const toastAdd = vi.fn();
    vi.stubGlobal('useToast', () => ({ add: toastAdd }));
    const rawBuf = new ArrayBuffer(32);
    mockDeriveRawKeyImpl.mockResolvedValue(rawBuf);
    mockVerifyRawKeyMatches.mockResolvedValue(true);
    mockEnroll.mockResolvedValue(undefined);

    const w = mountCard();
    await flushPromises();

    await w.find('[aria-label="Enable biometric unlock"]').trigger('click');
    w.findComponent(PromptStub).vm.$emit('confirm', 'my-password');
    await flushPromises();

    expect(mockDeriveRawKeyImpl).toHaveBeenCalledWith('my-password', 'a'.repeat(64));
    expect(mockVerifyRawKeyMatches).toHaveBeenCalledWith(rawBuf, mockCryptoKey);
    expect(mockEnroll).toHaveBeenCalledWith('user-1', rawBuf);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Biometric unlock enabled', color: 'success' }),
    );
    expect(w.find('[aria-label="Disable biometric unlock"]').exists()).toBe(true);
  });

  it('wrong password: verifyRawKeyMatches returns false → shows inline error, no enroll', async () => {
    const rawBuf = new ArrayBuffer(32);
    mockDeriveRawKeyImpl.mockResolvedValue(rawBuf);
    mockVerifyRawKeyMatches.mockResolvedValue(false);

    const w = mountCard();
    await flushPromises();

    await w.find('[aria-label="Enable biometric unlock"]').trigger('click');
    w.findComponent(PromptStub).vm.$emit('confirm', 'wrong-password');
    await flushPromises();

    expect(mockEnroll).not.toHaveBeenCalled();
    expect(w.findComponent(PromptStub).props('error')).toBe('Wrong master password.');
    // Still not enrolled
    expect(w.find('[aria-label="Enable biometric unlock"]').exists()).toBe(true);
  });

  it('locked vault: cryptoKey null → inline error, no derive, no enroll', async () => {
    mockStoreKey.value = null;

    const w = mountCard();
    await flushPromises();

    await w.find('[aria-label="Enable biometric unlock"]').trigger('click');
    w.findComponent(PromptStub).vm.$emit('confirm', 'pw');
    await flushPromises();

    expect(mockDeriveRawKeyImpl).not.toHaveBeenCalled();
    expect(mockEnroll).not.toHaveBeenCalled();
    expect(w.findComponent(PromptStub).props('error')).toContain('Vault is locked');
  });

  it('derive throws: shows generic error, does not enroll', async () => {
    mockDeriveRawKeyImpl.mockRejectedValue(new Error('worker died'));

    const w = mountCard();
    await flushPromises();

    await w.find('[aria-label="Enable biometric unlock"]').trigger('click');
    w.findComponent(PromptStub).vm.$emit('confirm', 'pw');
    await flushPromises();

    expect(mockEnroll).not.toHaveBeenCalled();
    expect(w.findComponent(PromptStub).props('error')).toContain('Something went wrong');
  });
});
