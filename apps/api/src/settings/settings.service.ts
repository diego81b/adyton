import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { DEFAULT_USER_SETTINGS, UserSettings } from './user-settings.contract';
import { User } from '../entities/user.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Resolve the effective settings: stored partial merged over the defaults.
   * null stored settings yields the defaults.
   */
  async getSettings(userId: string): Promise<UserSettings> {
    const user = await this.em.findOneOrFail(User, { id: userId });
    return { ...DEFAULT_USER_SETTINGS, ...(user.settings ?? {}) };
  }

  /**
   * Merge the provided fields into the stored partial (partial-update semantics).
   * Only keys explicitly present in the DTO are touched — absent fields are
   * preserved. We build a filtered patch rather than spreading the DTO so an
   * optional field materialized as `undefined` cannot clobber a stored value.
   */
  async updateSettings(userId: string, dto: UpdateSettingsDto): Promise<UserSettings> {
    const user = await this.em.findOneOrFail(User, { id: userId });

    const patch: Partial<UserSettings> = {};
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.lockMode !== undefined) patch.lockMode = dto.lockMode;
    if (dto.lockDurationMs !== undefined) patch.lockDurationMs = dto.lockDurationMs;

    user.settings = { ...(user.settings ?? {}), ...patch };
    await this.em.flush();

    return { ...DEFAULT_USER_SETTINGS, ...user.settings };
  }
}
