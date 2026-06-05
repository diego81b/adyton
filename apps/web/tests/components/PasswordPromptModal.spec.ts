import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import PasswordPromptModal from '../../app/components/PasswordPromptModal.vue';

const UModalStub = {
  name: 'UModal',
  props: ['open', 'title'],
  template: '<div class="umodal"><slot name="content" /></div>',
};
const UButtonStub = {
  name: 'UButton',
  props: ['disabled', 'loading', 'color'],
  emits: ['click'],
  template:
    '<button :data-color="color" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
};
const UFormFieldStub = {
  name: 'UFormField',
  props: ['label', 'name'],
  template: '<div :data-name="name"><slot /></div>',
};
const PasswordInputStub = {
  name: 'PasswordInput',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template:
    '<input class="pwinput" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

function mountModal(props: Record<string, unknown> = {}) {
  return mount(PasswordPromptModal, {
    props: { open: true, title: 'Confirm action', ...props },
    global: {
      stubs: {
        UModal: UModalStub,
        UButton: UButtonStub,
        UFormField: UFormFieldStub,
        UIcon: true,
        PasswordInput: PasswordInputStub,
      },
    },
  });
}

describe('PasswordPromptModal', () => {
  it('disables confirm until a password is entered', async () => {
    const w = mountModal({ confirmLabel: 'Disable 2FA' });
    const confirm = w.findAll('button').find((b) => b.text() === 'Disable 2FA')!;
    expect(confirm.attributes('disabled')).toBeDefined();

    await w.find('.pwinput').setValue('hunter2!');
    expect(confirm.attributes('disabled')).toBeUndefined();
  });

  it('emits confirm with the password', async () => {
    const w = mountModal({ confirmLabel: 'Regenerate' });
    await w.find('.pwinput').setValue('s3cret');
    await w.findAll('button').find((b) => b.text() === 'Regenerate')!.trigger('click');

    expect(w.emitted('confirm')).toEqual([['s3cret']]);
  });

  it('does not emit confirm when empty', async () => {
    const w = mountModal();
    await w.findAll('button').find((b) => b.text() === 'Confirm')!.trigger('click');
    expect(w.emitted('confirm')).toBeUndefined();
  });

  it('renders the danger variant with error text', () => {
    const w = mountModal({ danger: true, error: 'Invalid credentials', confirmLabel: 'Disable 2FA' });
    const confirm = w.findAll('button').find((b) => b.text() === 'Disable 2FA')!;
    expect(confirm.attributes('data-color')).toBe('error');
    expect(w.text()).toContain('Invalid credentials');
  });

  it('clears the password when reopened', async () => {
    const w = mountModal();
    await w.find('.pwinput').setValue('something');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect((w.find('.pwinput').element as HTMLInputElement).value).toBe('');
  });
});
