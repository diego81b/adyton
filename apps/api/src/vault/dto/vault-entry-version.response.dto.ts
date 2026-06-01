import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VaultEntryVersionResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000002' })
  id!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  encryptedData!: string;

  @ApiProperty({ maxLength: 64 })
  iv!: string;

  @ApiProperty({ maxLength: 64 })
  authTag!: string;

  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  changeNote!: string | null;

  @ApiProperty()
  createdAt!: Date;
}
