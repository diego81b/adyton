import { IsNotEmpty, IsString } from 'class-validator';

export class SetupRecoveryKitDto {
  @IsString()
  @IsNotEmpty()
  recoverySalt!: string;

  @IsString()
  @IsNotEmpty()
  recoveryWrappedVaultKey!: string;

  @IsString()
  @IsNotEmpty()
  wrapIv!: string;
}
