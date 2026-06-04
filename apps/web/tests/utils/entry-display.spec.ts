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
  it('CREDIT_CARD shows brand + last 4', () => {
    expect(entrySubtitle(entry({ type: VaultEntryType.CREDIT_CARD, cardNumber: '4111111111114242' }))).toBe(
      'Visa •••• 4242',
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

describe('cardBrand', () => {
  it.each([
    ['4242424242424242', 'Visa'],
    ['5555555555554444', 'Mastercard'],
    ['2221000000000009', 'Mastercard'],
    ['378282246310005', 'Amex'],
    ['6011111111111117', 'Discover'],
  ])('detects %s as %s', async (num, label) => {
    const { cardBrand } = await import('../../app/utils/entry-display');
    expect(cardBrand(num)?.label).toBe(label);
  });

  it('returns null for unknown prefixes, short input, and undefined', async () => {
    const { cardBrand } = await import('../../app/utils/entry-display');
    expect(cardBrand('9999999999999999')).toBeNull();
    expect(cardBrand('4')).toBeNull();
    expect(cardBrand(undefined)).toBeNull();
  });

  it('ignores spaces in the number', async () => {
    const { cardBrand } = await import('../../app/utils/entry-display');
    expect(cardBrand('4242 4242 4242 4242')?.id).toBe('visa');
  });
});

describe('entrySubtitle — card brand', () => {
  it('prefixes the masked number with the detected brand', async () => {
    const { entrySubtitle } = await import('../../app/utils/entry-display');
    const { VaultEntryType: T } = await import('@adyton/shared');
    const base = { id: 'c1', label: 'Card', createdAt: new Date(), updatedAt: new Date(), secretVersion: 1 };
    expect(entrySubtitle({ ...base, type: T.CREDIT_CARD, cardNumber: '4242 4242 4242 4242' })).toBe('Visa •••• 4242');
    expect(entrySubtitle({ ...base, type: T.CREDIT_CARD, cardNumber: '9999000011112222' })).toBe('•••• 2222');
  });
});

describe('entrySubtitle — JSON env file', () => {
  it('labels JSON env files instead of counting bogus parsed keys', async () => {
    const { entrySubtitle } = await import('../../app/utils/entry-display');
    const { VaultEntryType: T } = await import('@adyton/shared');
    const base = { id: 'j1', label: 'appsettings', createdAt: new Date(), updatedAt: new Date(), secretVersion: 1 };
    expect(
      entrySubtitle({
        ...base,
        type: T.ENV_FILE,
        envContent: '{"Db":"Server=x;Password=y"}',
        envParsed: { '{"Db":"Server': 'x;Password=y"}' }, // what parseEnv extracts from JSON
      }),
    ).toBe('JSON file');
  });
});
