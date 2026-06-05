import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { decryptTotpSecret, encryptTotpSecret, loadTotpEncKey } from './totp-cipher';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // 32-char base32

describe('totp-cipher', () => {
  const key = randomBytes(32);

  describe('encryptTotpSecret / decryptTotpSecret', () => {
    it('round-trips: decrypt of encrypt returns the original secret', () => {
      const encrypted = encryptTotpSecret(SECRET, key);
      expect(decryptTotpSecret(encrypted, key)).toBe(SECRET);
    });

    it('produces a three-segment iv.ciphertext.tag base64url string', () => {
      const encrypted = encryptTotpSecret(SECRET, key);
      const parts = encrypted.split('.');
      expect(parts).toHaveLength(3);
      expect(encrypted).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('two encryptions of the same secret differ (random IV) but both decrypt', () => {
      const a = encryptTotpSecret(SECRET, key);
      const b = encryptTotpSecret(SECRET, key);
      expect(a).not.toBe(b);
      expect(decryptTotpSecret(a, key)).toBe(SECRET);
      expect(decryptTotpSecret(b, key)).toBe(SECRET);
    });

    it('throws when the ciphertext segment is tampered (GCM auth failure)', () => {
      const [iv, ct, tag] = encryptTotpSecret(SECRET, key).split('.');
      const tamperedCt = Buffer.from(ct, 'base64url');
      tamperedCt[0] ^= 0xff;
      const forged = [iv, tamperedCt.toString('base64url'), tag].join('.');
      expect(() => decryptTotpSecret(forged, key)).toThrow();
    });

    it('throws when the tag segment is tampered (GCM auth failure)', () => {
      const [iv, ct, tag] = encryptTotpSecret(SECRET, key).split('.');
      const tamperedTag = Buffer.from(tag, 'base64url');
      tamperedTag[0] ^= 0xff;
      const forged = [iv, ct, tamperedTag.toString('base64url')].join('.');
      expect(() => decryptTotpSecret(forged, key)).toThrow();
    });

    it('throws when decrypting with the wrong key', () => {
      const encrypted = encryptTotpSecret(SECRET, key);
      const wrongKey = randomBytes(32);
      expect(() => decryptTotpSecret(encrypted, wrongKey)).toThrow();
    });

    it('throws on malformed input with the wrong number of segments', () => {
      expect(() => decryptTotpSecret('only.two', key)).toThrow(
        'Malformed encrypted TOTP secret',
      );
    });

    it('throws on an empty string', () => {
      expect(() => decryptTotpSecret('', key)).toThrow('Malformed encrypted TOTP secret');
    });
  });

  describe('loadTotpEncKey', () => {
    let originalEnv: string | undefined;
    let tmpDir: string;

    beforeEach(() => {
      originalEnv = process.env.TOTP_ENC_KEY_PATH;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totp-key-'));
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.TOTP_ENC_KEY_PATH;
      } else {
        process.env.TOTP_ENC_KEY_PATH = originalEnv;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns a 32-byte Buffer from a 64-hex-char key file', () => {
      const keyFile = path.join(tmpDir, 'totp_enc.key');
      const hex = randomBytes(32).toString('hex');
      fs.writeFileSync(keyFile, `${hex}\n`);
      process.env.TOTP_ENC_KEY_PATH = keyFile;

      const loaded = loadTotpEncKey();
      expect(Buffer.isBuffer(loaded)).toBe(true);
      expect(loaded).toHaveLength(32);
      expect(loaded.toString('hex')).toBe(hex);
    });

    it('throws when the key file holds fewer than 32 bytes', () => {
      const keyFile = path.join(tmpDir, 'totp_enc.key');
      fs.writeFileSync(keyFile, randomBytes(16).toString('hex'));
      process.env.TOTP_ENC_KEY_PATH = keyFile;

      expect(() => loadTotpEncKey()).toThrow('must be 32 bytes hex, got 16');
    });
  });
});
