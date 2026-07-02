// Regression tests for the adyton://pak deep-link plugin after its refactor onto the
// shared parsePakUrl() (utils/pak-url.ts) — same routing behaviour, now via one parser
// also used by the in-app QR scanner.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

const mockIsNative = ref(true);
vi.mock('../../app/composables/useNativeRuntime', () => ({
  useNativeRuntime: () => ({ isNative: mockIsNative.value }),
}));

let urlOpenHandler: ((event: { url: string }) => void) | undefined;
const mockAddListener = vi.fn((event: string, handler: (event: { url: string }) => void) => {
  if (event === 'appUrlOpen') urlOpenHandler = handler;
});
vi.mock('@capacitor/app', () => ({
  App: { addListener: mockAddListener },
}));

const mockPush = vi.fn();
vi.stubGlobal('useRouter', () => ({ push: mockPush }));
vi.stubGlobal('defineNuxtPlugin', (setup: () => unknown) => setup);

function payload(fields: Record<string, unknown>): string {
  return btoa(JSON.stringify(fields));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNative.value = true;
  urlOpenHandler = undefined;
});

async function loadPlugin() {
  vi.resetModules();
  const mod = await import('../../app/plugins/pak-deep-link.client');
  await (mod.default as () => Promise<void>)();
}

describe('pak-deep-link plugin', () => {
  it('does not register a listener on web', async () => {
    mockIsNative.value = false;
    await loadPlugin();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it('routes an enroll payload to /pak/enroll', async () => {
    await loadPlugin();
    const d = payload({ m: 'enroll' });
    urlOpenHandler!({ url: `adyton://pak?d=${d}` });
    expect(mockPush).toHaveBeenCalledWith({ path: '/pak/enroll', query: { d } });
  });

  it('routes a non-enroll payload to /pak/approve', async () => {
    await loadPlugin();
    const d = payload({ m: 'unlock' });
    urlOpenHandler!({ url: `adyton://pak?d=${d}` });
    expect(mockPush).toHaveBeenCalledWith({ path: '/pak/approve', query: { d } });
  });

  it('ignores a non-adyton URL', async () => {
    await loadPlugin();
    urlOpenHandler!({ url: 'https://example.com' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('ignores a malformed adyton URL', async () => {
    await loadPlugin();
    urlOpenHandler!({ url: 'adyton://pak invalid' });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
