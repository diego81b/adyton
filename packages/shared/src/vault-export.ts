import { deriveEncryptionKey, encryptSecret, decryptSecret } from './crypto.js';
import { VaultEntryType, type EnvironmentTag } from './types.js';

export const EXPORT_FORMAT_VERSION = 1 as const;
const EXPORT_AAD = 'adyton-export-v1';

// Shape of each entry inside the export blob — structural fields (id, timestamps,
// version) are intentionally absent so import can assign fresh UUIDs.
export interface VaultExportEntry {
  type: VaultEntryType;
  environment?: EnvironmentTag;
  label: string;
  [key: string]: unknown;
}

// Top-level file structure serialised as JSON with a `.adyton` extension.
export interface VaultExportFile {
  version: typeof EXPORT_FORMAT_VERSION;
  exportedAt: string;
  kdfSalt: string;       // base64 — 32 random bytes
  argon2: { m: number; t: number; p: number };
  iv: string;            // base64 — AES-256-GCM nonce
  authTag: string;       // base64 — GCM auth tag
  ciphertext: string;    // base64 — encrypted JSON array of VaultExportEntry
}

function uint8ToBase64(buf: Uint8Array): string {
  let binary = '';
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUint8(s: string): Uint8Array {
  const binary = atob(s);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

/**
 * Encrypt all vault entries into a portable `.adyton` export file.
 * Key is derived from the export password with a fresh random salt — independent
 * from the vault key so the file is portable across accounts and instances.
 * AAD is a fixed constant (`"adyton-export-v1"`) so there is no userId coupling.
 */
export async function exportVault(
  entries: VaultExportEntry[],
  password: string,
): Promise<VaultExportFile> {
  const kdfSalt = crypto.getRandomValues(new Uint8Array(32));
  const key = await deriveEncryptionKey(password, kdfSalt);
  const blob = await encryptSecret(key, JSON.stringify(entries), EXPORT_AAD);
  return {
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    kdfSalt: uint8ToBase64(kdfSalt),
    argon2: { m: 65536, t: 3, p: 1 },
    iv: blob.iv,
    authTag: blob.authTag,
    ciphertext: blob.ciphertext,
  };
}

/**
 * Decrypt an `.adyton` export file. Throws on wrong password (AES-GCM auth tag
 * mismatch), unsupported version, or malformed input.
 */
export async function importVault(
  file: VaultExportFile,
  password: string,
): Promise<VaultExportEntry[]> {
  if (file.version !== EXPORT_FORMAT_VERSION) {
    throw new Error(`Unsupported export version: ${file.version}`);
  }
  const kdfSalt = base64ToUint8(file.kdfSalt);
  const key = await deriveEncryptionKey(password, kdfSalt);
  const plaintext = await decryptSecret(
    key,
    { ciphertext: file.ciphertext, iv: file.iv, authTag: file.authTag },
    EXPORT_AAD,
  );
  return JSON.parse(plaintext) as VaultExportEntry[];
}

// Re-export enum so shared consumers can type VaultExportEntry.type without a
// separate import of VaultEntryType.
export { VaultEntryType };
