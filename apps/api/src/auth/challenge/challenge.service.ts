import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { REDIS_CLIENT } from '../../redis/redis.provider';

const CHALLENGE_TTL_SECONDS = 120;
const DIFFICULTY = 4;
// Concat contract: SHA-256(challenge + nonce) where nonce is a decimal string, no separator.
// Must match packages/shared/src/pow.ts solvePoW() exactly.
const TARGET_PREFIX = '0'.repeat(DIFFICULTY);

export interface ChallengeResult {
  challenge: string;
  difficulty: number;
  expiresAt: Date;
}

@Injectable()
export class ChallengeService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async issueChallenge(): Promise<ChallengeResult> {
    const challenge = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    await this.redis.setex(`pow_challenge:${challenge}`, CHALLENGE_TTL_SECONDS, '1');
    return { challenge, difficulty: DIFFICULTY, expiresAt };
  }

  async verifyAndConsume(challenge: string, nonce: string): Promise<void> {
    const hash = createHash('sha256').update(challenge + nonce).digest('hex');
    if (!hash.startsWith(TARGET_PREFIX)) {
      throw new BadRequestException('Invalid proof of work');
    }
    const consumed = await this.redis.del(`pow_challenge:${challenge}`);
    if (consumed === 0) {
      throw new BadRequestException('Challenge expired or already used');
    }
  }
}
