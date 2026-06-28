import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import TwoFactorChallenge from '../../app/components/TwoFactorChallenge.vue';

const UFormStub = {
  name: 'UForm',
  props: ['state'],
  emits: ['submit'],
  template: '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
};
const UFormFieldStub = {
  name: 'UFormField',
  props: ['label', 'name'],
  template: '<div :data-name="name"><slot /></div>',
};
const UInputStub = {
  name: 'UInput',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template:
    '<input class="uinput" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
// OtpInput is driven via a single underlying input; the stub mirrors its public
// contract (digit-filtered model + `complete` on full length) so the challenge
// spec exercises its own logic without depending on OtpInput internals.
const OtpInputStub = {
  name: 'OtpInput',
  props: ['modelValue', 'length', 'invalid'],
  emits: ['update:modelValue', 'complete'],
  template:
    '<input class="otp" :value="modelValue" @input="onInput($event)" />',
  methods: {
    onInput(e: Event) {
      const len = (this as unknown as { length: number }).length ?? 6;
      const next = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, len);
      (this as unknown as { $emit: (n: string, ...a: unknown[]) => void }).$emit(
        'update:modelValue',
        next,
      );
      if (next.length === len)
        (this as unknown as { $emit: (n: string, ...a: unknown[]) => void }).$emit('complete', next);
    },
  },
};
const UButtonStub = {
  name: 'UButton',
  props: ['disabled', 'loading', 'type'],
  emits: ['click'],
  template:
    '<button :type="type || \'submit\'" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
};
const UAlertStub = {
  name: 'UAlert',
  props: ['description', 'color'],
  template: '<div class="ualert">{{ description }}</div>',
};

function mountChallenge(
  props: { loading?: boolean; error?: string | null; methods?: Array<'totp' | 'webauthn'> } = {},
) {
  return mount(TwoFactorChallenge, {
    props: { loading: false, error: null, ...props },
    global: {
      stubs: {
        UForm: UFormStub,
        UFormField: UFormFieldStub,
        UInput: UInputStub,
        OtpInput: OtpInputStub,
        UButton: UButtonStub,
        UAlert: UAlertStub,
      },
    },
  });
}

describe('TwoFactorChallenge', () => {
  it('renders the 6-digit code input by default', () => {
    const w = mountChallenge();
    expect(w.find('[data-name="code"]').exists()).toBe(true);
    expect(w.find('[data-name="recoveryCode"]').exists()).toBe(false);
  });

  it('disables submit until a valid 6-digit code is entered', async () => {
    const w = mountChallenge();
    const submit = w.find('button[type="submit"]');
    expect(submit.attributes('disabled')).toBeDefined();

    await w.find('.otp').setValue('123'); // too short
    expect(submit.attributes('disabled')).toBeDefined();

    await w.find('.otp').setValue('123456');
    expect(submit.attributes('disabled')).toBeUndefined();
  });

  it('emits submit with the code payload', async () => {
    const w = mountChallenge();
    await w.find('.otp').setValue('123456');

    // Auto-submit fires when the 6th digit is entered — no need to press the button.
    expect(w.emitted('submit')).toHaveLength(1);
    expect(w.emitted('submit')![0]).toEqual([{ code: '123456' }]);
  });

  it('auto-submits when a complete 6-digit code is entered', async () => {
    const w = mountChallenge();
    await w.find('.otp').setValue('654321');
    expect(w.emitted('submit')).toHaveLength(1);
    expect(w.emitted('submit')![0]).toEqual([{ code: '654321' }]);
  });

  it('toggles to the recovery-code input and validates its format', async () => {
    const w = mountChallenge();
    // The toggle is the only plain button that is not the submit button.
    const toggle = w.findAll('button').find((b) => b.text().includes('recovery code'))!;
    await toggle.trigger('click');

    expect(w.find('[data-name="recoveryCode"]').exists()).toBe(true);
    expect(w.find('[data-name="code"]').exists()).toBe(false);

    const submit = w.find('button[type="submit"]');
    await w.find('.uinput').setValue('aaaaa-bbbbb-ccccc'); // missing one group
    expect(submit.attributes('disabled')).toBeDefined();

    await w.find('.uinput').setValue('aaaaa-bbbbb-ccccc-ddddd');
    expect(submit.attributes('disabled')).toBeUndefined();
  });

  it('emits submit with a lowercased recovery code payload', async () => {
    const w = mountChallenge();
    const toggle = w.findAll('button').find((b) => b.text().includes('recovery code'))!;
    await toggle.trigger('click');

    await w.find('.uinput').setValue('AAAAA-BBBBB-CCCCC-DDDDD');
    await w.find('form').trigger('submit');

    expect(w.emitted('submit')![0]).toEqual([{ recoveryCode: 'aaaaa-bbbbb-ccccc-ddddd' }]);
  });

  it('renders the error in a UAlert', () => {
    const w = mountChallenge({ error: 'Invalid code' });
    expect(w.find('.ualert').text()).toContain('Invalid code');
  });

  it('emits back when the back link is clicked', async () => {
    const w = mountChallenge();
    const back = w.findAll('button').find((b) => b.text().includes('Back to sign in'))!;
    await back.trigger('click');
    expect(w.emitted('back')).toHaveLength(1);
  });

  it('does not render the passkey button when methods is the default (totp only)', () => {
    const w = mountChallenge();
    expect(w.findAll('button').some((b) => b.text().includes('Use a passkey'))).toBe(false);
  });

  it('renders the passkey button when methods includes webauthn and emits passkey', async () => {
    const w = mountChallenge({ methods: ['webauthn', 'totp'] });
    const passkeyBtn = w.findAll('button').find((b) => b.text().includes('Use a passkey'))!;
    expect(passkeyBtn).toBeDefined();
    expect(passkeyBtn.attributes('type')).toBe('button'); // must not submit the code form

    await passkeyBtn.trigger('click');
    expect(w.emitted('passkey')).toHaveLength(1);
  });

  it('still exposes the code form as a fallback when a passkey is available', () => {
    const w = mountChallenge({ methods: ['webauthn', 'totp'] });
    expect(w.find('[data-name="code"]').exists()).toBe(true);
  });
});
