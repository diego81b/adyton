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

// Mirrors apps/api VaultEntryVersionResponseDto (a historical snapshot of an entry).
// The snapshot blob is a byte-copy of the parent entry's main blob, so it decrypts
// under the PARENT entry id — the version row's own `id` is NEVER used in the AAD.
export interface RawVaultEntryVersion {
  id: string;
  version: number;
  encryptedData: string;
  iv: string;
  authTag: string;
  changeNote: string | null;
  createdAt: string;
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
  'createdAt',
  'updatedAt',
  'secretVersion',
  'environment',
  'envParsed', // derived client-side, never persisted
]);

export type EntryDraft = Omit<
  DecryptedEntry,
  'id' | 'createdAt' | 'updatedAt' | 'secretVersion' | 'envParsed'
>;

function buildBlobPayload(draft: EntryDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (STRUCTURAL_KEYS.has(key as keyof DecryptedEntry)) continue;
    if (value === undefined || value === null) continue;
    payload[key] = value;
  }
  return payload;
}

// ENV_FILE content is an opaque encrypted string by design (invariant #8), so it can
// hold any text format. The detail view adapts: dotenv → key/value table, JSON
// (.NET appsettings.json etc.) → raw viewer. Detection is intentionally cheap.
export function detectEnvFormat(content: string): 'dotenv' | 'json' {
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'dotenv';
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
 * Decrypt a main blob and JSON-parse its secret fields. Shared by entry and version
 * decryption — both store the same blob shape under the same AAD `${userId}:${entryId}`.
 * Throws if the AAD or auth tag fail (Web Crypto rejects the decrypt).
 */
async function decryptBlobFields(
  blob: { ciphertext: string; iv: string; authTag: string },
  key: CryptoKey,
  userId: string,
  entryId: string,
): Promise<Record<string, unknown>> {
  const json = await decryptSecret(key, blob, `${userId}:${entryId}`);
  return JSON.parse(json) as Record<string, unknown>;
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
  const fields = await decryptBlobFields(
    { ciphertext: raw.encryptedData, iv: raw.iv, authTag: raw.authTag },
    key,
    userId,
    raw.id,
  );

  const entry: DecryptedEntry = {
    ...fields,
    id: raw.id,
    type: raw.entryType,
    label: (fields.label as string) ?? '',
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    secretVersion: raw.version,
  };
  if (raw.environmentTag) entry.environment = raw.environmentTag;
  if (entry.type === VaultEntryType.ENV_FILE && typeof entry.envContent === 'string') {
    entry.envParsed = parseEnv(entry.envContent);
  }
  return entry;
}

// A decrypted historical snapshot. `entry` carries the recovered secret fields of the
// snapshot; version metadata (number, note, timestamp) lives alongside it.
export interface DecryptedVersion {
  id: string;
  version: number;
  changeNote: string | null;
  createdAt: Date;
  entry: DecryptedFields;
}

// The recoverable contents of a snapshot blob (label + secret fields). Excludes the
// structural columns that a version row does not carry (type/environment/timestamps).
export type DecryptedFields = { label: string } & Record<string, unknown>;

/**
 * Decrypt a version snapshot. The blob is encrypted under the PARENT entry id, so the
 * caller MUST pass `entryId` (the parent vault entry id), NOT `raw.id` (the snapshot
 * UUID). Using the snapshot id in the AAD makes Web Crypto reject the decrypt.
 */
export async function decryptVersion(
  raw: RawVaultEntryVersion,
  key: CryptoKey,
  userId: string,
  entryId: string,
): Promise<DecryptedVersion> {
  const fields = await decryptBlobFields(
    { ciphertext: raw.encryptedData, iv: raw.iv, authTag: raw.authTag },
    key,
    userId,
    entryId,
  );
  return {
    id: raw.id,
    version: raw.version,
    changeNote: raw.changeNote,
    createdAt: new Date(raw.createdAt),
    entry: { ...fields, label: (fields.label as string) ?? '' },
  };
}
