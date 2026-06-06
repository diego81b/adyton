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

function jsonEntry(content: string): DecryptedEntry {
  return {
    ...envEntry(),
    label: 'appsettings',
    envContent: content,
    envParsed: {}, // parseEnv extracts nothing from JSON lines
  };
}

function mountWith(entry: DecryptedEntry) {
  return mount(EnvFileTable, {
    props: { entry },
    global: { stubs: { UButton: UButtonStub } },
  });
}

describe('EnvFileTable — JSON / raw fallback', () => {
  const JSON_CONTENT = '{"ConnectionStrings":{"Db":"Server=x;Password=hunter2!"}}';

  it('renders the raw viewer (hidden by default) instead of an empty table', () => {
    const w = mountWith(jsonEntry(JSON_CONTENT));
    expect(w.text()).toContain('JSON file');
    expect(w.text()).toContain('Content hidden');
    expect(w.text()).not.toContain('hunter2!');
    expect(w.text()).not.toContain('No variables in this file.');
  });

  it('reveals pretty-printed JSON on toggle and hides it again', async () => {
    const w = mountWith(jsonEntry(JSON_CONTENT));
    await w.find('[aria-label="Reveal content"]').trigger('click');
    const pre = w.find('[data-testid="raw-content"]');
    expect(pre.exists()).toBe(true);
    expect(pre.text()).toContain('hunter2!');
    expect(pre.text()).toContain('  "ConnectionStrings"'); // pretty-printed indent
    await w.find('[aria-label="Hide content"]').trigger('click');
    expect(w.find('[data-testid="raw-content"]').exists()).toBe(false);
  });

  it('shows malformed JSON verbatim', async () => {
    const w = mountWith(jsonEntry('{not valid json'));
    await w.find('[aria-label="Reveal content"]').trigger('click');
    expect(w.find('[data-testid="raw-content"]').text()).toBe('{not valid json');
  });

  it('falls back to the raw viewer for non-JSON content the parser cannot read', () => {
    const w = mountWith({ ...jsonEntry('some opaque blob without equals'), envContent: 'some opaque blob without equals' });
    expect(w.text()).toContain('Raw file');
  });

  it('downloads JSON content with a .json extension and mime type', () => {
    const createObjectURL = vi.fn(() => 'blob:y');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchors: HTMLAnchorElement[] = [];
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'a') {
        el.click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    });

    const w = mountWith(jsonEntry(JSON_CONTENT));
    (w.vm as unknown as { downloadEnv: () => void }).downloadEnv();

    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(anchors[0]!.download).toBe('appsettings.json');
  });

  it('keeps the .env extension for dotenv content', () => {
    const createObjectURL = vi.fn(() => 'blob:z');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const anchors: HTMLAnchorElement[] = [];
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = orig(tag);
      if (tag === 'a') {
        el.click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    });

    const w = mountTable();
    (w.vm as unknown as { downloadEnv: () => void }).downloadEnv();
    expect(anchors[0]!.download).toBe('api-service.env');
  });
});
