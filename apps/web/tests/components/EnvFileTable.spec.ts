import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { VaultEntryType, type DecryptedEntry } from '@adyton/shared';
import EnvFileTable from '../../app/components/EnvFileTable.vue';

const UButtonStub = {
  name: 'UButton',
  props: ['icon', 'ariaLabel'],
  emits: ['click'],
  template: '<button :data-icon="icon" :aria-label="ariaLabel" @click="$emit(\'click\', $event)" />',
};

let store = '';
const writeText = vi.fn(async (t: string) => {
  store = t;
});

function envEntry(): DecryptedEntry {
  return {
    id: 'env1',
    type: VaultEntryType.ENV_FILE,
    label: 'api-service',
    createdAt: new Date(),
    updatedAt: new Date(),
    secretVersion: 3,
    environment: 'production',
    envContent: 'DATABASE_URL=postgres://x\nREDIS_URL=redis://y',
    envParsed: { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://y' },
  };
}

beforeEach(() => {
  store = '';
  writeText.mockClear();
  vi.stubGlobal('navigator', { clipboard: { writeText, readText: async () => store } });
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountTable() {
  return mount(EnvFileTable, {
    props: { entry: envEntry() },
    global: { stubs: { UButton: UButtonStub } },
  });
}

describe('EnvFileTable', () => {
  it('renders a row per variable with the key shown', () => {
    const w = mountTable();
    expect(w.text()).toContain('DATABASE_URL');
    expect(w.text()).toContain('REDIS_URL');
  });

  it('masks values until revealed', async () => {
    const w = mountTable();
    expect(w.text()).not.toContain('postgres://x');
    await w.find('[aria-label="Reveal DATABASE_URL"]').trigger('click');
    expect(w.text()).toContain('postgres://x');
  });

  it('copies an individual value, never the whole file', async () => {
    const w = mountTable();
    await w.find('[aria-label="Copy DATABASE_URL"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('postgres://x');
  });

  it('downloadEnv exports the full envContent as a blob download', () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'a') el.click = click;
      return el;
    });

    const w = mountTable();
    (w.vm as unknown as { downloadEnv: () => void }).downloadEnv();

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
});
