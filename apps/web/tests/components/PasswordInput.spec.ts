import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PasswordInput from '../../app/components/PasswordInput.vue';

// Stub UInput so we can read the resolved `type` + the `ui.base` mask class, and
// expose the #trailing slot.
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
  it('renders type="text" (never type=password — no browser password UI)', () => {
    expect(mountInput().find('.uinput').attributes('data-type')).toBe('text');
  });

  it('is masked by default via the text-security class, with a "show" (eye) toggle', () => {
    const wrapper = mountInput();
    expect(wrapper.find('.uinput').attributes('data-base')).toContain('text-security-disc');
    const btn = wrapper.find('.ubutton');
    expect(btn.attributes('data-icon')).toBe('i-lucide-eye');
    expect(btn.attributes('aria-label')).toBe('Show password');
  });

  it('reveals the value (drops the mask class) and flips the icon/label on toggle', async () => {
    const wrapper = mountInput();
    await wrapper.find('.ubutton').trigger('click');
    expect(wrapper.find('.uinput').attributes('data-base')).not.toContain('text-security-disc');
    const btn = wrapper.find('.ubutton');
    expect(btn.attributes('data-icon')).toBe('i-lucide-eye-off');
    expect(btn.attributes('aria-label')).toBe('Hide password');
  });

  it('toggles back to masked on a second click', async () => {
    const wrapper = mountInput();
    await wrapper.find('.ubutton').trigger('click');
    await wrapper.find('.ubutton').trigger('click');
    expect(wrapper.find('.uinput').attributes('data-base')).toContain('text-security-disc');
  });

  it('carries password-manager suppression attributes onto the input', () => {
    const input = mountInput().find('.uinput');
    // Block 1Password / LastPass / Bitwarden autofill overlays + browser heuristics.
    expect(input.attributes('data-1p-ignore')).toBeDefined();
    expect(input.attributes('data-lpignore')).toBe('true');
    expect(input.attributes('data-bwignore')).toBeDefined();
    expect(input.attributes('spellcheck')).toBe('false');
  });
});
