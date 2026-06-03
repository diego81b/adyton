import { describe, it, expect } from 'vitest';
import { VaultEntryType, type DecryptedEntry } from '@adyton/shared';
import {
  TYPE_META,
  TYPE_FILTERS,
  maskValue,
  entrySubtitle,
  searchHaystack,
  chipClass,
} from '../../app/utils/entry-display';

function entry(partial: Partial<DecryptedEntry> & { type: VaultEntryType }): DecryptedEntry {
  return {
    id: 'id',
    label: 'Label',
    updatedAt: new Date('2026-06-03'),
    secretVersion: 1,
    ...partial,
  };
}

describe('TYPE_META / TYPE_FILTERS', () => {
  it('has metadata for every entry type', () => {
    for (const t of Object.values(VaultEntryType)) {
      expect(TYPE_META[t]).toBeDefined();
      expect(TYPE_META[t].icon).toMatch(/^i-lucide-/);
    }
  });

  it('lists all six types as filters', () => {
    expect(TYPE_FILTERS).toHaveLength(6);
  });
});

describe('chipClass', () => {
  it('returns a per-type color when active', () => {
    expect(chipClass('all', true)).toContain('emerald');
    expect(chipClass(VaultEntryType.LOGIN, true)).toContain('blue');
    expect(chipClass(VaultEntryType.ENV_FILE, true)).toContain('orange');
  });
  it('returns the shared muted style when inactive', () => {
    const inactive = chipClass(VaultEntryType.LOGIN, false);
    expect(inactive).toContain('text-muted');
    expect(inactive).not.toContain('blue');
  });
});

describe('maskValue', () => {
  it('reveals the last 4 chars by default', () => {
    expect(maskValue('sk_live_1234')).toBe('••••••••1234');
  });
  it('fully masks short values', () => {
    expect(maskValue('abc')).toBe('•••');
  });
  it('returns empty for empty input', () => {
    expect(maskValue('')).toBe('');
  });
  it('caps the mask run length', () => {
    const masked = maskValue('a'.repeat(50));
    expect(masked.startsWith('••••••••••••')).toBe(true);
    expect(masked.endsWith('aaaa')).toBe(true);
  });
});

describe('entrySubtitle', () => {
  it('LOGIN shows username, falling back to url', () => {
    expect(entrySubtitle(entry({ type: VaultEntryType.LOGIN, username: 'octo' }))).toBe('octo');
    expect(entrySubtitle(entry({ type: VaultEntryType.LOGIN, url: 'https://x' }))).toBe('https://x');
  });
  it('ENV_FILE shows key count', () => {
    expect(
      entrySubtitle(entry({ type: VaultEntryType.ENV_FILE, envParsed: { A: '1', B: '2' } })),
    ).toBe('2 keys');
    expect(entrySubtitle(entry({ type: VaultEntryType.ENV_FILE, envParsed: { A: '1' } }))).toBe('1 key');
    expect(entrySubtitle(entry({ type: VaultEntryType.ENV_FILE }))).toBe('ENV file');
  });
  it('SECRET masks the value, else shows the key', () => {
    expect(entrySubtitle(entry({ type: VaultEntryType.SECRET, secretValue: 'sk_live_1234' }))).toBe(
      '••••••••1234',
    );
    expect(entrySubtitle(entry({ type: VaultEntryType.SECRET, secretKey: 'KEY' }))).toBe('KEY');
  });
  it('CREDIT_CARD shows last 4', () => {
    expect(entrySubtitle(entry({ type: VaultEntryType.CREDIT_CARD, cardNumber: '4111111111114242' }))).toBe(
      '•••• 4242',
    );
  });
  it('IDENTITY shows full name', () => {
    expect(
      entrySubtitle(entry({ type: VaultEntryType.IDENTITY, firstName: 'Mario', lastName: 'Rossi' })),
    ).toBe('Mario Rossi');
  });
  it('SECURE_NOTE has no subtitle', () => {
    expect(entrySubtitle(entry({ type: VaultEntryType.SECURE_NOTE }))).toBe('');
  });
});

describe('searchHaystack', () => {
  it('lowercases and concatenates searchable fields', () => {
    const h = searchHaystack(entry({ type: VaultEntryType.LOGIN, label: 'GitHub', username: 'Octo' }));
    expect(h).toContain('github');
    expect(h).toContain('octo');
  });
  it('omits empty fields', () => {
    expect(searchHaystack(entry({ type: VaultEntryType.SECURE_NOTE, label: 'Note' }))).toBe('note');
  });
});
