import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const MOCK_FILE_JSON = JSON.stringify({
  version: 1,
  exportedAt: '2026-06-12T00:00:00.000Z',
  kdfSalt: 'c2FsdA==',
  argon2: { m: 65536, t: 3, p: 1 },
  iv: 'aXY=',
  authTag: 'dGFn',
  ciphertext: 'Y2lwaGVydGV4dA==',
});

// vi.mock factory is hoisted — cannot reference top-level imports or consts.
// Use string literals for enum values inside the factory.
vi.mock('@adyton/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@adyton/shared')>();
  return {
    ...real,
    importVault: vi.fn().mockResolvedValue([
      { type: 'LOGIN', label: 'GitHub', username: 'dev', password: 'pw' },
      { type: 'SECURE_NOTE', label: 'Note', notes: 'text' },
    ]),
  };
});

const mockWipeAll = vi.fn().mockResolvedValue(undefined);
const mockCreateEntry = vi.fn().mockResolvedValue({ id: 'new-id' });

vi.mock('../../app/stores/vault', () => ({
  useVaultStore: () => ({
    wipeAll: mockWipeAll,
    createEntry: mockCreateEntry,
  }),
}));

const { useVaultImport } = await import('../../app/composables/useVaultImport');

describe('useVaultImport', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockWipeAll.mockClear();
    mockCreateEntry.mockClear();
  });

  it('starts with importing=false and zero progress', () => {
    const { importing, progress } = useVaultImport();
    expect(importing.value).toBe(false);
    expect(progress.value.current).toBe(0);
    expect(progress.value.total).toBe(0);
  });

  it('calls wipeAll then createEntry for each exported entry', async () => {
    const { wipeAndImport } = useVaultImport();
    const count = await wipeAndImport(MOCK_FILE_JSON, 'export-password');

    expect(mockWipeAll).toHaveBeenCalledOnce();
    expect(mockCreateEntry).toHaveBeenCalledTimes(2);
    expect(count).toBe(2);
  });

  it('wipeAll is called BEFORE any createEntry', async () => {
    const callOrder: string[] = [];
    mockWipeAll.mockImplementation(async () => { callOrder.push('wipe'); });
    mockCreateEntry.mockImplementation(async () => { callOrder.push('create'); return { id: 'x' }; });

    const { wipeAndImport } = useVaultImport();
    await wipeAndImport(MOCK_FILE_JSON, 'pass');

    expect(callOrder[0]).toBe('wipe');
    expect(callOrder.slice(1)).toEqual(['create', 'create']);
  });

  it('tracks progress: total set upfront, current increments per entry', async () => {
    const { wipeAndImport, progress } = useVaultImport();
    const snapshots: number[] = [];
    mockCreateEntry.mockImplementation(async () => {
      snapshots.push(progress.value.current);
      return { id: 'x' };
    });

    await wipeAndImport(MOCK_FILE_JSON, 'pass');

    expect(progress.value.total).toBe(2);
    expect(progress.value.current).toBe(2);
    // Progress increments AFTER each entry: snapshots record state BEFORE increment.
    expect(snapshots).toEqual([0, 1]);
  });

  it('resets importing=false after success', async () => {
    const { importing, wipeAndImport } = useVaultImport();
    await wipeAndImport(MOCK_FILE_JSON, 'pass');
    expect(importing.value).toBe(false);
  });

  it('resets importing=false on error and re-throws', async () => {
    const { importing, wipeAndImport } = useVaultImport();
    const { importVault } = await import('@adyton/shared');
    (importVault as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('decrypt failed'));

    await expect(wipeAndImport(MOCK_FILE_JSON, 'wrong-pass')).rejects.toThrow('decrypt failed');
    expect(importing.value).toBe(false);
  });

  it('throws on invalid JSON file content without calling wipeAll', async () => {
    const { wipeAndImport } = useVaultImport();
    await expect(wipeAndImport('not valid json at all {', 'pass')).rejects.toThrow();
    expect(mockWipeAll).not.toHaveBeenCalled();
  });
});
