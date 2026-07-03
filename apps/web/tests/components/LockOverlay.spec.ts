import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

vi.mock('../../app/composables/useArgon2Worker', () => ({ useArgon2Worker: vi.fn() }));

// --- useNativeRuntime mock ---------------------------------------------------
let mockIsNative = false;
vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: mockIsNative }),
}));

// --- useBiometricUnlock mock -------------------------------------------------
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

// --- usePakQrLogin mock -------------------------------------------------
const mockPakStart = vi.fn<[], Promise<void>>();
const mockPakCancel = vi.fn<[], Promise<void>>();
const mockPakReset = vi.fn<[], void>();
const pakPhase = ref('idle');
const pakQrUrl = ref<string | null>(null);
const pakError = ref<string | null>(null);
const mockUsePakQrLogin = vi.fn((opts?: { navigateOnUnlock?: boolean }) => {
  void opts;
  return { phase: pakPhase, qrUrl: pakQrUrl, error: pakError, start: mockPakStart, cancel: mockPakCancel, reset: mockPakReset };
});
vi.mock('../../app/composables/usePakQrLogin', () => ({
  usePakQrLogin: (opts?: { navigateOnUnlock?: boolean }) => mockUsePakQrLogin(opts),
}));

const { default: LockOverlay } = await import('../../app/components/LockOverlay.vue');
const { useAuthStore } = await import('../../app/stores/auth');
const { useCryptoStore } = await import('../../app/stores/crypto');
const { useVaultStore } = await import('../../app/stores/vault');

const passthrough = (name: string) => ({ name, template: '<div><slot /><slot name="content" /></div>' });

// UButton stub passes through click handler via $attrs so @click bindings work.
const UButtonStub = {
  name: 'UButton',
  template: '<button v-bind="$attrs"><slot /></button>',
};

const stubs = {
  UModal: passthrough('UModal'),
  UForm: {
    name: 'UForm',
    emits: ['submit'],
    template: '<form @submit.prevent="$emit(\'submit\', { preventDefault() {} })"><slot /></form>',
  },
  UFormField: passthrough('UFormField'),
  UAlert: { name: 'UAlert', props: ['description'], template: '<div class="ualert">{{ description }}</div>' },
  UButton: UButtonStub,
  PasswordInput: {
    name: 'PasswordInput',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  BrandLogo: passthrough('BrandLogo'),
  KeyDerivationStatus: passthrough('KeyDerivationStatus'),
  PakQrPanel: {
    name: 'PakQrPanel',
    props: ['qrUrl', 'phase', 'error'],
    emits: ['cancel', 'retry'],
    template: '<div data-testid="pak-panel">{{ phase }}</div>',
  },
};

const FAKE_KEY = { type: 'secret' } as unknown as CryptoKey;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockIsNative = false;
  pakPhase.value = 'idle';
  pakQrUrl.value = null;
  pakError.value = null;
  mockPakStart.mockResolvedValue(undefined);
  mockPakCancel.mockResolvedValue(undefined);
  const auth = useAuthStore();
  auth.user = { id: 'u1', email: 'a@b.com', kdfSalt: 'a'.repeat(64), totpEnabled: false };
});

// ---------------------------------------------------------------------------
// Password form (existing behaviour)
// ---------------------------------------------------------------------------
describe('LockOverlay — password form', () => {
  it('unlocks on the correct password (derive + verify both succeed)', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    const deriveKey = vi.spyOn(crypto, 'deriveKey').mockImplementation(async () => {
      crypto.cryptoKey = FAKE_KEY;
    });
    const fetchEntries = vi.spyOn(vault, 'fetchEntries').mockResolvedValue();

    const w = mount(LockOverlay, { global: { stubs } });
    await w.find('input').setValue('correct-pw');
    await w.find('form').trigger('submit');
    await flushPromises();

    expect(deriveKey).toHaveBeenCalledWith('correct-pw', 'a'.repeat(64));
    expect(fetchEntries).toHaveBeenCalledWith(true);
    expect(crypto.isUnlocked).toBe(true);
    expect(w.find('.ualert').exists()).toBe(false);
  });

  it('re-locks and shows an error when verification fails (wrong password)', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    vi.spyOn(crypto, 'deriveKey').mockImplementation(async () => {
      crypto.cryptoKey = FAKE_KEY;
    });
    vi.spyOn(vault, 'fetchEntries').mockRejectedValue(new Error('OperationError'));
    const lock = vi.spyOn(crypto, 'lock');

    const w = mount(LockOverlay, { global: { stubs } });
    await w.find('input').setValue('wrong-pw');
    await w.find('form').trigger('submit');
    await flushPromises();

    expect(lock).toHaveBeenCalled();
    expect(crypto.isUnlocked).toBe(false);
    expect(w.find('.ualert').text()).toContain('Wrong master password');
  });
});

// ---------------------------------------------------------------------------
// Biometric button visibility
// ---------------------------------------------------------------------------
describe('LockOverlay — biometric button visibility', () => {
  it('hides biometric button on web platform (isNative=false)', async () => {
    mockIsNative = false;
    mockIsEnrolled.mockResolvedValue(true);

    const crypto = useCryptoStore();
    crypto.cryptoKey = FAKE_KEY; // start unlocked so watch fires on lock
    const w = mount(LockOverlay, { global: { stubs } });

    crypto.lock();
    await flushPromises();

    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(false);
    expect(mockIsEnrolled).not.toHaveBeenCalled();
  });

  it('hides biometric button when not enrolled', async () => {
    mockIsNative = true;
    mockIsEnrolled.mockResolvedValue(false);

    const crypto = useCryptoStore();
    crypto.cryptoKey = FAKE_KEY;
    const w = mount(LockOverlay, { global: { stubs } });

    crypto.lock();
    await flushPromises();

    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(false);
  });

  it('shows biometric button when native + enrolled', async () => {
    mockIsNative = true;
    mockIsEnrolled.mockResolvedValue(true);

    const crypto = useCryptoStore();
    crypto.cryptoKey = FAKE_KEY;
    const w = mount(LockOverlay, { global: { stubs } });

    crypto.lock();
    await flushPromises();

    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(true);
  });

  it('hides biometric button when isEnrolled throws (plugin error)', async () => {
    mockIsNative = true;
    mockIsEnrolled.mockRejectedValue(new Error('storage unavailable'));

    const crypto = useCryptoStore();
    crypto.cryptoKey = FAKE_KEY;
    const w = mount(LockOverlay, { global: { stubs } });

    crypto.lock();
    await flushPromises();

    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Biometric unlock attempt
// ---------------------------------------------------------------------------
describe('LockOverlay — biometric attempt', () => {
  async function mountWithBiometricReady() {
    mockIsNative = true;
    mockIsEnrolled.mockResolvedValue(true);

    const crypto = useCryptoStore();
    const vault = useVaultStore();
    crypto.cryptoKey = FAKE_KEY;
    const w = mount(LockOverlay, { global: { stubs } });

    crypto.lock();
    await flushPromises();
    return { w, crypto, vault };
  }

  it('unlocks vault when biometric auth succeeds', async () => {
    const { w, crypto, vault } = await mountWithBiometricReady();
    mockUnlockWithBiometrics.mockImplementation(async () => {
      crypto.cryptoKey = FAKE_KEY;
      return true;
    });
    vi.spyOn(vault, 'fetchEntries').mockResolvedValue();

    await w.find('[aria-label="Unlock with biometrics"]').trigger('click');
    await flushPromises();

    expect(vault.fetchEntries).toHaveBeenCalledWith(true);
    expect(crypto.isUnlocked).toBe(true);
    expect(w.find('.ualert').exists()).toBe(false);
  });

  it('stays on overlay when user cancels biometric (returns false)', async () => {
    const { w, crypto } = await mountWithBiometricReady();
    mockUnlockWithBiometrics.mockResolvedValue(false);

    await w.find('[aria-label="Unlock with biometrics"]').trigger('click');
    await flushPromises();

    expect(crypto.isUnlocked).toBe(false);
    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(true);
    expect(w.find('.ualert').exists()).toBe(false);
  });

  it('unenrolls + shows error when biometric ok but vault decrypt fails (stale key)', async () => {
    const { w, crypto, vault } = await mountWithBiometricReady();
    mockUnlockWithBiometrics.mockImplementation(async () => {
      crypto.cryptoKey = FAKE_KEY;
      return true;
    });
    vi.spyOn(vault, 'fetchEntries').mockRejectedValue(new Error('OperationError'));
    // Simulate real behaviour: unenroll removes the key so subsequent isEnrolled calls return false.
    mockUnenroll.mockImplementation(async () => {
      mockIsEnrolled.mockResolvedValue(false);
    });

    await w.find('[aria-label="Unlock with biometrics"]').trigger('click');
    await flushPromises();
    // Extra flush: lock() triggers watch which re-checks isEnrolled (now false after unenroll).
    await flushPromises();

    expect(mockUnenroll).toHaveBeenCalledWith('u1');
    expect(w.find('[aria-label="Unlock with biometrics"]').exists()).toBe(false);
    expect(w.find('.ualert').text()).toContain('out of date');
  });

  it('keeps enrollment + shows network error when fetch fails with status (API down)', async () => {
    const { w, crypto, vault } = await mountWithBiometricReady();
    mockUnlockWithBiometrics.mockImplementation(async () => {
      crypto.cryptoKey = FAKE_KEY;
      return true;
    });
    vi.spyOn(vault, 'fetchEntries').mockRejectedValue({ status: 503, message: 'Service Unavailable' });

    await w.find('[aria-label="Unlock with biometrics"]').trigger('click');
    await flushPromises();

    expect(mockUnenroll).not.toHaveBeenCalled();
    expect(w.find('.ualert').text()).toContain('server');
  });
});

// ---------------------------------------------------------------------------
// Password form hidden while biometric is available and hasn't failed
// ---------------------------------------------------------------------------
function passwordFormHidden(w: ReturnType<typeof mount>): boolean {
  const style = w.find('form').attributes('style') ?? '';
  return style.includes('display: none') || style.includes('display:none');
}

describe('LockOverlay — biometric-only until failure', () => {
  async function mountWithBiometricReady() {
    mockIsNative = true;
    mockIsEnrolled.mockResolvedValue(true);

    const crypto = useCryptoStore();
    const vault = useVaultStore();
    crypto.cryptoKey = FAKE_KEY;
    const w = mount(LockOverlay, { global: { stubs } });

    crypto.lock();
    await flushPromises();
    return { w, crypto, vault };
  }

  it('hides the password form but keeps a manual fallback link visible before any biometric attempt', async () => {
    const { w } = await mountWithBiometricReady();

    expect(passwordFormHidden(w)).toBe(true);
    expect(w.text()).not.toContain('or use master password');
    expect(w.text()).toContain('Use master password instead');
  });

  it('reveals the password form when the fallback link is clicked', async () => {
    const { w } = await mountWithBiometricReady();

    const fallbackLink = w.findAll('button').find((b) => b.text().includes('Use master password instead'));
    expect(fallbackLink).toBeTruthy();
    await fallbackLink!.trigger('click');
    await flushPromises();

    expect(passwordFormHidden(w)).toBe(false);
  });

  it('reveals the password form after the biometric prompt is cancelled', async () => {
    const { w } = await mountWithBiometricReady();
    mockUnlockWithBiometrics.mockResolvedValue(false);

    await w.find('[aria-label="Unlock with biometrics"]').trigger('click');
    await flushPromises();

    expect(passwordFormHidden(w)).toBe(false);
  });

  it('reveals the password form on a hardware-error biometric failure', async () => {
    const { w } = await mountWithBiometricReady();
    mockUnlockWithBiometrics.mockRejectedValue(new Error('hardware failure'));

    await w.find('[aria-label="Unlock with biometrics"]').trigger('click');
    await flushPromises();

    expect(passwordFormHidden(w)).toBe(false);
  });

  it('re-hides the password form on the next lock cycle (state does not leak)', async () => {
    const { w, crypto } = await mountWithBiometricReady();
    mockUnlockWithBiometrics.mockResolvedValue(false);
    await w.find('[aria-label="Unlock with biometrics"]').trigger('click');
    await flushPromises();
    expect(passwordFormHidden(w)).toBe(false);

    // Unlock, then lock again — a fresh cycle must not carry over the reveal.
    crypto.cryptoKey = FAKE_KEY;
    await flushPromises();
    crypto.lock();
    await flushPromises();

    expect(passwordFormHidden(w)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PAK QR unlock — the bug this suite guards: manual lock shows THIS overlay
// (not /unlock.vue), so PAK must be reachable here too.
// ---------------------------------------------------------------------------
describe('LockOverlay — PAK QR unlock', () => {
  it('opts out of the composable default navigation (overlay unlocks in place)', () => {
    mount(LockOverlay, { global: { stubs } });
    expect(mockUsePakQrLogin).toHaveBeenCalledWith({ navigateOnUnlock: false });
  });

  it('shows "Unlock with Phone" on desktop (isNative=false)', () => {
    mockIsNative = false;
    const w = mount(LockOverlay, { global: { stubs } });
    expect(w.find('[aria-label="Unlock with Phone"]').exists()).toBe(true);
  });

  it('hides PAK unlock on native (phone has no other phone to relay from)', () => {
    mockIsNative = true;
    const w = mount(LockOverlay, { global: { stubs } });
    expect(w.find('[aria-label="Unlock with Phone"]').exists()).toBe(false);
  });

  it('starts a PAK session and shows the QR panel on click', async () => {
    const w = mount(LockOverlay, { global: { stubs } });

    await w.find('[aria-label="Unlock with Phone"]').trigger('click');
    await flushPromises();

    expect(mockPakStart).toHaveBeenCalledOnce();
    expect(w.find('[data-testid="pak-panel"]').exists()).toBe(true);
  });

  it('cancels the PAK session when the overlay closes via a successful password unlock', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    vi.spyOn(crypto, 'deriveKey').mockImplementation(async () => {
      crypto.cryptoKey = FAKE_KEY;
    });
    vi.spyOn(vault, 'fetchEntries').mockResolvedValue();

    const w = mount(LockOverlay, { global: { stubs } });
    await w.find('[aria-label="Unlock with Phone"]').trigger('click');
    await flushPromises();
    mockPakCancel.mockClear();

    await w.find('input').setValue('correct-pw');
    await w.find('form').trigger('submit');
    await flushPromises();

    expect(mockPakCancel).toHaveBeenCalled();
  });

  it('resets the QR panel back to the button on the next lock (no stale session)', async () => {
    const crypto = useCryptoStore();
    crypto.cryptoKey = FAKE_KEY; // start unlocked
    const w = mount(LockOverlay, { global: { stubs } });

    await w.find('[aria-label="Unlock with Phone"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="pak-panel"]').exists()).toBe(true);
    mockPakCancel.mockClear();

    crypto.lock();
    await flushPromises();

    expect(mockPakCancel).toHaveBeenCalled();
    expect(w.find('[data-testid="pak-panel"]').exists()).toBe(false);
    expect(w.find('[aria-label="Unlock with Phone"]').exists()).toBe(true);
  });
});
