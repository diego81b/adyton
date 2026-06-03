// Vault crypto mapping layer.
//
// Bridges the wire shape (VaultEntryResponseDto / CreateVaultEntryDto from apps/api)
// and the client-side DecryptedEntry (packages/shared).
//
// PLAINTEXT BLOB SCHEMA (load-bearing — changing it requires re-encrypting every entry):
//   The single `encryptedData` blob holds a JSON object of the entry's SECRET fields
//   plus the human-readable `label`. Everything the server legitimately sees in
//   plaintext (type, version, environment tag, timestamps, labelHash) stays OUT of the
//   blob and travels as structural columns. The optional `encryptedMetadata` blob is
//   reserved (always null in V1) — the label lives in the main blob so it is always
//   recoverable without a second blob.
//
// Crypto contract (must match analysis/frontend/nuxt.md §6.3-6.4 and the API AAD):
//   - entryId generated client-side (crypto.randomUUID()) BEFORE encryption
//   - main blob AAD:  `${userId}:${entryId}`
//   - uses encryptSecret / decryptSecret from @adyton/shared
//   - labelHash = hashLabel(label) — plaintext SHA-256, server-side search/dedup hint
//   - environmentTag is a plaintext column (invariant #8), never encrypted
//
// Field renames between wire and DecryptedEntry:
//   entryType -> type, version -> secretVersion, environmentTag -> environment,
//   EncryptedBlob.ciphertext -> encryptedData

import {
  encryptSecret,
  decryptSecret,
  hashLabel,
  type DecryptedEntry,
  type EnvironmentTag,
  VaultEntryType,
} from '@adyton/shared';

// Mirrors apps/api VaultEntryResponseDto exactly (dates arrive as ISO strings over JSON).
export interface RawVaultEntry {
  id: string;
  entryType: VaultEntryType;
  encryptedData: string;
  iv: string;
  authTag: string;
  labelHash: string;
  encryptedMetadata: string | null;
  metadataIv: string | null;
  metadataAuthTag: string | null;
  environmentTag: EnvironmentTag | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Payload sent to POST /vault (mirrors CreateVaultEntryDto).
export interface CreateEntryPayload {
  id: string;
  entryType: VaultEntryType;
  encryptedData: string;
  iv: string;
  authTag: string;
  labelHash: string;
  environmentTag?: EnvironmentTag;
}

// Payload sent to PATCH /vault/:id (mirrors UpdateVaultEntryDto).
export interface UpdateEntryPayload {
  encryptedData: string;
  iv: string;
  authTag: string;
  labelHash: string;
  environmentTag?: EnvironmentTag | null;
  changeNote?: string;
}

// Fields carried as structural columns, NOT inside the encrypted blob.
// Everything else on DecryptedEntry is secret and gets encrypted.
const STRUCTURAL_KEYS = new Set<keyof DecryptedEntry>([
  'id',
  'type',
  'updatedAt',
  'secretVersion',
  'environment',
  'envParsed', // derived client-side, never persisted
]);

export type EntryDraft = Omit<DecryptedEntry, 'id' | 'updatedAt' | 'secretVersion' | 'envParsed'>;

function buildBlobPayload(draft: EntryDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (STRUCTURAL_KEYS.has(key as keyof DecryptedEntry)) continue;
    if (value === undefined || value === null) continue;
    payload[key] = value;
  }
  return payload;
}

/**
 * Parse raw `.env` text into key=value pairs. Client-side only — the server never
 * sees individual variables. Ignores blank lines and `#` comments; strips an optional
 * surrounding pair of single or double quotes from the value; keeps `=` inside values.
 */
export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === '') continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(".*"|'.*')$/.test(value)) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Encrypt a new entry. Generates no id — the caller passes the client-generated
 * `entryId` so it is bound into the AAD before encryption.
 */
export async function encryptEntry(
  entryId: string,
  draft: EntryDraft,
  key: CryptoKey,
  userId: string,
): Promise<CreateEntryPayload> {
  const blob = await encryptSecret(
    key,
    JSON.stringify(buildBlobPayload(draft)),
    `${userId}:${entryId}`,
  );
  const payload: CreateEntryPayload = {
    id: entryId,
    entryType: draft.type,
    encryptedData: blob.ciphertext,
    iv: blob.iv,
    authTag: blob.authTag,
    labelHash: await hashLabel(draft.label),
  };
  if (draft.environment) payload.environmentTag = draft.environment;
  return payload;
}

/**
 * Encrypt an updated entry for PATCH. Re-uses the existing entryId in the AAD.
 */
export async function encryptEntryUpdate(
  entryId: string,
  draft: EntryDraft,
  key: CryptoKey,
  userId: string,
  changeNote?: string,
): Promise<UpdateEntryPayload> {
  const blob = await encryptSecret(
    key,
    JSON.stringify(buildBlobPayload(draft)),
    `${userId}:${entryId}`,
  );
  const payload: UpdateEntryPayload = {
    encryptedData: blob.ciphertext,
    iv: blob.iv,
    authTag: blob.authTag,
    labelHash: await hashLabel(draft.label),
    environmentTag: draft.environment ?? null,
  };
  if (changeNote) payload.changeNote = changeNote;
  return payload;
}

/**
 * Decrypt a wire entry into a DecryptedEntry. Throws if the AAD or auth tag fail
 * (tampered blob, wrong key, or wrong userId) — Web Crypto rejects the decrypt.
 */
export async function decryptRawEntry(
  raw: RawVaultEntry,
  key: CryptoKey,
  userId: string,
): Promise<DecryptedEntry> {
  const json = await decryptSecret(
    key,
    { ciphertext: raw.encryptedData, iv: raw.iv, authTag: raw.authTag },
    `${userId}:${raw.id}`,
  );
  const fields = JSON.parse(json) as Record<string, unknown>;

  const entry: DecryptedEntry = {
    ...fields,
    id: raw.id,
    type: raw.entryType,
    label: (fields.label as string) ?? '',
    updatedAt: new Date(raw.updatedAt),
    secretVersion: raw.version,
  };
  if (raw.environmentTag) entry.environment = raw.environmentTag;
  if (entry.type === VaultEntryType.ENV_FILE && typeof entry.envContent === 'string') {
    entry.envParsed = parseEnv(entry.envContent);
  }
  return entry;
}
