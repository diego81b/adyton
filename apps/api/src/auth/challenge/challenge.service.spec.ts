import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ChallengeService } from './challenge.service';

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn(),
};

function findNonce(challenge: string, difficulty: number): string {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    const hash = createHash('sha256').update(challenge + nonce.toString()).digest('hex');
    if (hash.startsWith(target)) return nonce.toString();
    nonce++;
  }
}

describe('ChallengeService', () => {
  let service: ChallengeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChallengeService(mockRedis as never);
  });

  // --------------------------------------------------------------------------
  describe('issueChallenge()', () => {
    it('returns a 64-char lowercase hex challenge', async () => {
      const result = await service.issueChallenge();
      expect(result.challenge).toHaveLength(64);
      expect(result.challenge).toMatch(/^[0-9a-f]{64}$/);
    });

    it('sets Redis key with 120s TTL', async () => {
      const result = await service.issueChallenge();
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `pow_challenge:${result.challenge}`,
        120,
        '1',
      );
    });

    it('returns difficulty 4 and expiresAt ~120s from now', async () => {
      const before = Date.now();
      const result = await service.issueChallenge();
      const after = Date.now();
      expect(result.difficulty).toBe(4);
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120_000 - 50);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 120_000 + 50);
    });

    it('each call generates a different challenge', async () => {
      const a = await service.issueChallenge();
      const b = await service.issueChallenge();
      expect(a.challenge).not.toBe(b.challenge);
    });
  });

  // --------------------------------------------------------------------------
  describe('verifyAndConsume()', () => {
    it('succeeds with valid proof and atomically deletes key', async () => {
      const challenge = 'a'.repeat(64);
      const nonce = findNonce(challenge, 4);
      mockRedis.del.mockResolvedValue(1);

      await expect(service.verifyAndConsume(challenge, nonce)).resolves.toBeUndefined();
      expect(mockRedis.del).toHaveBeenCalledWith(`pow_challenge:${challenge}`);
    });

    it('throws 400 when challenge expired or already used (del returns 0)', async () => {
      const challenge = 'b'.repeat(64);
      const nonce = findNonce(challenge, 4);
      mockRedis.del.mockResolvedValue(0); // key gone — expired or already consumed

      await expect(service.verifyAndConsume(challenge, nonce)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.verifyAndConsume(challenge, nonce)).rejects.toThrow(
        'Challenge expired or already used',
      );
    });

    it('throws 400 for invalid proof (wrong hash) and never touches Redis', async () => {
      const challenge = 'deadbeef'.repeat(8);
      const wrongNonce = 'wrong';
      // Confirm precondition: this specific pair definitely fails difficulty 4
      const hash = createHash('sha256').update(challenge + wrongNonce).digest('hex');
      expect(hash.startsWith('0000')).toBe(false);

      await expect(service.verifyAndConsume(challenge, wrongNonce)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.verifyAndConsume(challenge, wrongNonce)).rejects.toThrow('Invalid proof of work');
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});
