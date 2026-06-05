import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive, ref, computed } from 'vue';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';

// The card loads reactively (watch on canManage): a component left mounted by a
// previous test would re-fire load() when beforeEach resets the shared state.
enableAutoUnmount(afterEach);

// --- Mock the auth store ------------------------------------------------------
const mockApiFetch = vi.fn();
const mockUser = reactive<{ totpEnabled: boolean }>({ totpEnabled: true });
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch: mockApiFetch, user: mockUser }),
}));

// --- Mock the composable (isolate the card) ----------------------------------
const supported = ref(true);
const registerPasskey = vi.fn();
vi.mock('../../app/composables/useWebAuthn', () => ({
  useWebAuthn: () => ({
    supported: computed(() => supported.value),
    registerPasskey,
  }),
}));

import PasskeysCard from '../../app/components/PasskeysCard.vue';

const UButtonStub = {
  name: 'UButton',
  props: ['color', 'icon', 'ariaLabel', 'loading', 'disabled'],
  emits: ['click'],
  template:
    '<button :data-color="color" :aria-label="ariaLabel" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
};
const UInputStub = {
  name: 'UInput',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template:
    '<input class="uinput" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const ConfirmStub = {
  name: 'ConfirmDialog',
  props: ['open', 'title', 'message', 'confirmLabel', 'loading'],
  emits: ['confirm', 'update:open'],
  template: '<div class="confirm" :data-open="open" />',
};

function mountCard() {
  return mount(PasskeysCard, {
    global: {
      stubs: {
        UButton: UButtonStub,
        UInput: UInputStub,
        UIcon: true,
        ConfirmDialog: ConfirmStub,
      },
    },
  });
}

beforeEach(() => {
  mockApiFetch.mockReset();
  registerPasskey.mockReset();
  mockUser.totpEnabled = true;
  supported.value = true;
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});

describe('PasskeysCard — gating', () => {
  it('shows the 2FA hint and a disabled add when TOTP is off; does not load', async () => {
    mockUser.totpEnabled = false;
    const w = mountCard();
    await flushPromises();

    expect(w.text()).toContain('Enable two-factor authentication first');
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(w.findAll('button').some((b) => b.attributes('aria-label') === 'Add passkey')).toBe(false);
  });

  it('shows the unsupported-browser hint when WebAuthn is unavailable', async () => {
    supported.value = false;
    const w = mountCard();
    await flushPromises();

    expect(w.text()).toContain('does not support passkeys');
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

describe('PasskeysCard — listing', () => {
  it('loads and lists credentials on mount when manageable', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { id: 'pk-1', friendlyName: 'YubiKey', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null },
      { id: 'pk-2', friendlyName: 'Touch ID', createdAt: '2026-02-01T00:00:00Z', lastUsedAt: '2026-06-01T00:00:00Z' },
    ]);
    const w = mountCard();
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/webauthn/credentials');
    expect(w.text()).toContain('YubiKey');
    expect(w.text()).toContain('Touch ID');
  });
});

describe('PasskeysCard — add flow', () => {
  it('calls the composable, appends the result, and closes the inline form', async () => {
    mockApiFetch.mockResolvedValueOnce([]); // initial list
    const summary = { id: 'pk-9', friendlyName: 'My Key', createdAt: '2026-06-05T00:00:00Z', lastUsedAt: null };
    registerPasskey.mockResolvedValueOnce(summary);

    const w = mountCard();
    await flushPromises();

    // open inline form
    await w.find('[aria-label="Add passkey"]').trigger('click');
    await w.find('.uinput').setValue('My Key');

    // confirm — the "Create passkey" button
    await w.findAll('button').find((b) => b.text() === 'Create passkey')!.trigger('click');
    await flushPromises();

    expect(registerPasskey).toHaveBeenCalledWith('My Key');
    expect(w.text()).toContain('My Key');
  });

  it('surfaces a composable error without appending', async () => {
    const toastAdd = vi.fn();
    vi.stubGlobal('useToast', () => ({ add: toastAdd }));
    mockApiFetch.mockResolvedValueOnce([]);
    registerPasskey.mockRejectedValueOnce(new Error('Passkey prompt was dismissed or timed out. Please try again.'));

    const w = mountCard();
    await flushPromises();

    await w.find('[aria-label="Add passkey"]').trigger('click');
    await w.find('.uinput').setValue('Nope');
    await w.findAll('button').find((b) => b.text() === 'Create passkey')!.trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'error', title: expect.stringMatching(/dismissed or timed out/i) }),
    );
  });
});

describe('PasskeysCard — remove flow', () => {
  it('opens the confirm dialog, DELETEs on confirm, and drops the row', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { id: 'pk-1', friendlyName: 'YubiKey', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null },
    ]);
    const w = mountCard();
    await flushPromises();

    const confirm = w.findComponent(ConfirmStub);
    expect(confirm.props('open')).toBe(false);

    await w.find('[aria-label="Remove passkey YubiKey"]').trigger('click');
    expect(confirm.props('open')).toBe(true);

    mockApiFetch.mockResolvedValueOnce(undefined); // DELETE
    confirm.vm.$emit('confirm');
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/webauthn/credentials/pk-1', { method: 'DELETE' });
    expect(w.text()).not.toContain('YubiKey');
  });
});
