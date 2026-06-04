import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mockApiFetch = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch: mockApiFetch }),
}));

import DeleteAccountModal from '../../app/components/DeleteAccountModal.vue';

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
  template: '<div :data-name="name"><slot name="label" />{{ label }}<slot /></div>',
};
const UInputStub = {
  name: 'UInput',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template:
    '<input class="uinput" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const PasswordInputStub = {
  name: 'PasswordInput',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template:
    '<input class="pwinput" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

function mountModal() {
  return mount(DeleteAccountModal, {
    props: { modelValue: true },
    global: {
      stubs: {
        UModal: UModalStub,
        UButton: UButtonStub,
        UFormField: UFormFieldStub,
        UInput: UInputStub,
        UIcon: true,
        PasswordInput: PasswordInputStub,
      },
    },
  });
}

beforeEach(() => {
  mockApiFetch.mockReset();
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});

describe('DeleteAccountModal', () => {
  it('disables deletion until password AND typed DELETE are present', async () => {
    const w = mountModal();
    const deleteBtn = w.find('button[data-color="error"]');
    expect(deleteBtn.attributes('disabled')).toBeDefined();

    await w.find('.pwinput').setValue('hunter2!');
    expect(deleteBtn.attributes('disabled')).toBeDefined(); // still missing DELETE

    await w.find('.uinput').setValue('delete'); // case-insensitive
    expect(deleteBtn.attributes('disabled')).toBeUndefined();
  });

  it('calls DELETE /auth/account and emits deleted on success', async () => {
    mockApiFetch.mockResolvedValueOnce(undefined);
    const w = mountModal();
    await w.find('.pwinput').setValue('hunter2!');
    await w.find('.uinput').setValue('DELETE');
    await w.find('button[data-color="error"]').trigger('click');
    await flushPromises();

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/account', {
      method: 'DELETE',
      body: { password: 'hunter2!' },
    });
    expect(w.emitted('deleted')).toHaveLength(1);
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('shows a wrong-password error on 401 and stays open', async () => {
    mockApiFetch.mockRejectedValueOnce({ statusCode: 401 });
    const w = mountModal();
    await w.find('.pwinput').setValue('wrong');
    await w.find('.uinput').setValue('DELETE');
    await w.find('button[data-color="error"]').trigger('click');
    await flushPromises();

    expect(w.text()).toContain('Wrong master password');
    expect(w.emitted('deleted')).toBeUndefined();
  });

  it('resets fields when reopened', async () => {
    const w = mountModal();
    await w.find('.pwinput').setValue('something');
    await w.setProps({ modelValue: false });
    await w.setProps({ modelValue: true });
    expect((w.find('.pwinput').element as HTMLInputElement).value).toBe('');
  });
});
