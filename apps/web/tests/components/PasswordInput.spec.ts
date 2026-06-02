import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PasswordInput from '../../app/components/PasswordInput.vue';

// Stub UInput so we can read the resolved `type`, and expose the #trailing slot.
const UInputStub = {
  name: 'UInput',
  props: ['type', 'modelValue'],
  template: '<div class="uinput" :data-type="type"><slot name="trailing" /></div>',
};
const UButtonStub = {
  name: 'UButton',
  props: ['icon', 'ariaLabel'],
  emits: ['click'],
  template:
    '<button class="ubutton" :data-icon="icon" :aria-label="ariaLabel" @click="$emit(\'click\')" />',
};

function mountInput() {
  return mount(PasswordInput, {
    props: { modelValue: '' },
    global: { stubs: { UInput: UInputStub, UButton: UButtonStub } },
  });
}

describe('PasswordInput', () => {
  it('is masked by default with a "show" (eye) toggle', () => {
    const wrapper = mountInput();
    expect(wrapper.find('.uinput').attributes('data-type')).toBe('password');
    const btn = wrapper.find('.ubutton');
    expect(btn.attributes('data-icon')).toBe('i-lucide-eye');
    expect(btn.attributes('aria-label')).toBe('Show password');
  });

  it('reveals the value and flips the icon/label on toggle', async () => {
    const wrapper = mountInput();
    await wrapper.find('.ubutton').trigger('click');
    expect(wrapper.find('.uinput').attributes('data-type')).toBe('text');
    const btn = wrapper.find('.ubutton');
    expect(btn.attributes('data-icon')).toBe('i-lucide-eye-off');
    expect(btn.attributes('aria-label')).toBe('Hide password');
  });

  it('toggles back to masked on a second click', async () => {
    const wrapper = mountInput();
    await wrapper.find('.ubutton').trigger('click');
    await wrapper.find('.ubutton').trigger('click');
    expect(wrapper.find('.uinput').attributes('data-type')).toBe('password');
  });
});
