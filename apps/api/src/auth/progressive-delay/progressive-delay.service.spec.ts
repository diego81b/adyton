import { HttpException } from '@nestjs/common';
import { ProgressiveDelayService } from './progressive-delay.service';

// Mock ioredis
const mockRedis = {
  get: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
};

describe('ProgressiveDelayService', () => {
  let service: ProgressiveDelayService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new ProgressiveDelayService(mockRedis as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getDelay', () => {
    it('returns 0 for failCount <= 0', () => {
      expect(service.getDelay(0)).toBe(0);
      expect(service.getDelay(-1)).toBe(0);
    });

    it('returns 2000 for failCount 1-2', () => {
      expect(service.getDelay(1)).toBe(2000);
      expect(service.getDelay(2)).toBe(2000);
    });

    it('returns 5000 for failCount 3-4', () => {
      expect(service.getDelay(3)).toBe(5000);
      expect(service.getDelay(4)).toBe(5000);
    });

    it('returns 10000 for failCount 5-9', () => {
      expect(service.getDelay(5)).toBe(10000);
      expect(service.getDelay(9)).toBe(10000);
    });

    it('returns -1 (locked) for failCount >= 10', () => {
      expect(service.getDelay(10)).toBe(-1);
      expect(service.getDelay(99)).toBe(-1);
    });
  });

  describe('checkAndDelay', () => {
    it('throws 429 HttpException when count >= 10', async () => {
      mockRedis.get.mockResolvedValue('10');
      await expect(service.checkAndDelay('127.0.0.1', 'test@test.com')).rejects.toThrow(
        HttpException,
      );
      await expect(service.checkAndDelay('127.0.0.1', 'test@test.com')).rejects.toMatchObject({
        status: 429,
      });
    });

    it('does not throw when count is 0', async () => {
      mockRedis.get.mockResolvedValue(null);
      // Run without timers advancing — no delay expected
      const promise = service.checkAndDelay('127.0.0.1', 'fresh@test.com');
      await expect(promise).resolves.toBeUndefined();
    });

    it('applies delay when count is 1', async () => {
      mockRedis.get.mockResolvedValue('1');
      const promise = service.checkAndDelay('127.0.0.1', 'delayed@test.com');
      await jest.advanceTimersByTimeAsync(2000);
      await promise;
      // If we got here without throwing, the delay was applied correctly
    });
  });

  describe('recordFailure', () => {
    it('calls INCR and then EXPIRE on first increment (result === 1)', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      await service.recordFailure('127.0.0.1', 'user@test.com');

      expect(mockRedis.incr).toHaveBeenCalledTimes(1);
      expect(mockRedis.expire).toHaveBeenCalledTimes(1);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining('login_fail:'),
        900, // 15 * 60
      );
    });

    it('does not call EXPIRE on subsequent increments', async () => {
      mockRedis.incr.mockResolvedValue(3);

      await service.recordFailure('127.0.0.1', 'user@test.com');

      expect(mockRedis.incr).toHaveBeenCalledTimes(1);
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });
  });

  describe('clearFailures', () => {
    it('calls DEL on the correct key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.clearFailures('127.0.0.1', 'user@test.com');

      expect(mockRedis.del).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('login_fail:'));
    });
  });
});
