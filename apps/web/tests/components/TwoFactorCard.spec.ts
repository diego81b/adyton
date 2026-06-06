import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const mockApiFetch = vi.fn();
const mockUser = reactive({ totpEnabled: false });
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch: mockApiFetch, user: mockUser }),
}));

import TwoFactorCard from '../../app/components/TwoFactorCard.vue';

const UButtonStub = {
  name: 'UButton',
  props: ['color', 'icon', 'ariaLabel'],
  emits: ['click'],
  template:
    '<button :data-color="color" :aria-label="ariaLabel" @click="$emit(\'click\')"><slot /></button>',
};
const SetupStub = {
  name: 'TwoFactorSetupModal',
  props: ['open'],
  emits: ['enabled', 'update:open'],
  template: '<div class="setup" :data-open="open" />',
};
const PromptStub = {
  name: 'PasswordPromptModal',
  props: ['open', 'title', 'confirmLabel', 'danger', 'loading', 'error'],
  emits: ['confirm', 'update:open'],
  template: '<div class="prompt" :data-title="title" :data-open="open" :data-danger="danger" />',
};
const CodesStub = {
  name: 'RecoveryCodesModal',
  props: ['open', 'codes'],
  emits: ['update:open'],
  template: '<div class="codesmodal" :data-open="open" />',
};

function mountCard() {
  return mount(TwoFactorCard, {
    global: {
      stubs: {
        UButton: UButtonStub,
        UIcon: true,
        TwoFactorSetupModal: SetupStub,
        PasswordPromptModal: PromptStub,
        RecoveryCodesModal: CodesStub,
      },
    },
  });
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockUser.totpEnabled = false;
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});

describe('TwoFactorCard', () => {
  it('renders the disabled state and opens the setup wizard', async () => {
    const w = mountCard();
    expect(w.text()).toContain('Not configured');

    const setup = w.findComponent(SetupStub);
    expect(setup.props('open')).toBe(false);

    await w.findAll('button').find((b) => b.text() === 'Enable 2FA')!.trigger('click');
    expect(setup.props('open')).toBe(true);
  });

  it('renders the enabled state with disable + regenerate actions', () => {
    mockUser.totpEnabled = true;
    const w = mountCard();
    expect(w.text()).toContain('Enabled');
    expect(w.text()).toContain('Required at every login');
    expect(w.find('[aria-label="Disable two-factor authentication"]').exists()).toBe(true);
    expect(w.find('[aria-label="Regenerate recovery codes"]').exists()).toBe(true);
  });

  it('flips totpEnabled to true when the wizard emits enabled', async () => {
    const w = mountCard();
    w.findComponent(SetupStub).vm.$emit('enabled');
    await flushPromises();
    expect(mockUser.totpEnabled).toBe(true);
    expect(w.text()).toContain('Enabled');
  });

  it('disables 2FA: posts password and flips state to false', async () => {
    mockUser.totpEnabled = true;
    mockApiFetch.mockResolvedValueOnce(undefined);
    const w = mountCard();

    await w.find('[aria-label="Disable two-factor authentication"]').trigger('click');
    const prompt = w
      .findAllComponents(PromptStub)
      .find((p) => p.props('title') === 'Disable two-factor authentication')!;
    expect(prompt.props('open')).toBe(true);

    prompt.vm.$emit('confirm', 'masterpw');
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/2fa/disable', {
      method: 'POST',
      body: { password: 'masterpw' },
    });
    expect(mockUser.totpEnabled).toBe(false);
    expect(w.text()).toContain('Not configured');
  });

  it('maps a 401 on disable to an Invalid credentials error', async () => {
    mockUser.totpEnabled = true;
    mockApiFetch.mockRejectedValueOnce({ statusCode: 401 });
    const w = mountCard();

    await w.find('[aria-label="Disable two-factor authentication"]').trigger('click');
    const prompt = w
      .findAllComponents(PromptStub)
      .find((p) => p.props('title') === 'Disable two-factor authentication')!;
    prompt.vm.$emit('confirm', 'wrong');
    await flushPromises();

    expect(prompt.props('error')).toBe('Invalid credentials');
    expect(mockUser.totpEnabled).toBe(true); // unchanged
  });

  it('regenerates recovery codes: posts then shows the codes modal', async () => {
    mockUser.totpEnabled = true;
    const codes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    mockApiFetch.mockResolvedValueOnce({ recoveryCodes: codes });
    const w = mountCard();

    await w.find('[aria-label="Regenerate recovery codes"]').trigger('click');
    const prompt = w
      .findAllComponents(PromptStub)
      .find((p) => p.props('title') === 'Regenerate recovery codes')!;
    prompt.vm.$emit('confirm', 'masterpw');
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/2fa/recovery-codes', {
      method: 'POST',
      body: { password: 'masterpw' },
    });
    const codesModal = w.findComponent(CodesStub);
    expect(codesModal.props('open')).toBe(true);
    expect(codesModal.props('codes')).toEqual(codes);
  });
});
