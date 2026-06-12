import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { DecryptedEntry } from '@adyton/shared';
import { useAuthStore } from './auth';
import { useCryptoStore } from './crypto';
import {
  encryptEntry,
  encryptEntryUpdate,
  decryptRawEntry,
  decryptVersion,
  type EntryDraft,
  type RawVaultEntry,
  type RawVaultEntryVersion,
  type DecryptedVersion,
} from '../utils/vault-crypto';

interface PaginatedResponse {
  data: RawVaultEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

const PAGE_LIMIT = 50;

// No persistence plugin: persisting decrypted entries would break zero-knowledge.
export const useVaultStore = defineStore('vault', () => {
  const entries = ref<DecryptedEntry[]>([]);
  const loading = ref(false);
  const cursor = ref<string | null>(null);
  const hasMore = ref(false);
  const loaded = ref(false);

  const byId = computed(() => (id: string) => entries.value.find((e) => e.id === id));

  function requireUnlocked() {
    const crypto = useCryptoStore();
    if (!crypto.isUnlocked || !crypto.cryptoKey) throw new Error('Vault is locked');
    const auth = useAuthStore();
    if (!auth.user) throw new Error('Not authenticated');
    return { key: crypto.cryptoKey, userId: auth.user.id, auth };
  }

  /** Fetch a page. reset=true reloads from the start; otherwise appends the next page. */
  async function fetchEntries(reset = false): Promise<void> {
    const { key, userId, auth } = requireUnlocked();
    if (loading.value) return;
    if (!reset && !hasMore.value && loaded.value) return;
    loading.value = true;
    try {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (!reset && cursor.value) params.set('cursor', cursor.value);
      const raw = await auth.apiFetch<PaginatedResponse>(`/vault?${params.toString()}`);
      const decrypted = await Promise.all(
        raw.data.map((e) => decryptRawEntry(e, key, userId)),
      );
      entries.value = reset ? decrypted : [...entries.value, ...decrypted];
      cursor.value = raw.nextCursor;
      hasMore.value = raw.hasMore;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  function loadMore(): Promise<void> {
    return fetchEntries(false);
  }

  /**
   * Load EVERY page into the store. Client-side search/filter operate over `entries`,
   * and the server cannot search ciphertext (zero-knowledge), so the client must hold
   * all entries for search to be complete — otherwise a query only matches the pages
   * already lazily loaded. Called once on unlock.
   * Defensive: stops if the cursor stops advancing, so a misbehaving server returning
   * `hasMore: true` without a fresh cursor can never loop forever.
   */
  async function fetchAll(): Promise<void> {
    await fetchEntries(true);
    while (hasMore.value) {
      const prev = cursor.value;
      await fetchEntries(false);
      if (cursor.value === prev) break;
    }
  }

  /** Fetch + decrypt a single entry (detail view), updating the cached copy if present. */
  async function fetchEntry(id: string): Promise<DecryptedEntry> {
    const { key, userId, auth } = requireUnlocked();
    const raw = await auth.apiFetch<RawVaultEntry>(`/vault/${id}`);
    const entry = await decryptRawEntry(raw, key, userId);
    const idx = entries.value.findIndex((e) => e.id === id);
    if (idx === -1) entries.value.push(entry);
    else entries.value[idx] = entry;
    return entry;
  }

  async function createEntry(draft: EntryDraft): Promise<DecryptedEntry> {
    const { key, userId, auth } = requireUnlocked();
    const entryId = globalThis.crypto.randomUUID();
    const payload = await encryptEntry(entryId, draft, key, userId);
    const raw = await auth.apiFetch<RawVaultEntry>('/vault', { method: 'POST', body: payload });
    const entry = await decryptRawEntry(raw, key, userId);
    entries.value.unshift(entry);
    return entry;
  }

  async function updateEntry(
    id: string,
    draft: EntryDraft,
    changeNote?: string,
  ): Promise<DecryptedEntry> {
    const { key, userId, auth } = requireUnlocked();
    const payload = await encryptEntryUpdate(id, draft, key, userId, changeNote);
    const raw = await auth.apiFetch<RawVaultEntry>(`/vault/${id}`, { method: 'PATCH', body: payload });
    const entry = await decryptRawEntry(raw, key, userId);
    const idx = entries.value.findIndex((e) => e.id === id);
    if (idx === -1) entries.value.unshift(entry);
    else entries.value[idx] = entry;
    return entry;
  }

  /**
   * Fetch + decrypt an entry's version history (DESC order, as the API returns it).
   * Snapshots are decrypted under the PARENT entry id `id`, never the snapshot's own id.
   * Results are returned, not stored in state.
   */
  async function listVersions(id: string): Promise<DecryptedVersion[]> {
    const { key, userId, auth } = requireUnlocked();
    const raw = await auth.apiFetch<RawVaultEntryVersion[]>(`/vault/${id}/versions`);
    return Promise.all(raw.map((v) => decryptVersion(v, key, userId, id)));
  }

  /**
   * Restore a historical version server-side (the server copies the snapshot blob to
   * current and bumps the version). Decrypts the returned current entry and refreshes
   * the cached copy.
   */
  async function restoreVersion(id: string, versionId: string): Promise<DecryptedEntry> {
    const { key, userId, auth } = requireUnlocked();
    const raw = await auth.apiFetch<RawVaultEntry>(
      `/vault/${id}/versions/${versionId}/restore`,
      { method: 'POST' },
    );
    const entry = await decryptRawEntry(raw, key, userId);
    const idx = entries.value.findIndex((e) => e.id === id);
    if (idx === -1) entries.value.unshift(entry);
    else entries.value[idx] = entry;
    return entry;
  }

  async function deleteEntry(id: string): Promise<void> {
    const { auth } = requireUnlocked();
    await auth.apiFetch(`/vault/${id}`, { method: 'DELETE' });
    entries.value = entries.value.filter((e) => e.id !== id);
  }

  async function wipeAll(): Promise<void> {
    const { auth } = requireUnlocked();
    await auth.apiFetch('/vault', { method: 'DELETE' });
    clear();
  }

  function clear(): void {
    entries.value = [];
    cursor.value = null;
    hasMore.value = false;
    loaded.value = false;
    loading.value = false;
  }

  return {
    entries,
    loading,
    cursor,
    hasMore,
    loaded,
    byId,
    fetchEntries,
    loadMore,
    fetchAll,
    fetchEntry,
    createEntry,
    updateEntry,
    deleteEntry,
    wipeAll,
    listVersions,
    restoreVersion,
    clear,
  };
});
