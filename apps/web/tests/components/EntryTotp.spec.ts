import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';

const code = ref('847291');
const remaining = ref(18);
const error = ref(false);

vi.mock('~/composables/useTotp', () => ({
  useTotp: () => ({ code, remaining, error, progress: () => 0.4 }),
}));

import EntryTotp from '../../app/components/EntryTotp.vue';

const UButtonStub = {
  name: 'UButton',
  props: ['icon', 'ariaLabel'],
  emits: ['click'],
  template: '<button :data-icon="icon" @click="$emit(\'click\', $event)" />',
};

let store = '';
const writeText = vi.fn(async (t: string) => {
  store = t;
});

beforeEach(() => {
  store = '';
  writeText.mockClear();
  code.value = '847291';
  remaining.value = 18;
  error.value = false;
  vi.stubGlobal('navigator', { clipboard: { writeText, readText: async () => store } });
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

function mountTotp() {
  return mount(EntryTotp, {
    props: { secret: 'JBSWY3DPEHPK3PXP' },
    global: { stubs: { UButton: UButtonStub } },
  });
}

describe('EntryTotp', () => {
  it('renders the code grouped 3+3 and the remaining seconds', () => {
    const w = mountTotp();
    expect(w.text()).toContain('847 291');
    expect(w.text()).toContain('18');
  });

  it('copies the raw (ungrouped) code', async () => {
    const w = mountTotp();
    await w.find('[data-icon="i-lucide-copy"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('847291');
  });

  it('shows an error message for an invalid seed', () => {
    error.value = true;
    code.value = '';
    const w = mountTotp();
    expect(w.text().toLowerCase()).toContain('invalid totp');
  });
});
