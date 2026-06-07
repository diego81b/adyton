import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Server-held AES-256-GCM encryption of the account-2FA TOTP secret.
 *
 * SECURITY NOTE — sanctioned zero-knowledge exception (analysis/security/architecture.md §1, §3.5):
 * the TOTP secret is a second authentication factor the SERVER must verify, so it cannot
 * ride the client-encrypted vault. It is encrypted at rest with a key on disk (same
 * provenance pattern as the JWT RS256 keypair, never an env-committed literal).
 * Losing this key makes every enrolled TOTP secret unrecoverable: users re-enroll.
 *
 * This is unrelated to packages/shared/src/totp.ts, which powers per-LOGIN-entry
 * vault TOTP and stays fully client-side.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;

export function loadTotpEncKey(): Buffer {
  // Priority 1: TOTP_ENC_KEY env var (64 hex chars) — CI and prod (no file dependency)
  if (process.env.TOTP_ENC_KEY) {
    const key = Buffer.from(process.env.TOTP_ENC_KEY.trim(), 'hex');
    if (key.length !== KEY_BYTES) {
      throw new Error(`TOTP encryption key must be ${KEY_BYTES} bytes hex, got ${key.length}`);
    }
    return key;
  }
  // Priority 2: TOTP_ENC_KEY_PATH env var or default file path — dev
  const envPath = process.env.TOTP_ENC_KEY_PATH;
  const filePath =
    envPath && fs.existsSync(envPath)
      ? envPath
      : path.resolve(process.cwd(), '../../secrets/totp_enc.key');
  const key = Buffer.from(fs.readFileSync(filePath, 'utf8').trim(), 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOTP encryption key must be ${KEY_BYTES} bytes hex, got ${key.length}`);
  }
  return key;
}

/** Returns `iv.ciphertext.authTag` (base64url segments). */
export function encryptTotpSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ciphertext, tag].map((b) => b.toString('base64url')).join('.');
}

export function decryptTotpSecret(encrypted: string, key: Buffer): string {
  const parts = encrypted.split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted TOTP secret');
  const [iv, ciphertext, tag] = parts.map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
