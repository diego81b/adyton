import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PasswordInput from '../../app/components/PasswordInput.vue';

const UInputStub = {
  name: 'UInput',
  props: ['type', 'modelValue', 'ui', 'required'],
  template:
    '<div class="uinput" :data-type="type" :data-base="ui?.base" :data-required="String(required)"><slot name="trailing" /></div>',
};
const UButtonStub = {
  name: 'UButton',
  props: ['icon', 'ariaLabel'],
  emits: ['click'],
  template:
    '<button class="ubutton" :data-icon="icon" :aria-label="ariaLabel" @click="$emit(\'click\')" />',
};

function mountInput(props: Record<string, unknown> = {}) {
  return mount(PasswordInput, {
    props: { modelValue: '', ...props },
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

  it('is required by default (auth fields) and optional when required=false (vault fields)', () => {
    expect(mountInput().find('.uinput').attributes('data-required')).toBe('true');
    expect(mountInput({ required: false }).find('.uinput').attributes('data-required')).toBe('false');
  });

  // Vault entry fields: type must stay "text" so Android Autofill / Google Password
  // Manager never classify them as password fields (no save prompt on Capacitor).
  // Masking happens in CSS instead (text-security-disc).
  describe('concealed mode (vault secrets)', () => {
    it('renders type="text" with the CSS masking class instead of type="password"', () => {
      const input = mountInput({ concealed: true }).find('.uinput');
      expect(input.attributes('data-type')).toBe('text');
      expect(input.attributes('data-base')).toContain('text-security-disc');
    });

    it('reveals by dropping the masking class, keeping type="text"', async () => {
      const wrapper = mountInput({ concealed: true });
      await wrapper.find('.ubutton').trigger('click');
      const input = wrapper.find('.uinput');
      expect(input.attributes('data-type')).toBe('text');
      expect(input.attributes('data-base')).not.toContain('text-security-disc');
    });

    it('re-masks on a second toggle without ever becoming type="password"', async () => {
      const wrapper = mountInput({ concealed: true });
      await wrapper.find('.ubutton').trigger('click');
      await wrapper.find('.ubutton').trigger('click');
      const input = wrapper.find('.uinput');
      expect(input.attributes('data-type')).toBe('text');
      expect(input.attributes('data-base')).toContain('text-security-disc');
    });
  });
});
