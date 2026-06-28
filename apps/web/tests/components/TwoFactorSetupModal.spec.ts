import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mockApiFetch = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch: mockApiFetch }),
}));

import TwoFactorSetupModal from '../../app/components/TwoFactorSetupModal.vue';

const SETUP = { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://x', qrDataUri: 'data:image/png;base64,xxx' };
const RECOVERY = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];

const UModalStub = {
  name: 'UModal',
  props: ['open', 'title', 'dismissible', 'close'],
  template: '<div class="umodal" :data-dismissible="dismissible" :data-close="close"><slot name="content" /></div>',
};
const UButtonStub = {
  name: 'UButton',
  props: ['disabled', 'loading'],
  emits: ['click'],
  template: '<button :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
};
// OtpInput stub mirrors its public contract: digit-filtered model + `complete`
// on full length. The verify step relies on `@complete` to auto-submit.
const OtpInputStub = {
  name: 'OtpInput',
  props: ['modelValue', 'length', 'invalid'],
  emits: ['update:modelValue', 'complete'],
  template: '<input class="otp" :value="modelValue" @input="onInput($event)" />',
  methods: {
    onInput(e: Event) {
      const len = (this as unknown as { length: number }).length ?? 6;
      const next = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, len);
      const self = this as unknown as { $emit: (n: string, ...a: unknown[]) => void };
      self.$emit('update:modelValue', next);
      if (next.length === len) self.$emit('complete', next);
    },
  },
};
const UFormFieldStub = {
  name: 'UFormField',
  props: ['label', 'name'],
  template: '<div><slot /></div>',
};
const UCheckboxStub = {
  name: 'UCheckbox',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template:
    '<input type="checkbox" class="ack" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
};
const RecoveryCodesListStub = {
  name: 'RecoveryCodesList',
  props: ['codes'],
  template: '<div class="codes">{{ codes.length }}</div>',
};

function mountModal() {
  return mount(TwoFactorSetupModal, {
    props: { open: true },
    global: {
      stubs: {
        UModal: UModalStub,
        UButton: UButtonStub,
        OtpInput: OtpInputStub,
        UFormField: UFormFieldStub,
        UCheckbox: UCheckboxStub,
        UAlert: { props: ['title'], template: '<div class="ualert">{{ title }}</div>' },
        UIcon: true,
        RecoveryCodesList: RecoveryCodesListStub,
      },
    },
  });
}

beforeEach(() => {
  mockApiFetch.mockReset();
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('TwoFactorSetupModal', () => {
  it('calls setup on open and shows the QR + secret', async () => {
    mockApiFetch.mockResolvedValueOnce(SETUP);
    const w = mountModal();
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/2fa/setup', { method: 'POST' });
    expect(w.find('img').attributes('src')).toBe(SETUP.qrDataUri);
    expect(w.text()).toContain(SETUP.secret);
  });

  it('verifies the code, advances to recovery, and locks the modal', async () => {
    mockApiFetch.mockResolvedValueOnce(SETUP); // setup
    mockApiFetch.mockResolvedValueOnce({ recoveryCodes: RECOVERY }); // enable
    const w = mountModal();
    await flushPromises();

    await w.findAll('button').find((b) => b.text() === 'Continue')!.trigger('click');
    await w.find('.otp').setValue('123456');
    // Auto-submit fires on the 6th digit — no need to click Verify.
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/2fa/enable', {
      method: 'POST',
      body: { code: '123456' },
    });
    expect(w.find('.codes').text()).toBe('8');
    // step c locks: not dismissible, no close button
    expect(w.find('.umodal').attributes('data-dismissible')).toBe('false');
    expect(w.find('.umodal').attributes('data-close')).toBe('false');
  });

  it('shows an inline error on 401 and stays on verify', async () => {
    mockApiFetch.mockResolvedValueOnce(SETUP);
    mockApiFetch.mockRejectedValueOnce({ statusCode: 401 });
    const w = mountModal();
    await flushPromises();

    await w.findAll('button').find((b) => b.text() === 'Continue')!.trigger('click');
    await w.find('.otp').setValue('000000');
    // Auto-submit fires on the 6th digit — no need to click Verify.
    await flushPromises();

    expect(w.text()).toContain('Invalid code');
    expect(w.find('.codes').exists()).toBe(false);
  });

  it('auto-submits when 6 digits are entered in the verify step', async () => {
    mockApiFetch.mockResolvedValueOnce(SETUP);
    mockApiFetch.mockResolvedValueOnce({ recoveryCodes: RECOVERY });
    const w = mountModal();
    await flushPromises();

    await w.findAll('button').find((b) => b.text() === 'Continue')!.trigger('click');
    await w.find('.otp').setValue('123456');
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/2fa/enable', {
      method: 'POST',
      body: { code: '123456' },
    });
    expect(w.find('.codes').text()).toBe('8');
  });

  it('gates Done behind the acknowledgment checkbox and emits enabled', async () => {
    mockApiFetch.mockResolvedValueOnce(SETUP);
    mockApiFetch.mockResolvedValueOnce({ recoveryCodes: RECOVERY });
    const w = mountModal();
    await flushPromises();

    await w.findAll('button').find((b) => b.text() === 'Continue')!.trigger('click');
    await w.find('.otp').setValue('123456');
    // Auto-submit fires on the 6th digit — no need to click Verify.
    await flushPromises();

    const done = w.findAll('button').find((b) => b.text() === 'Done')!;
    expect(done.attributes('disabled')).toBeDefined();

    await w.find('.ack').setValue(true);
    expect(done.attributes('disabled')).toBeUndefined();

    await done.trigger('click');
    expect(w.emitted('enabled')).toHaveLength(1);
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
  });
});
