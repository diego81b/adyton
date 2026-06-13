import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import DetailField from '../../app/components/DetailField.vue';

const UIconStub = {
  name: 'UIcon',
  props: ['name'],
  template: '<i :data-icon="name" />',
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
  return mount(DetailField, { props: props as never, global: { stubs: { UIcon: UIconStub } } });
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
    await w.get('[aria-label="Reveal Password"]').trigger('click');
    expect(w.text()).toContain('hunter2secret');
  });

  it('copies the raw value to the clipboard', async () => {
    const w = mountField({ label: 'Password', value: 'topsecret', revealable: true });
    await w.get('[aria-label="Copy Password"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('topsecret');
  });

  it('renders an external-link button when link is set', () => {
    const w = mountField({ label: 'Site URL', value: 'https://x.com', link: 'https://x.com' });
    const link = w.get('[aria-label="Open Site URL"]');
    expect(link.attributes('href')).toBe('https://x.com/');
  });

  it('refuses to bind a javascript: URI to href (XSS guard)', () => {
    const w = mountField({
      label: 'Site URL',
      value: 'x',
      // eslint-disable-next-line no-script-url
      link: 'javascript:alert(1)',
    });
    expect(w.find('[aria-label="Open Site URL"]').exists()).toBe(false);
  });

  it('omits the copy button when copyable is false', () => {
    const w = mountField({ label: 'Description', value: 'just a note', copyable: false });
    expect(w.find('[aria-label="Copy Description"]').exists()).toBe(false);
  });
});
