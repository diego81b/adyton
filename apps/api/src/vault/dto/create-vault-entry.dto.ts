import { IsEnum, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { EntryType, EnvironmentTag } from '../../entities/vault-entry.entity';

export class CreateVaultEntryDto {
  @IsEnum(EntryType)
  entryType!: EntryType;

  @IsString()
  @IsNotEmpty()
  encryptedData!: string;

  @IsString()
  @IsNotEmpty()
  iv!: string;

  @IsString()
  @IsNotEmpty()
  authTag!: string;

  @IsString()
  @Length(64, 64)
  labelHash!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  encryptedMetadata?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  metadataIv?: string;

  @IsOptional()
  @IsEnum(EnvironmentTag)
  environmentTag?: EnvironmentTag;
}
