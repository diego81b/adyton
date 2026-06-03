import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { VaultEntryType } from '@adyton/shared';
import { encryptEntry, type EntryDraft, type RawVaultEntry } from '../../app/utils/vault-crypto';

;(globalThis as Record<string, unknown>).__TEST_API_BASE__ = 'http://test-api';
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('useRuntimeConfig', undefined);

const { useVaultStore } = await import('../../app/stores/vault');
const { useAuthStore } = await import('../../app/stores/auth');
const { useCryptoStore } = await import('../../app/stores/crypto');

const USER_ID = '11111111-1111-4111-8111-111111111111';

function okResponse(body: unknown, status = 200) {
  return { ok: true, status, json: () => Promise.resolve(body) };
}
function errorResponse(status: number, message: string) {
  return { ok: false, status, statusText: message, json: () => Promise.resolve({ message }) };
}

async function makeKey(): Promise<CryptoKey> {
  const bytes = new Uint8Array(32).fill(7);
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

let key: CryptoKey;

async function rawEntry(id: string, draft: EntryDraft, version = 1): Promise<RawVaultEntry> {
  const p = await encryptEntry(id, draft, key, USER_ID);
  return {
    id: p.id,
    entryType: p.entryType,
    encryptedData: p.encryptedData,
    iv: p.iv,
    authTag: p.authTag,
    labelHash: p.labelHash,
    encryptedMetadata: null,
    metadataIv: null,
    metadataAuthTag: null,
    environmentTag: p.environmentTag ?? null,
    version,
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
  };
}

async function unlock() {
  key = await makeKey();
  const auth = useAuthStore();
  auth.user = { id: USER_ID, email: 'a@b.com', kdfSalt: 'a'.repeat(64), totpEnabled: false };
  auth.accessToken = 'token';
  const cryptoStore = useCryptoStore();
  cryptoStore.cryptoKey = key;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('useVaultStore — lock guard', () => {
  it('throws when the vault is locked', async () => {
    const store = useVaultStore();
    await expect(store.fetchEntries()).rejects.toThrow('Vault is locked');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('useVaultStore.fetchEntries', () => {
  it('decrypts a page and stores entries', async () => {
    await unlock();
    const raw = await rawEntry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      type: VaultEntryType.LOGIN,
      label: 'GitHub',
      password: 'p',
    });
    mockFetch.mockResolvedValueOnce(okResponse({ data: [raw], nextCursor: null, hasMore: false }));

    const store = useVaultStore();
    await store.fetchEntries(true);

    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.label).toBe('GitHub');
    expect(store.entries[0]!.password).toBe('p');
    expect(store.loaded).toBe(true);
    expect(store.hasMore).toBe(false);
    expect(mockFetch.mock.calls[0]![0]).toContain('/vault?limit=50');
  });

  it('appends the next page and sends the cursor', async () => {
    await unlock();
    const r1 = await rawEntry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { type: VaultEntryType.LOGIN, label: 'A' });
    const r2 = await rawEntry('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { type: VaultEntryType.LOGIN, label: 'B' });
    mockFetch.mockResolvedValueOnce(okResponse({ data: [r1], nextCursor: 'cur1', hasMore: true }));
    mockFetch.mockResolvedValueOnce(okResponse({ data: [r2], nextCursor: null, hasMore: false }));

    const store = useVaultStore();
    await store.fetchEntries(true);
    await store.loadMore();

    expect(store.entries.map((e) => e.label)).toEqual(['A', 'B']);
    expect(mockFetch.mock.calls[1]![0]).toContain('cursor=cur1');
  });

  it('does not fetch more when no further pages exist', async () => {
    await unlock();
    mockFetch.mockResolvedValueOnce(okResponse({ data: [], nextCursor: null, hasMore: false }));
    const store = useVaultStore();
    await store.fetchEntries(true);
    await store.loadMore();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('useVaultStore.createEntry', () => {
  it('encrypts, posts, and prepends the new entry', async () => {
    await unlock();
    const store = useVaultStore();
    // Server echoes back what it received as a stored entry; capture the POST body.
    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(init.body);
      return okResponse({
        ...body,
        encryptedMetadata: null,
        metadataIv: null,
        metadataAuthTag: null,
        environmentTag: body.environmentTag ?? null,
        version: 1,
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
      }, 201);
    });

    const entry = await store.createEntry({ type: VaultEntryType.LOGIN, label: 'New', password: 'pw' });
    expect(entry.label).toBe('New');
    expect(entry.password).toBe('pw');
    expect(store.entries[0]!.id).toBe(entry.id);

    const init = mockFetch.mock.calls[0]![1];
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body);
    expect(sent.entryType).toBe('LOGIN');
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(sent)).not.toContain('pw'); // secret never in plaintext on the wire
  });
});

describe('useVaultStore.updateEntry', () => {
  it('patches and replaces the cached entry', async () => {
    await unlock();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const raw = await rawEntry(id, { type: VaultEntryType.LOGIN, label: 'Old' });
    mockFetch.mockResolvedValueOnce(okResponse({ data: [raw], nextCursor: null, hasMore: false }));
    const store = useVaultStore();
    await store.fetchEntries(true);

    mockFetch.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(init.body);
      return okResponse({
        id,
        entryType: 'LOGIN',
        encryptedData: body.encryptedData,
        iv: body.iv,
        authTag: body.authTag,
        labelHash: body.labelHash,
        encryptedMetadata: null,
        metadataIv: null,
        metadataAuthTag: null,
        environmentTag: body.environmentTag ?? null,
        version: 2,
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T01:00:00.000Z',
      });
    });

    const updated = await store.updateEntry(id, { type: VaultEntryType.LOGIN, label: 'New', password: 'x' }, 'note');
    expect(updated.label).toBe('New');
    expect(updated.secretVersion).toBe(2);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.label).toBe('New');
    expect(mockFetch.mock.calls[1]![1].method).toBe('PATCH');
  });
});

describe('useVaultStore.deleteEntry', () => {
  it('removes the entry from cache on 204', async () => {
    await unlock();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const raw = await rawEntry(id, { type: VaultEntryType.LOGIN, label: 'Doomed' });
    mockFetch.mockResolvedValueOnce(okResponse({ data: [raw], nextCursor: null, hasMore: false }));
    const store = useVaultStore();
    await store.fetchEntries(true);
    expect(store.entries).toHaveLength(1);

    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(undefined) });
    await store.deleteEntry(id);
    expect(store.entries).toHaveLength(0);
    expect(mockFetch.mock.calls[1]![1].method).toBe('DELETE');
  });
});

describe('useVaultStore.fetchEntry', () => {
  it('fetches a single entry and caches it', async () => {
    await unlock();
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const raw = await rawEntry(id, { type: VaultEntryType.SECRET, label: 'API', secretValue: 'v' });
    mockFetch.mockResolvedValueOnce(okResponse(raw));
    const store = useVaultStore();
    const entry = await store.fetchEntry(id);
    expect(entry.secretValue).toBe('v');
    expect(store.byId(id)?.label).toBe('API');
  });
});

describe('useVaultStore.clear', () => {
  it('resets all state', async () => {
    await unlock();
    const raw = await rawEntry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { type: VaultEntryType.LOGIN, label: 'A' });
    mockFetch.mockResolvedValueOnce(okResponse({ data: [raw], nextCursor: 'c', hasMore: true }));
    const store = useVaultStore();
    await store.fetchEntries(true);
    store.clear();
    expect(store.entries).toHaveLength(0);
    expect(store.cursor).toBeNull();
    expect(store.hasMore).toBe(false);
    expect(store.loaded).toBe(false);
  });
});

describe('useVaultStore — error propagation', () => {
  it('propagates API errors and resets loading', async () => {
    await unlock();
    mockFetch.mockResolvedValueOnce(errorResponse(500, 'boom'));
    const store = useVaultStore();
    await expect(store.fetchEntries(true)).rejects.toThrow();
    expect(store.loading).toBe(false);
  });
});
