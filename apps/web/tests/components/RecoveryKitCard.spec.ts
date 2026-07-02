import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

// ---------------------------------------------------------------------------
// useAuthStore — /auth/recovery/status polling
// ---------------------------------------------------------------------------
const mockApiFetch = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  }),
}));

// ---------------------------------------------------------------------------
// useRecoveryKitRegenerate
// ---------------------------------------------------------------------------
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockMnemonic = ref<string[] | null>(null);
const mockRegenerate = vi.fn();
const mockReset = vi.fn(() => {
  mockMnemonic.value = null;
  mockError.value = null;
});

vi.mock('../../app/composables/useRecoveryKitRegenerate', () => ({
  useRecoveryKitRegenerate: () => ({
    loading: mockLoading,
    error: mockError,
    mnemonic: mockMnemonic,
    regenerate: mockRegenerate,
    reset: mockReset,
  }),
}));

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------
import RecoveryKitCard from '../../app/components/RecoveryKitCard.vue';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
const UButtonStub = {
  name: 'UButton',
  props: ['color', 'variant', 'icon', 'ariaLabel', 'loading', 'disabled'],
  emits: ['click'],
  template:
    '<button :aria-label="ariaLabel" :data-color="color" @click="$emit(\'click\')"><slot /></button>',
};

const SettingsGroupStub = {
  name: 'SettingsGroup',
  props: ['title'],
  template: '<section :data-title="title"><slot /></section>',
};

const SettingRowStub = {
  name: 'SettingRow',
  props: ['label', 'helper', 'dot'],
  template: '<div :data-label="label" :data-helper="helper"><slot name="action" /></div>',
};

const PasswordPromptModalStub = {
  name: 'PasswordPromptModal',
  props: ['open', 'title', 'confirmLabel', 'loading', 'error'],
  emits: ['update:open', 'confirm'],
  template:
    '<div class="password-prompt" :data-open="open" :data-error="error">' +
    '<button data-testid="confirm-password" @click="$emit(\'confirm\', \'typed-password\')">confirm</button>' +
    '</div>',
};

const RecoveryKitSetupStepStub = {
  name: 'RecoveryKitSetupStep',
  props: ['mnemonic', 'loading'],
  emits: ['confirm'],
  template:
    '<div class="mnemonic-step" :data-words="mnemonic.length">' +
    '<button data-testid="confirm-mnemonic" @click="$emit(\'confirm\')">done</button>' +
    '</div>',
};

const UModalStub = {
  name: 'UModal',
  props: ['open', 'title'],
  template: `
    <div class="umodal" :data-open="open" :data-title="title">
      <template v-if="open"><slot name="content" /></template>
    </div>
  `,
};

function mountCard() {
  return mount(RecoveryKitCard, {
    global: {
      stubs: {
        UButton: UButtonStub,
        SettingsGroup: SettingsGroupStub,
        SettingRow: SettingRowStub,
        PasswordPromptModal: PasswordPromptModalStub,
        RecoveryKitSetupStep: RecoveryKitSetupStepStub,
        UModal: UModalStub,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoading.value = false;
  mockError.value = null;
  mockMnemonic.value = null;
  mockApiFetch.mockResolvedValue({ hasKit: true, confirmedAt: '2026-06-01T00:00:00.000Z' });
});

describe('RecoveryKitCard', () => {
  it('never issues a DELETE call — the destructive one-click revoke is gone (regression)', async () => {
    mountCard();
    await flushPromises();

    for (const call of mockApiFetch.mock.calls) {
      const opts = call[1] as { method?: string } | undefined;
      expect(opts?.method).not.toBe('DELETE');
    }
  });

  it('shows Regenerate when a kit exists', async () => {
    mockApiFetch.mockResolvedValue({ hasKit: true, confirmedAt: '2026-06-01T00:00:00.000Z' });
    const wrapper = mountCard();
    await flushPromises();

    expect(wrapper.find('[aria-label="Regenerate recovery kit"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Generate recovery kit"]').exists()).toBe(false);
  });

  it('shows Generate when no kit exists yet', async () => {
    mockApiFetch.mockResolvedValue({ hasKit: false });
    const wrapper = mountCard();
    await flushPromises();

    expect(wrapper.find('[aria-label="Generate recovery kit"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Regenerate recovery kit"]').exists()).toBe(false);
  });

  it('opens the password prompt on click, and on confirm calls regenerate() with the entered password', async () => {
    const wrapper = mountCard();
    await flushPromises();

    await wrapper.find('[aria-label="Regenerate recovery kit"]').trigger('click');
    expect(wrapper.find('.password-prompt').attributes('data-open')).toBe('true');

    mockRegenerate.mockResolvedValue(true);
    await wrapper.find('[data-testid="confirm-password"]').trigger('click');
    await flushPromises();

    expect(mockRegenerate).toHaveBeenCalledWith('typed-password');
  });

  it('shows the mnemonic step only after regenerate() succeeds, and closes the password prompt', async () => {
    const wrapper = mountCard();
    await flushPromises();
    await wrapper.find('[aria-label="Regenerate recovery kit"]').trigger('click');

    mockRegenerate.mockImplementation(async () => {
      mockMnemonic.value = Array.from({ length: 24 }, (_, i) => `word${i}`);
      return true;
    });
    await wrapper.find('[data-testid="confirm-password"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.password-prompt').attributes('data-open')).toBe('false');
    expect(wrapper.find('.mnemonic-step').exists()).toBe(true);
  });

  it('keeps the password prompt open on failed regenerate (wrong password)', async () => {
    const wrapper = mountCard();
    await flushPromises();
    await wrapper.find('[aria-label="Regenerate recovery kit"]').trigger('click');

    mockRegenerate.mockResolvedValue(false);
    mockError.value = 'Wrong master password.';
    await wrapper.find('[data-testid="confirm-password"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.password-prompt').attributes('data-open')).toBe('true');
    expect(wrapper.find('.password-prompt').attributes('data-error')).toBe('Wrong master password.');
    expect(wrapper.find('.mnemonic-step').exists()).toBe(false);
  });

  it('re-fetches status and closes the mnemonic step once the user confirms they wrote it down', async () => {
    const wrapper = mountCard();
    await flushPromises();
    await wrapper.find('[aria-label="Regenerate recovery kit"]').trigger('click');

    mockRegenerate.mockImplementation(async () => {
      mockMnemonic.value = Array.from({ length: 24 }, (_, i) => `word${i}`);
      return true;
    });
    await wrapper.find('[data-testid="confirm-password"]').trigger('click');
    await flushPromises();

    mockApiFetch.mockClear();
    mockApiFetch.mockResolvedValue({ hasKit: true, confirmedAt: '2026-07-02T00:00:00.000Z' });

    await wrapper.find('[data-testid="confirm-mnemonic"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.mnemonic-step').exists()).toBe(false);
    expect(mockReset).toHaveBeenCalled();
    expect(mockApiFetch).toHaveBeenCalledWith('/auth/recovery/status');
  });
});
