import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DEFAULT_USER_SETTINGS } from '@adyton/shared';

const mockApiFetch = vi.fn();
vi.mock('../../app/stores/auth', () => ({
  useAuthStore: () => ({ apiFetch: mockApiFetch }),
}));

const { useSettingsStore } = await import('../../app/stores/settings');

const CACHE_KEY = 'adyton:settings';

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  mockApiFetch.mockReset();
});

describe('useSettingsStore — boot', () => {
  it('starts with defaults when no cache exists', () => {
    const store = useSettingsStore();
    expect(store.settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(store.loaded).toBe(false);
  });

  it('boots from the localStorage cache when present', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ lockDurationMs: 300_000 }));
    const store = useSettingsStore();
    expect(store.lockDurationMs).toBe(300_000);
    expect(store.lockMode).toBe('activity'); // missing keys fall back to defaults
    expect(store.loaded).toBe(false); // cache is not authoritative
  });

  it('survives a corrupted cache', () => {
    localStorage.setItem(CACHE_KEY, '{not json');
    const store = useSettingsStore();
    expect(store.settings).toEqual(DEFAULT_USER_SETTINGS);
  });
});

describe('useSettingsStore.fetchSettings', () => {
  it('adopts the server copy, marks loaded, and refreshes the cache', async () => {
    mockApiFetch.mockResolvedValueOnce({
      displayName: 'Alice',
      lockMode: 'absolute',
      lockDurationMs: 600_000,
    });
    const store = useSettingsStore();
    await store.fetchSettings();

    expect(mockApiFetch).toHaveBeenCalledWith('/settings');
    expect(store.displayName).toBe('Alice');
    expect(store.lockMode).toBe('absolute');
    expect(store.loaded).toBe(true);
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject({
      displayName: 'Alice',
      lockDurationMs: 600_000,
    });
  });
});

describe('useSettingsStore.updateSettings', () => {
  it('PUTs the patch and adopts the merged server response', async () => {
    mockApiFetch.mockResolvedValueOnce({
      displayName: '',
      lockMode: 'activity',
      lockDurationMs: 1_800_000,
    });
    const store = useSettingsStore();
    await store.updateSettings({ lockDurationMs: 1_800_000 });

    expect(mockApiFetch).toHaveBeenCalledWith('/settings', {
      method: 'PUT',
      body: { lockDurationMs: 1_800_000 },
    });
    expect(store.lockDurationMs).toBe(1_800_000);
    expect(store.saving).toBe(false);
  });

  it('clears saving and rethrows on failure', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('500'));
    const store = useSettingsStore();
    await expect(store.updateSettings({ displayName: 'x' })).rejects.toThrow('500');
    expect(store.saving).toBe(false);
    expect(store.displayName).toBe(''); // unchanged
  });
});

describe('useSettingsStore.clear', () => {
  it('resets to defaults and drops the cache', async () => {
    mockApiFetch.mockResolvedValueOnce({
      displayName: 'Alice',
      lockMode: 'absolute',
      lockDurationMs: 0,
    });
    const store = useSettingsStore();
    await store.fetchSettings();

    store.clear();
    expect(store.settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(store.loaded).toBe(false);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});
