import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PasswordInput from '../../app/components/PasswordInput.vue';

const UInputStub = {
  name: 'UInput',
  props: ['type', 'modelValue', 'ui'],
  template: '<div class="uinput" :data-type="type" :data-base="ui?.base"><slot name="trailing" /></div>',
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
  it('renders type="password" by default so the browser can suggest and save credentials', () => {
    expect(mountInput().find('.uinput').attributes('data-type')).toBe('password');
  });

  it('uses font-mono base class and shows a "show" (eye) toggle by default', () => {
    const wrapper = mountInput();
    expect(wrapper.find('.uinput').attributes('data-base')).toContain('font-mono');
    const btn = wrapper.find('.ubutton');
    expect(btn.attributes('data-icon')).toBe('i-lucide-eye');
    expect(btn.attributes('aria-label')).toBe('Show password');
  });

  it('switches to type="text" and flips the icon/label when the eye button is clicked', async () => {
    const wrapper = mountInput();
    await wrapper.find('.ubutton').trigger('click');
    expect(wrapper.find('.uinput').attributes('data-type')).toBe('text');
    const btn = wrapper.find('.ubutton');
    expect(btn.attributes('data-icon')).toBe('i-lucide-eye-off');
    expect(btn.attributes('aria-label')).toBe('Hide password');
  });

  it('toggles back to type="password" on a second click', async () => {
    const wrapper = mountInput();
    await wrapper.find('.ubutton').trigger('click');
    await wrapper.find('.ubutton').trigger('click');
    expect(wrapper.find('.uinput').attributes('data-type')).toBe('password');
  });

  it('does not carry password-manager suppression attributes', () => {
    const input = mountInput().find('.uinput');
    expect(input.attributes('data-1p-ignore')).toBeUndefined();
    expect(input.attributes('data-lpignore')).toBeUndefined();
    expect(input.attributes('data-bwignore')).toBeUndefined();
  });
});
