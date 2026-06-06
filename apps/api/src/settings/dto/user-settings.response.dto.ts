import { ApiProperty } from '@nestjs/swagger';
import type { LockMode } from '../user-settings.contract';

export class UserSettingsResponseDto {
  @ApiProperty({ description: 'User-chosen display name (may be empty)' })
  displayName!: string;

  @ApiProperty({
    enum: ['activity', 'absolute'],
    description: "'activity' resets the auto-lock timer on user activity; 'absolute' never resets",
  })
  lockMode!: LockMode;

  @ApiProperty({
    description: 'Auto-lock duration in ms. 0 = never; otherwise between 60000 and 3600000 inclusive.',
    example: 900000,
  })
  lockDurationMs!: number;
}
