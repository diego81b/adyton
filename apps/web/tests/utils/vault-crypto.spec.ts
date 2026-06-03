import { describe, it, expect, beforeAll } from 'vitest';
import { VaultEntryType } from '@adyton/shared';
import {
  encryptEntry,
  encryptEntryUpdate,
  decryptRawEntry,
  decryptVersion,
  parseEnv,
  type EntryDraft,
  type RawVaultEntry,
  type RawVaultEntryVersion,
} from '../../app/utils/vault-crypto';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

async function makeKey(seed = 1): Promise<CryptoKey> {
  const bytes = new Uint8Array(32).fill(seed);
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Reassemble a RawVaultEntry as the API would return it from a create payload.
function rawFromCreate(
  payload: Awaited<ReturnType<typeof encryptEntry>>,
  overrides: Partial<RawVaultEntry> = {},
): RawVaultEntry {
  return {
    id: payload.id,
    entryType: payload.entryType,
    encryptedData: payload.encryptedData,
    iv: payload.iv,
    authTag: payload.authTag,
    labelHash: payload.labelHash,
    encryptedMetadata: null,
    metadataIv: null,
    metadataAuthTag: null,
    environmentTag: payload.environmentTag ?? null,
    version: 1,
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    ...overrides,
  };
}

let key: CryptoKey;
beforeAll(async () => {
  key = await makeKey(1);
});

describe('parseEnv', () => {
  it('parses key=value lines', () => {
    expect(parseEnv('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('ignores blank lines and comments', () => {
    expect(parseEnv('\n# comment\nFOO=bar\n   \n')).toEqual({ FOO: 'bar' });
  });

  it('keeps "=" inside the value', () => {
    expect(parseEnv('URL=postgres://u:p@h:5432/db?x=1')).toEqual({
      URL: 'postgres://u:p@h:5432/db?x=1',
    });
  });

  it('strips surrounding single or double quotes', () => {
    expect(parseEnv('A="quoted"\nB=\'single\'')).toEqual({ A: 'quoted', B: 'single' });
  });

  it('skips malformed lines without "=" and empty keys', () => {
    expect(parseEnv('NOEQUALS\n=novalue\nGOOD=1')).toEqual({ GOOD: '1' });
  });

  it('returns empty object for empty input', () => {
    expect(parseEnv('')).toEqual({});
  });
});

describe('encryptEntry / decryptRawEntry round-trip', () => {
  it('round-trips a LOGIN entry with all fields', async () => {
    const draft: EntryDraft = {
      type: VaultEntryType.LOGIN,
      label: 'GitHub',
      username: 'octocat',
      password: 's3cr3t',
      url: 'https://github.com',
      notes: 'work account',
    };
    const payload = await encryptEntry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', draft, key, USER_ID);
    const entry = await decryptRawEntry(rawFromCreate(payload), key, USER_ID);

    expect(entry.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(entry.type).toBe(VaultEntryType.LOGIN);
    expect(entry.label).toBe('GitHub');
    expect(entry.username).toBe('octocat');
    expect(entry.password).toBe('s3cr3t');
    expect(entry.url).toBe('https://github.com');
    expect(entry.notes).toBe('work account');
    expect(entry.secretVersion).toBe(1);
    expect(entry.updatedAt).toBeInstanceOf(Date);
  });

  it('does not leak secret fields into structural columns (blob holds them)', async () => {
    const draft: EntryDraft = { type: VaultEntryType.LOGIN, label: 'X', password: 'p' };
    const payload = await encryptEntry('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', draft, key, USER_ID);
    // The wire payload exposes only structural fields — no plaintext label/password.
    expect(JSON.stringify(payload)).not.toContain('password');
    expect(JSON.stringify(payload)).not.toContain('"X"');
  });

  it('derives envParsed for ENV_FILE entries on decrypt', async () => {
    const draft: EntryDraft = {
      type: VaultEntryType.ENV_FILE,
      label: 'prod.env',
      environment: 'production',
      envContent: 'DATABASE_URL=postgres://x\nREDIS_URL=redis://y',
    };
    const payload = await encryptEntry('cccccccc-cccc-4ccc-8ccc-cccccccccccc', draft, key, USER_ID);
    expect(payload.environmentTag).toBe('production');
    const entry = await decryptRawEntry(rawFromCreate(payload), key, USER_ID);
    expect(entry.environment).toBe('production');
    expect(entry.envParsed).toEqual({
      DATABASE_URL: 'postgres://x',
      REDIS_URL: 'redis://y',
    });
  });

  it('omits environmentTag when no environment is set', async () => {
    const draft: EntryDraft = { type: VaultEntryType.SECURE_NOTE, label: 'note', notes: 'hi' };
    const payload = await encryptEntry('dddddddd-dddd-4ddd-8ddd-dddddddddddd', draft, key, USER_ID);
    expect(payload.environmentTag).toBeUndefined();
    const entry = await decryptRawEntry(rawFromCreate(payload), key, USER_ID);
    expect(entry.environment).toBeUndefined();
  });

  it('computes a 64-char hex labelHash', async () => {
    const draft: EntryDraft = { type: VaultEntryType.LOGIN, label: 'GitHub' };
    const payload = await encryptEntry('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', draft, key, USER_ID);
    expect(payload.labelHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AAD / tamper rejection', () => {
  it('rejects decryption with a wrong userId (AAD mismatch)', async () => {
    const draft: EntryDraft = { type: VaultEntryType.LOGIN, label: 'X', password: 'p' };
    const payload = await encryptEntry('ffffffff-ffff-4fff-8fff-ffffffffffff', draft, key, USER_ID);
    await expect(decryptRawEntry(rawFromCreate(payload), key, OTHER_USER)).rejects.toThrow();
  });

  it('rejects decryption with a wrong entryId (AAD mismatch)', async () => {
    const draft: EntryDraft = { type: VaultEntryType.LOGIN, label: 'X', password: 'p' };
    const payload = await encryptEntry('aaaaaaaa-0000-4000-8000-000000000000', draft, key, USER_ID);
    const tampered = rawFromCreate(payload, { id: 'bbbbbbbb-0000-4000-8000-000000000000' });
    await expect(decryptRawEntry(tampered, key, USER_ID)).rejects.toThrow();
  });

  it('rejects decryption with a wrong key', async () => {
    const draft: EntryDraft = { type: VaultEntryType.LOGIN, label: 'X', password: 'p' };
    const payload = await encryptEntry('a1a1a1a1-0000-4000-8000-000000000000', draft, key, USER_ID);
    const wrongKey = await makeKey(9);
    await expect(decryptRawEntry(rawFromCreate(payload), wrongKey, USER_ID)).rejects.toThrow();
  });

  it('rejects a tampered ciphertext (auth tag failure)', async () => {
    const draft: EntryDraft = { type: VaultEntryType.LOGIN, label: 'X', password: 'p' };
    const payload = await encryptEntry('a2a2a2a2-0000-4000-8000-000000000000', draft, key, USER_ID);
    const flipped = payload.encryptedData.slice(0, -2) + (payload.encryptedData.endsWith('A') ? 'B' : 'A');
    await expect(
      decryptRawEntry(rawFromCreate(payload, { encryptedData: flipped }), key, USER_ID),
    ).rejects.toThrow();
  });
});

describe('decryptVersion', () => {
  const PARENT_ID = 'c0c0c0c0-0000-4000-8000-000000000000';
  const SNAPSHOT_ID = '5na95607-0000-4000-8000-000000000000';

  // A version snapshot is a byte-copy of the parent entry's blob (encrypted under the
  // PARENT id), wearing its own snapshot UUID and version metadata.
  async function makeVersion(
    draft: EntryDraft,
    overrides: Partial<RawVaultEntryVersion> = {},
  ): Promise<RawVaultEntryVersion> {
    const blob = await encryptEntry(PARENT_ID, draft, key, USER_ID);
    return {
      id: SNAPSHOT_ID,
      version: 3,
      encryptedData: blob.encryptedData,
      iv: blob.iv,
      authTag: blob.authTag,
      changeNote: 'snapshot before rotation',
      createdAt: '2026-06-02T12:00:00.000Z',
      ...overrides,
    };
  }

  it('round-trips a snapshot decrypted under the parent entry id', async () => {
    const draft: EntryDraft = {
      type: VaultEntryType.LOGIN,
      label: 'GitHub',
      username: 'octocat',
      password: 'old-pw',
    };
    const raw = await makeVersion(draft);
    const v = await decryptVersion(raw, key, USER_ID, PARENT_ID);

    expect(v.id).toBe(SNAPSHOT_ID);
    expect(v.version).toBe(3);
    expect(v.changeNote).toBe('snapshot before rotation');
    expect(v.createdAt).toBeInstanceOf(Date);
    expect(v.entry.label).toBe('GitHub');
    expect(v.entry.username).toBe('octocat');
    expect(v.entry.password).toBe('old-pw');
  });

  it('preserves a null changeNote', async () => {
    const raw = await makeVersion(
      { type: VaultEntryType.SECRET, label: 'X', secretValue: 'v' },
      { changeNote: null },
    );
    const v = await decryptVersion(raw, key, USER_ID, PARENT_ID);
    expect(v.changeNote).toBeNull();
    expect(v.entry.secretValue).toBe('v');
  });

  it('REJECTS when the snapshot id is used as the AAD entryId instead of the parent id', async () => {
    const raw = await makeVersion({ type: VaultEntryType.LOGIN, label: 'X', password: 'p' });
    // The version row's own id must NEVER be used in the AAD — doing so fails the decrypt.
    await expect(decryptVersion(raw, key, USER_ID, raw.id)).rejects.toThrow();
  });

  it('rejects with a wrong userId (AAD mismatch)', async () => {
    const raw = await makeVersion({ type: VaultEntryType.LOGIN, label: 'X', password: 'p' });
    await expect(decryptVersion(raw, key, OTHER_USER, PARENT_ID)).rejects.toThrow();
  });
});

describe('encryptEntryUpdate', () => {
  it('round-trips an update and binds the same entryId in AAD', async () => {
    const id = 'a3a3a3a3-0000-4000-8000-000000000000';
    const draft: EntryDraft = {
      type: VaultEntryType.SECRET,
      label: 'Stripe',
      secretKey: 'STRIPE_KEY',
      secretValue: 'sk_live_123',
      environment: 'production',
    };
    const payload = await encryptEntryUpdate(id, draft, key, USER_ID, 'rotate key');
    expect(payload.changeNote).toBe('rotate key');
    expect(payload.environmentTag).toBe('production');

    const raw = rawFromCreate(
      { id, entryType: draft.type, ...payload, environmentTag: 'production' } as never,
      { version: 2 },
    );
    const entry = await decryptRawEntry(raw, key, USER_ID);
    expect(entry.secretKey).toBe('STRIPE_KEY');
    expect(entry.secretValue).toBe('sk_live_123');
    expect(entry.secretVersion).toBe(2);
  });

  it('sets environmentTag to null when environment is cleared, omits changeNote when absent', async () => {
    const id = 'a4a4a4a4-0000-4000-8000-000000000000';
    const draft: EntryDraft = { type: VaultEntryType.SECRET, label: 'X', secretValue: 'v' };
    const payload = await encryptEntryUpdate(id, draft, key, USER_ID);
    expect(payload.environmentTag).toBeNull();
    expect(payload.changeNote).toBeUndefined();
  });
});
