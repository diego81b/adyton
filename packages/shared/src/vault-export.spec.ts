import { describe, it, expect } from 'vitest';
import { exportVault, importVault, EXPORT_FORMAT_VERSION } from './vault-export.js';
import { VaultEntryType } from './types.js';
import type { VaultExportEntry } from './vault-export.js';

const SAMPLE: VaultExportEntry[] = [
  {
    type: VaultEntryType.LOGIN,
    label: 'GitHub',
    username: 'dev@example.com',
    password: 'SuperSecret99!',
    url: 'https://github.com',
    notes: 'work account',
  },
  {
    type: VaultEntryType.SECURE_NOTE,
    label: 'Recovery seed',
    notes: 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12',
  },
  {
    type: VaultEntryType.ENV_FILE,
    environment: 'production',
    label: 'Prod .env',
    envContent: 'DB_URL=postgres://user:pass@host/db\nSECRET_KEY=abc123',
  },
  {
    type: VaultEntryType.SECRET,
    label: 'Stripe API key',
    secretKey: 'STRIPE_SECRET',
    secretValue: 'sk_live_XXXX',
  },
];

const PASSWORD = 'ExportP@ss2026!Secure';
const WRONG_PASSWORD = 'completely-wrong-pass-999';

// Argon2id derivation is slow; raise timeout for tests that run it.
const ARGON_TIMEOUT = 20_000;
const DOUBLE_ARGON_TIMEOUT = 35_000;

describe('vault-export / exportVault', () => {
  it('returns a valid VaultExportFile structure', async () => {
    const file = await exportVault(SAMPLE, PASSWORD);
    expect(file.version).toBe(EXPORT_FORMAT_VERSION);
    expect(typeof file.exportedAt).toBe('string');
    expect(file.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof file.kdfSalt).toBe('string');
    expect(file.kdfSalt.length).toBeGreaterThan(0);
    expect(file.argon2).toEqual({ m: 65536, t: 3, p: 1 });
    expect(typeof file.iv).toBe('string');
    expect(typeof file.authTag).toBe('string');
    expect(typeof file.ciphertext).toBe('string');
  }, ARGON_TIMEOUT);

  it('two exports with same password produce different salt and ciphertext', async () => {
    const a = await exportVault(SAMPLE, PASSWORD);
    const b = await exportVault(SAMPLE, PASSWORD);
    expect(a.kdfSalt).not.toBe(b.kdfSalt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  }, DOUBLE_ARGON_TIMEOUT);

  it('handles empty vault', async () => {
    const file = await exportVault([], PASSWORD);
    const restored = await importVault(file, PASSWORD);
    expect(restored).toEqual([]);
  }, DOUBLE_ARGON_TIMEOUT);
});

describe('vault-export / importVault', () => {
  it('round-trip: exported then imported entries are identical', async () => {
    const file = await exportVault(SAMPLE, PASSWORD);
    const restored = await importVault(file, PASSWORD);
    expect(restored).toEqual(SAMPLE);
  }, DOUBLE_ARGON_TIMEOUT);

  it('rejects wrong password (AES-GCM auth tag mismatch)', async () => {
    const file = await exportVault(SAMPLE, PASSWORD);
    await expect(importVault(file, WRONG_PASSWORD)).rejects.toThrow();
  }, DOUBLE_ARGON_TIMEOUT);

  it('rejects tampered ciphertext', async () => {
    const file = await exportVault(SAMPLE, PASSWORD);
    const tampered = { ...file, ciphertext: file.ciphertext.slice(0, -4) + 'AAAA' };
    await expect(importVault(tampered, PASSWORD)).rejects.toThrow();
  }, DOUBLE_ARGON_TIMEOUT);

  it('rejects tampered authTag', async () => {
    const file = await exportVault(SAMPLE, PASSWORD);
    const tampered = { ...file, authTag: file.authTag.slice(0, -4) + 'ZZZZ' };
    await expect(importVault(tampered, PASSWORD)).rejects.toThrow();
  }, DOUBLE_ARGON_TIMEOUT);

  it('rejects unsupported format version', async () => {
    const file = await exportVault(SAMPLE, PASSWORD);
    const bad = { ...file, version: 99 as never };
    await expect(importVault(bad, PASSWORD)).rejects.toThrow('Unsupported export version: 99');
  });
});
