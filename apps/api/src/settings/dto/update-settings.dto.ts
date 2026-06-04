import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { LockMode } from '../user-settings.contract';
import { IsLockDuration } from './is-lock-duration.validator';

const LOCK_MODES: LockMode[] = ['activity', 'absolute'];

/**
 * Partial-update payload for user settings. Even though the route is PUT, the
 * semantics are a merge: any field left out is preserved server-side.
 */
export class UpdateSettingsDto {
  @ApiPropertyOptional({ maxLength: 64, description: 'Display name (trimmed)' })
  @IsOptional()
  // Trim before MaxLength runs (transform happens before validation).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(64)
  displayName?: string;

  @ApiPropertyOptional({ enum: LOCK_MODES })
  @IsOptional()
  @IsIn(LOCK_MODES)
  lockMode?: LockMode;

  @ApiPropertyOptional({
    description: '0 = never auto-lock; otherwise an integer in [60000, 3600000].',
    example: 900000,
  })
  @IsOptional()
  @IsLockDuration()
  lockDurationMs?: number;
}
