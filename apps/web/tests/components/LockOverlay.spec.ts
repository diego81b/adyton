import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../app/composables/useArgon2Worker', () => ({ useArgon2Worker: vi.fn() }));

const { default: LockOverlay } = await import('../../app/components/LockOverlay.vue');
const { useAuthStore } = await import('../../app/stores/auth');
const { useCryptoStore } = await import('../../app/stores/crypto');
const { useVaultStore } = await import('../../app/stores/vault');

// Render slot content directly so we can drive the form; ignore modal chrome.
const passthrough = (name: string) => ({ name, template: '<div><slot /><slot name="content" /></div>' });
const stubs = {
  UModal: passthrough('UModal'),
  UForm: {
    name: 'UForm',
    emits: ['submit'],
    // Emit a payload carrying preventDefault so the parent's @submit.prevent works.
    template: '<form @submit.prevent="$emit(\'submit\', { preventDefault() {} })"><slot /></form>',
  },
  UFormField: passthrough('UFormField'),
  UAlert: { name: 'UAlert', props: ['description'], template: '<div class="ualert">{{ description }}</div>' },
  UButton: { name: 'UButton', template: '<button type="submit"><slot /></button>' },
  PasswordInput: {
    name: 'PasswordInput',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  BrandLogo: passthrough('BrandLogo'),
  KeyDerivationStatus: passthrough('KeyDerivationStatus'),
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  const auth = useAuthStore();
  auth.user = { id: 'u1', email: 'a@b.com', kdfSalt: 'a'.repeat(64), totpEnabled: false };
});

describe('LockOverlay', () => {
  it('unlocks on the correct password (derive + verify both succeed)', async () => {
    const crypto = useCryptoStore();
    const vault = useVaultStore();
    const deriveKey = vi.spyOn(crypto, 'deriveKey').mockImplementation(async () => {
      crypto.cryptoKey = { type: 'secret' } as unknown as CryptoKey;
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
      crypto.cryptoKey = { type: 'secret' } as unknown as CryptoKey;
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
