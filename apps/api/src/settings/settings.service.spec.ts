import { EntityManager } from '@mikro-orm/core';
import { DEFAULT_USER_SETTINGS, UserSettings } from './user-settings.contract';
import { SettingsService } from './settings.service';
import { User } from '../entities/user.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';

function makeUser(settings: Partial<UserSettings> | null = null): User {
  return { id: 'user-id-1', settings } as unknown as User;
}

describe('SettingsService', () => {
  let service: SettingsService;
  let mockEm: jest.Mocked<Pick<EntityManager, 'findOneOrFail' | 'flush'>>;

  beforeEach(() => {
    mockEm = {
      findOneOrFail: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    };
    service = new SettingsService(mockEm as unknown as EntityManager);
  });

  // ---------------------------------------------------------------------------
  describe('getSettings', () => {
    it('returns defaults when stored settings are null', async () => {
      mockEm.findOneOrFail.mockResolvedValue(makeUser(null));

      const result = await service.getSettings('user-id-1');

      expect(result).toEqual(DEFAULT_USER_SETTINGS);
    });

    it('merges stored partial over the defaults', async () => {
      mockEm.findOneOrFail.mockResolvedValue(
        makeUser({ displayName: 'Diego', lockDurationMs: 60_000 }),
      );

      const result = await service.getSettings('user-id-1');

      expect(result).toEqual({
        displayName: 'Diego',
        lockMode: DEFAULT_USER_SETTINGS.lockMode,
        lockDurationMs: 60_000,
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('updateSettings', () => {
    it('merges new fields into a previously-null partial and flushes', async () => {
      const user = makeUser(null);
      mockEm.findOneOrFail.mockResolvedValue(user);

      const dto: UpdateSettingsDto = { displayName: 'Diego', lockMode: 'absolute' };
      const result = await service.updateSettings('user-id-1', dto);

      expect(user.settings).toEqual({ displayName: 'Diego', lockMode: 'absolute' });
      expect(mockEm.flush).toHaveBeenCalledTimes(1);
      // Response is defaults merged with stored partial.
      expect(result).toEqual({
        displayName: 'Diego',
        lockMode: 'absolute',
        lockDurationMs: DEFAULT_USER_SETTINGS.lockDurationMs,
      });
    });

    it('preserves a previously-stored displayName when only lockMode is updated', async () => {
      const user = makeUser({ displayName: 'Diego', lockDurationMs: 120_000 });
      mockEm.findOneOrFail.mockResolvedValue(user);

      const result = await service.updateSettings('user-id-1', { lockMode: 'absolute' });

      expect(user.settings).toEqual({
        displayName: 'Diego',
        lockDurationMs: 120_000,
        lockMode: 'absolute',
      });
      expect(result.displayName).toBe('Diego');
      expect(result.lockDurationMs).toBe(120_000);
      expect(result.lockMode).toBe('absolute');
    });

    it('does not clobber stored fields with an absent-but-undefined DTO key', async () => {
      const user = makeUser({ displayName: 'Diego' });
      mockEm.findOneOrFail.mockResolvedValue(user);

      // Simulate the global ValidationPipe materializing optional keys as undefined.
      const dto = { displayName: undefined, lockMode: undefined, lockDurationMs: 300_000 } as UpdateSettingsDto;
      await service.updateSettings('user-id-1', dto);

      expect(user.settings).toEqual({ displayName: 'Diego', lockDurationMs: 300_000 });
    });

    it('accepts lockDurationMs of 0 (never auto-lock)', async () => {
      const user = makeUser(null);
      mockEm.findOneOrFail.mockResolvedValue(user);

      const result = await service.updateSettings('user-id-1', { lockDurationMs: 0 });

      expect(user.settings).toEqual({ lockDurationMs: 0 });
      expect(result.lockDurationMs).toBe(0);
    });
  });
});
