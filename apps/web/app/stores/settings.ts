import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { DEFAULT_USER_SETTINGS, type UserSettings } from '@adyton/shared';
import { useAuthStore } from './auth';

// localStorage boot cache. The DB (GET/PUT /settings) is authoritative; the cache
// only avoids a flash of defaults before the first fetch. NON-SECRET values only —
// never put key material or vault data here (zero-knowledge invariant).
const CACHE_KEY = 'adyton:settings';

function readCache(): Partial<UserSettings> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Partial<UserSettings>) : null;
  } catch {
    return null; // corrupted cache or storage unavailable — fall back to defaults
  }
}

function writeCache(settings: UserSettings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    // storage full/unavailable — cache is best-effort
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<UserSettings>({ ...DEFAULT_USER_SETTINGS, ...readCache() });
  const loaded = ref(false); // true once the authoritative server copy arrived
  const saving = ref(false);

  const displayName = computed(() => settings.value.displayName);
  const lockMode = computed(() => settings.value.lockMode);
  const lockDurationMs = computed(() => settings.value.lockDurationMs);

  /** Fetch the authoritative copy. Call after auth init; safe to call repeatedly. */
  async function fetchSettings(): Promise<void> {
    const auth = useAuthStore();
    const fresh = await auth.apiFetch<UserSettings>('/settings');
    settings.value = { ...DEFAULT_USER_SETTINGS, ...fresh };
    writeCache(settings.value);
    loaded.value = true;
  }

  /** Persist a partial update (server merges and returns the full object). */
  async function updateSettings(patch: Partial<UserSettings>): Promise<void> {
    const auth = useAuthStore();
    saving.value = true;
    try {
      const updated = await auth.apiFetch<UserSettings>('/settings', {
        method: 'PUT',
        body: patch,
      });
      settings.value = { ...DEFAULT_USER_SETTINGS, ...updated };
      writeCache(settings.value);
    } finally {
      saving.value = false;
    }
  }

  /** Reset to defaults and drop the cache (logout / account deletion). */
  function clear() {
    settings.value = { ...DEFAULT_USER_SETTINGS };
    loaded.value = false;
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // best-effort
    }
  }

  return {
    settings,
    loaded,
    saving,
    displayName,
    lockMode,
    lockDurationMs,
    fetchSettings,
    updateSettings,
    clear,
  };
});
