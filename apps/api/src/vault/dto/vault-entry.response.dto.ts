import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryType, EnvironmentTag } from '../../entities/vault-entry.entity';

export class VaultEntryResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000001' })
  id!: string;

  @ApiProperty({ enum: EntryType })
  entryType!: EntryType;

  @ApiProperty()
  encryptedData!: string;

  @ApiProperty({ maxLength: 64 })
  iv!: string;

  @ApiProperty({ maxLength: 64 })
  authTag!: string;

  @ApiProperty({ maxLength: 64, description: 'SHA-256 hex of plaintext label' })
  labelHash!: string;

  @ApiPropertyOptional({ nullable: true })
  encryptedMetadata!: string | null;

  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  metadataIv!: string | null;

  @ApiPropertyOptional({ maxLength: 64, nullable: true })
  metadataAuthTag!: string | null;

  @ApiPropertyOptional({ enum: EnvironmentTag, nullable: true })
  environmentTag!: EnvironmentTag | null;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
