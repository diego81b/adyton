import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { VaultEntryType } from '@adyton/shared';
import type { DecryptedEntry } from '@adyton/shared';

// Mock @adyton/shared before importing anything that depends on it.
vi.mock('@adyton/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@adyton/shared')>();
  return {
    ...real,
    exportVault: vi.fn().mockResolvedValue({
      version: 1,
      exportedAt: '2026-06-12T00:00:00.000Z',
      kdfSalt: 'c2FsdA==',
      argon2: { m: 65536, t: 3, p: 1 },
      iv: 'aXY=',
      authTag: 'dGFn',
      ciphertext: 'Y2lwaGVydGV4dA==',
    }),
  };
});

// Stub the static URL methods used in downloadExport (not the constructor).
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:fake');
const mockRevokeObjectURL = vi.fn();
URL.createObjectURL = mockCreateObjectURL;
URL.revokeObjectURL = mockRevokeObjectURL;

// Stub document.createElement to capture the anchor click.
const mockClick = vi.fn();
const mockAnchor = { href: '', download: '', click: mockClick };
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  if (tag === 'a') return mockAnchor as unknown as HTMLElement;
  return document.createElement(tag);
});

const { useVaultExport } = await import('../../app/composables/useVaultExport');
const { useVaultStore } = await import('../../app/stores/vault');

const SAMPLE_ENTRY: DecryptedEntry = {
  id: 'aaa',
  type: VaultEntryType.LOGIN,
  label: 'GitHub',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  secretVersion: 1,
  username: 'dev@example.com',
  password: 'secret',
};

describe('useVaultExport', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockClick.mockClear();
    mockCreateObjectURL.mockClear();
    mockRevokeObjectURL.mockClear();
  });

  it('starts with exporting=false', () => {
    const { exporting } = useVaultExport();
    expect(exporting.value).toBe(false);
  });

  it('downloadExport calls exportVault with structural fields stripped', async () => {
    const vault = useVaultStore();
    (vault.entries as unknown as DecryptedEntry[]).push(SAMPLE_ENTRY);

    const { downloadExport } = useVaultExport();
    await downloadExport('my-export-password');

    const { exportVault } = await import('@adyton/shared');
    expect(exportVault).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: VaultEntryType.LOGIN, label: 'GitHub', username: 'dev@example.com' }),
      ]),
      'my-export-password',
    );

    // Structural fields must NOT be in the export blob.
    const exportedEntries = (exportVault as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(exportedEntries[0]).not.toHaveProperty('id');
    expect(exportedEntries[0]).not.toHaveProperty('createdAt');
    expect(exportedEntries[0]).not.toHaveProperty('secretVersion');
    expect(exportedEntries[0]).not.toHaveProperty('envParsed');
  });

  it('triggers a download with a .adyton filename', async () => {
    const vault = useVaultStore();
    (vault.entries as unknown as DecryptedEntry[]).push(SAMPLE_ENTRY);

    const { downloadExport } = useVaultExport();
    await downloadExport('pass');

    const today = new Date().toISOString().slice(0, 10);
    expect(mockAnchor.download).toBe(`adyton-export-${today}.adyton`);
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('sets exporting=false after completion', async () => {
    const { exporting, downloadExport } = useVaultExport();
    await downloadExport('pass');
    expect(exporting.value).toBe(false);
  });
});
