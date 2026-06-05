import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PasskeyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'YubiKey 5C' })
  friendlyName!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  lastUsedAt!: Date | null;
}
