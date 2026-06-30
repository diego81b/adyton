import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import RecoveryKitSetupStep from '../../app/components/RecoveryKitSetupStep.vue';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
const UButtonStub = {
  name: 'UButton',
  props: ['color', 'variant', 'icon', 'loading', 'disabled', 'block', 'size'],
  emits: ['click'],
  template:
    '<button :aria-label="$attrs[\'aria-label\']" :data-loading="loading" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
};

const UAlertStub = {
  name: 'UAlert',
  props: ['color', 'variant', 'icon', 'title', 'description'],
  template: '<div role="alert" :data-color="color"><strong>{{ title }}</strong> {{ description }}</div>',
};

const UCheckboxStub = {
  name: 'UCheckbox',
  props: ['modelValue', 'label'],
  emits: ['update:modelValue'],
  template:
    '<label><input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>',
};

function make24Words(): string[] {
  return Array.from({ length: 24 }, (_, i) => `word${i + 1}`);
}

function mountStep(props?: { mnemonic?: string[]; loading?: boolean }) {
  return mount(RecoveryKitSetupStep, {
    props: {
      mnemonic: props?.mnemonic ?? make24Words(),
      loading: props?.loading ?? false,
    },
    global: {
      stubs: {
        UButton: UButtonStub,
        UAlert: UAlertStub,
        UCheckbox: UCheckboxStub,
      },
    },
  });
}

describe('RecoveryKitSetupStep', () => {
  it('renders all 24 words in the grid', async () => {
    const words = make24Words();
    const wrapper = await mountStep({ mnemonic: words });
    for (const word of words) {
      expect(wrapper.text()).toContain(word);
    }
  });

  it('shows numbered labels 1–24 for each word', async () => {
    const wrapper = await mountStep();
    expect(wrapper.text()).toContain('1.');
    expect(wrapper.text()).toContain('24.');
  });

  it('confirm button is disabled until checkbox is checked', async () => {
    const wrapper = await mountStep();
    const confirmBtn = wrapper
      .findAll('button')
      .find(b => b.text().includes("I'm done"));
    expect(confirmBtn?.attributes('disabled')).toBeDefined();
  });

  it('confirm button becomes enabled after checkbox is checked', async () => {
    const wrapper = await mountStep();
    // Emit the update event on the UCheckbox stub to simulate the user checking it
    await wrapper.findComponent({ name: 'UCheckbox' }).vm.$emit('update:modelValue', true);
    await flushPromises();
    const confirmBtn = wrapper
      .findAll('button')
      .find(b => b.text().includes("I'm done"));
    expect(confirmBtn?.attributes('disabled')).toBeUndefined();
  });

  it('emits "confirm" when the confirm button is clicked after checking the checkbox', async () => {
    const wrapper = await mountStep();
    await wrapper.findComponent({ name: 'UCheckbox' }).vm.$emit('update:modelValue', true);
    await flushPromises();
    const confirmBtn = wrapper
      .findAll('button')
      .find(b => b.text().includes("I'm done"));
    await confirmBtn!.trigger('click');
    expect(wrapper.emitted('confirm')).toBeTruthy();
  });

  it('shows the confirm button as loading when loading=true', async () => {
    const wrapper = await mountStep({ loading: true });
    const confirmBtn = wrapper
      .findAll('button')
      .find(b => b.text().includes("I'm done"));
    expect(confirmBtn?.attributes('data-loading')).toBe('true');
  });

  it('has a copy-all button', async () => {
    const wrapper = await mountStep();
    const copyBtn = wrapper.find('[aria-label="Copy all 24 words"]');
    expect(copyBtn.exists()).toBe(true);
  });

  it('shows the warning alert banner', async () => {
    const wrapper = await mountStep();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
});
