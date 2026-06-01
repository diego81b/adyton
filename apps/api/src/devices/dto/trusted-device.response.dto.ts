import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrustedDeviceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'SHA-256 hex of the raw device_id cookie — never the raw value' })
  deviceIdHash!: string;

  @ApiProperty()
  userAgent!: string;

  @ApiProperty()
  ipAddress!: string;

  @ApiPropertyOptional({ nullable: true })
  lastSeenAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}
