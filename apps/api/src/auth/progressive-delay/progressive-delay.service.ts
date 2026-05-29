import { HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.provider';

const FAIL_TTL_SECONDS = 15 * 60; // 15 minutes
const LOCK_THRESHOLD = 10;

function emailHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}

function redisKey(ip: string, email: string): string {
  return `login_fail:${ip}:${emailHash(email)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class ProgressiveDelayService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  getDelay(failCount: number): number {
    if (failCount <= 0) return 0;
    if (failCount <= 2) return 2000;
    if (failCount <= 4) return 5000;
    if (failCount <= 9) return 10000;
    return -1; // -1 = locked
  }

  async checkAndDelay(ip: string, email: string): Promise<void> {
    const key = redisKey(ip, email);
    const raw = await this.redis.get(key);
    const count = raw ? parseInt(raw, 10) : 0;

    const delay = this.getDelay(count);

    if (delay === -1 || count >= LOCK_THRESHOLD) {
      throw new HttpException('Account temporarily locked', 429);
    }

    if (delay > 0) {
      await sleep(delay);
    }
  }

  async recordFailure(ip: string, email: string): Promise<void> {
    const key = redisKey(ip, email);
    const result = await this.redis.incr(key);
    // Set TTL only on first increment to avoid resetting the window
    if (result === 1) {
      await this.redis.expire(key, FAIL_TTL_SECONDS);
    }
  }

  async clearFailures(ip: string, email: string): Promise<void> {
    const key = redisKey(ip, email);
    await this.redis.del(key);
  }
}
