import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(() => {
    service = new CryptoService();
  });

  describe('hashPassword / verifyPassword', () => {
    it('hashPassword returns a string starting with $argon2id', async () => {
      const hash = await service.hashPassword('supersecretpassword');
      expect(hash).toMatch(/^\$argon2id/);
    });

    it('verifyPassword returns true for correct password', async () => {
      const hash = await service.hashPassword('correcthorsebatterystaple');
      const result = await service.verifyPassword('correcthorsebatterystaple', hash);
      expect(result).toBe(true);
    });

    it('verifyPassword returns false for wrong password', async () => {
      const hash = await service.hashPassword('correcthorsebatterystaple');
      const result = await service.verifyPassword('wrongpassword', hash);
      expect(result).toBe(false);
    });
  });

  describe('hashToken', () => {
    it('returns a 64-character hex string', () => {
      const result = service.hashToken('some-raw-token');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic — same input yields same output', () => {
      const raw = 'deterministic-token-value';
      expect(service.hashToken(raw)).toBe(service.hashToken(raw));
    });

    it('different inputs yield different outputs', () => {
      expect(service.hashToken('token-a')).not.toBe(service.hashToken('token-b'));
    });
  });

  describe('generateKdfSalt', () => {
    it('returns a 64-character hex string', () => {
      const salt = service.generateKdfSalt();
      expect(salt).toHaveLength(64);
      expect(salt).toMatch(/^[0-9a-f]{64}$/);
    });

    it('two calls return different values', () => {
      expect(service.generateKdfSalt()).not.toBe(service.generateKdfSalt());
    });
  });

  describe('generateRefreshToken', () => {
    it('returns a 64-character hex string', () => {
      const token = service.generateRefreshToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('two calls return different values', () => {
      expect(service.generateRefreshToken()).not.toBe(service.generateRefreshToken());
    });
  });

  describe('generateDeviceId', () => {
    it('returns a 64-character hex string', () => {
      const id = service.generateDeviceId();
      expect(id).toHaveLength(64);
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
