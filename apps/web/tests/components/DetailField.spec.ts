import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import DetailField from '../../app/components/DetailField.vue';

const UButtonStub = {
  name: 'UButton',
  props: ['icon', 'to', 'ariaLabel'],
  emits: ['click'],
  template: '<button :data-icon="icon" :data-to="to" @click="$emit(\'click\', $event)" />',
};

let store = '';
const writeText = vi.fn(async (t: string) => {
  store = t;
});

beforeEach(() => {
  store = '';
  writeText.mockClear();
  vi.stubGlobal('navigator', { clipboard: { writeText, readText: async () => store } });
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

function mountField(props: Record<string, unknown>) {
  return mount(DetailField, { props: props as never, global: { stubs: { UButton: UButtonStub } } });
}

describe('DetailField', () => {
  it('renders label and a non-revealable value in plaintext', () => {
    const w = mountField({ label: 'Username', value: 'octocat', revealable: false });
    expect(w.text()).toContain('Username');
    expect(w.text()).toContain('octocat');
  });

  it('masks a revealable value until revealed', async () => {
    const w = mountField({ label: 'Password', value: 'hunter2secret', revealable: true });
    expect(w.text()).not.toContain('hunter2secret');
    expect(w.text()).toContain('•');
    await w.find('[data-icon="i-lucide-eye"]').trigger('click');
    expect(w.text()).toContain('hunter2secret');
  });

  it('copies the raw value to the clipboard', async () => {
    const w = mountField({ label: 'Password', value: 'topsecret', revealable: true });
    await w.find('[data-icon="i-lucide-copy"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('topsecret');
  });

  it('renders an external-link button when link is set', () => {
    const w = mountField({ label: 'Site URL', value: 'https://x.com', link: 'https://x.com' });
    expect(w.find('[data-icon="i-lucide-external-link"]').exists()).toBe(true);
  });

  it('omits the copy button when copyable is false', () => {
    const w = mountField({ label: 'Description', value: 'just a note', copyable: false });
    expect(w.find('[data-icon="i-lucide-copy"]').exists()).toBe(false);
  });
});
