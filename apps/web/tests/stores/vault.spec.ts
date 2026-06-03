import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { VaultEntryType } from '@adyton/shared';
import {
  encryptEntry,
  type EntryDraft,
  type RawVaultEntry,
  type RawVaultEntryVersion,
} from '../../app/utils/vault-crypto';

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

// Build a raw version snapshot whose blob is encrypted under the PARENT entry id.
async function rawVersion(
  parentId: string,
  snapshotId: string,
  draft: EntryDraft,
  version: number,
  overrides: Partial<RawVaultEntryVersion> = {},
): Promise<RawVaultEntryVersion> {
  const p = await encryptEntry(parentId, draft, key, USER_ID);
  return {
    id: snapshotId,
    version,
    encryptedData: p.encryptedData,
    iv: p.iv,
    authTag: p.authTag,
    changeNote: null,
    createdAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
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

describe('useVaultStore.fetchAll', () => {
  it('drains every page until hasMore is false', async () => {
    await unlock();
    const r1 = await rawEntry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { type: VaultEntryType.LOGIN, label: 'A' });
    const r2 = await rawEntry('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { type: VaultEntryType.LOGIN, label: 'B' });
    const r3 = await rawEntry('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { type: VaultEntryType.LOGIN, label: 'C' });
    mockFetch.mockResolvedValueOnce(okResponse({ data: [r1], nextCursor: 'c1', hasMore: true }));
    mockFetch.mockResolvedValueOnce(okResponse({ data: [r2], nextCursor: 'c2', hasMore: true }));
    mockFetch.mockResolvedValueOnce(okResponse({ data: [r3], nextCursor: null, hasMore: false }));

    const store = useVaultStore();
    await store.fetchAll();

    expect(store.entries.map((e) => e.label)).toEqual(['A', 'B', 'C']);
    expect(store.hasMore).toBe(false);
    expect(store.loaded).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // second/third requests carry the advancing cursor
    expect(mockFetch.mock.calls[1]![0]).toContain('cursor=c1');
    expect(mockFetch.mock.calls[2]![0]).toContain('cursor=c2');
  });

  it('fetches once when the first page is the only page', async () => {
    await unlock();
    const r1 = await rawEntry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { type: VaultEntryType.LOGIN, label: 'A' });
    mockFetch.mockResolvedValueOnce(okResponse({ data: [r1], nextCursor: null, hasMore: false }));

    const store = useVaultStore();
    await store.fetchAll();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(store.entries).toHaveLength(1);
  });

  it('stops if the cursor stops advancing (no infinite loop)', async () => {
    await unlock();
    const r1 = await rawEntry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { type: VaultEntryType.LOGIN, label: 'A' });
    const r2 = await rawEntry('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { type: VaultEntryType.LOGIN, label: 'B' });
    // Page 1 advances to c1; page 2 (and any further) keep returning hasMore=true with the
    // SAME cursor — the no-progress guard must break instead of looping forever.
    mockFetch.mockResolvedValueOnce(okResponse({ data: [r1], nextCursor: 'c1', hasMore: true }));
    mockFetch.mockResolvedValue(okResponse({ data: [r2], nextCursor: 'c1', hasMore: true }));

    const store = useVaultStore();
    await store.fetchAll();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(store.hasMore).toBe(true); // still "more" per server, but we stopped safely
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

    // Sentinel includes '!' — a char NOT in the base64url alphabet — so it can never
    // appear by chance in the random ciphertext (a short marker like 'pw' collides
    // ~1% of the time and made this test flaky under load).
    const secret = 'leak!sentinel!42';
    const entry = await store.createEntry({ type: VaultEntryType.LOGIN, label: 'New', password: secret });
    expect(entry.label).toBe('New');
    expect(entry.password).toBe(secret);
    expect(store.entries[0]!.id).toBe(entry.id);

    const init = mockFetch.mock.calls[0]![1];
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body);
    expect(sent.entryType).toBe('LOGIN');
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(sent)).not.toContain(secret); // secret never in plaintext on the wire
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

describe('useVaultStore.listVersions', () => {
  it('decrypts each version under the parent id, in order, without storing them', async () => {
    await unlock();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const v2 = await rawVersion(
      id,
      'v2v2v2v2-0000-4000-8000-000000000000',
      { type: VaultEntryType.LOGIN, label: 'GitHub', password: 'pw-v2' },
      2,
      { changeNote: 'rotate' },
    );
    const v1 = await rawVersion(
      id,
      'v1v1v1v1-0000-4000-8000-000000000000',
      { type: VaultEntryType.LOGIN, label: 'GitHub', password: 'pw-v1' },
      1,
    );
    // API returns DESC order.
    mockFetch.mockResolvedValueOnce(okResponse([v2, v1]));

    const store = useVaultStore();
    const versions = await store.listVersions(id);

    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]!.entry.password).toBe('pw-v2');
    expect(versions[0]!.changeNote).toBe('rotate');
    expect(versions[1]!.entry.password).toBe('pw-v1');
    expect(mockFetch.mock.calls[0]![0]).toContain(`/vault/${id}/versions`);
    // Not stored in state.
    expect(store.entries).toHaveLength(0);
  });

  it('throws when the vault is locked', async () => {
    const store = useVaultStore();
    await expect(store.listVersions('x')).rejects.toThrow('Vault is locked');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('useVaultStore.restoreVersion', () => {
  it('posts to the restore URL, decrypts the response, and replaces the cached entry', async () => {
    await unlock();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const versionId = 'v1v1v1v1-0000-4000-8000-000000000000';

    // Seed the cache with the current (newer) entry.
    const current = await rawEntry(id, { type: VaultEntryType.LOGIN, label: 'Current', password: 'new' }, 3);
    mockFetch.mockResolvedValueOnce(okResponse({ data: [current], nextCursor: null, hasMore: false }));
    const store = useVaultStore();
    await store.fetchEntries(true);
    expect(store.entries[0]!.password).toBe('new');

    // Server returns the restored current entry (bumped version, restored secret).
    const restored = await rawEntry(id, { type: VaultEntryType.LOGIN, label: 'Restored', password: 'old' }, 4);
    mockFetch.mockResolvedValueOnce(okResponse(restored));

    const entry = await store.restoreVersion(id, versionId);
    expect(entry.label).toBe('Restored');
    expect(entry.password).toBe('old');
    expect(entry.secretVersion).toBe(4);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.label).toBe('Restored');

    const call = mockFetch.mock.calls[1]!;
    expect(call[0]).toContain(`/vault/${id}/versions/${versionId}/restore`);
    expect(call[1].method).toBe('POST');
  });

  it('unshifts the entry when it is not already cached', async () => {
    await unlock();
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const versionId = 'v0v0v0v0-0000-4000-8000-000000000000';
    const restored = await rawEntry(id, { type: VaultEntryType.LOGIN, label: 'R', password: 'x' }, 2);
    mockFetch.mockResolvedValueOnce(okResponse(restored));

    const store = useVaultStore();
    const entry = await store.restoreVersion(id, versionId);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.id).toBe(entry.id);
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
