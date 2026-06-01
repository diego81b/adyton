import { IsEnum, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { EnvironmentTag } from '../../entities/vault-entry.entity';

export class UpdateVaultEntryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  encryptedData?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  iv?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  authTag?: string;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  labelHash?: string;

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
  environmentTag?: EnvironmentTag | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  changeNote?: string;
}
