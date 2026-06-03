import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope } from 'vue';
import { useSecureClipboard } from '../../app/composables/useSecureClipboard';

let store = '';
const writeText = vi.fn(async (t: string) => {
  store = t;
});
const readText = vi.fn(async () => store);

beforeEach(() => {
  vi.useFakeTimers();
  store = '';
  writeText.mockClear();
  readText.mockClear();
  vi.stubGlobal('navigator', { clipboard: { writeText, readText } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSecureClipboard', () => {
  it('writes the value and sets copied', async () => {
    const scope = effectScope();
    await scope.run(async () => {
      const { copy, copied } = useSecureClipboard();
      const ok = await copy('secret');
      expect(ok).toBe(true);
      expect(copied.value).toBe(true);
      expect(store).toBe('secret');
    });
    scope.stop();
  });

  it('clears the clipboard after 30s if still ours', async () => {
    const scope = effectScope();
    await scope.run(async () => {
      const { copy, copied } = useSecureClipboard();
      await copy('secret');
      expect(store).toBe('secret');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(store).toBe('');
      expect(copied.value).toBe(false);
    });
    scope.stop();
  });

  it('does not clear if the clipboard changed since copy', async () => {
    const scope = effectScope();
    await scope.run(async () => {
      const { copy } = useSecureClipboard();
      await copy('secret');
      store = 'something-else'; // user copied elsewhere
      await vi.advanceTimersByTimeAsync(30_000);
      expect(store).toBe('something-else');
    });
    scope.stop();
  });

  it('returns false when the clipboard write fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const scope = effectScope();
    await scope.run(async () => {
      const { copy, copied } = useSecureClipboard();
      const ok = await copy('x');
      expect(ok).toBe(false);
      expect(copied.value).toBe(false);
    });
    scope.stop();
  });
});
