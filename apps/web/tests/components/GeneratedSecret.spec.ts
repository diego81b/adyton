import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GeneratedSecret from '../../app/components/GeneratedSecret.vue';

const UButtonStub = {
  name: 'UButton',
  props: ['icon', 'disabled', 'ariaLabel'],
  emits: ['click'],
  template:
    '<button :data-icon="icon" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
};

function mountSecret(props: { value: string; words?: string[]; error?: string }) {
  return mount(GeneratedSecret, {
    props,
    global: { stubs: { UButton: UButtonStub } },
  });
}

describe('GeneratedSecret', () => {
  it('renders password chars with per-class coloring', () => {
    const w = mountSecret({ value: 'aB3!' });
    const spans = w.find('[data-testid="generated-value"]').findAll('span');
    expect(spans).toHaveLength(4);
    expect(spans[0]!.classes()).toHaveLength(0);                 // lowercase: default
    // Theme-adaptive: light shade + dark: override so chars stay readable in both modes.
    expect(spans[1]!.classes()).toContain('text-amber-700');     // uppercase
    expect(spans[1]!.classes()).toContain('dark:text-amber-300');
    expect(spans[2]!.classes()).toContain('text-primary');       // digit
    expect(spans[3]!.classes()).toContain('text-rose-700');      // symbol
    expect(spans[3]!.classes()).toContain('dark:text-rose-300');
    expect(w.text()).toContain('Generated Password');
  });

  it('renders passphrase words with alternating accent and dim separators', () => {
    const w = mountSecret({ value: 'alpha-beta-gamma', words: ['alpha', 'beta', 'gamma'] });
    const spans = w.find('[data-testid="generated-value"]').findAll('span');
    // 3 words + 2 separators
    expect(spans).toHaveLength(5);
    expect(spans[0]!.text()).toBe('alpha');
    expect(spans[1]!.text()).toBe('-');
    expect(spans[1]!.classes()).toContain('text-dimmed');
    expect(spans[2]!.classes()).toContain('text-primary'); // odd-index word
    expect(w.text()).toContain('Generated Passphrase');
  });

  it('emits copy and regenerate', async () => {
    const w = mountSecret({ value: 'secret' });
    await w.find('[data-icon="i-lucide-copy"]').trigger('click');
    await w.find('[data-icon="i-lucide-refresh-cw"]').trigger('click');
    expect(w.emitted('copy')).toHaveLength(1);
    expect(w.emitted('regenerate')).toHaveLength(1);
  });

  it('shows the error instead of a value and disables copy', () => {
    const w = mountSecret({ value: '', error: 'No character classes selected' });
    expect(w.find('[data-testid="generated-value"]').exists()).toBe(false);
    expect(w.text()).toContain('No character classes selected');
    expect(w.find('[data-icon="i-lucide-copy"]').attributes('disabled')).toBeDefined();
  });
});
