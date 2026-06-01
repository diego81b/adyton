import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { EntryType, EnvironmentTag } from '../../entities/vault-entry.entity';

export class CreateVaultEntryDto {
  /**
   * Client-generated UUID — required so AAD (`${userId}:${id}`) can be computed
   * before encryption. Server uses this as the primary key; no DB-side generation.
   */
  @IsUUID()
  id!: string;

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
  @IsString()
  @IsNotEmpty()
  metadataAuthTag?: string;

  @IsOptional()
  @IsEnum(EnvironmentTag)
  environmentTag?: EnvironmentTag;
}
