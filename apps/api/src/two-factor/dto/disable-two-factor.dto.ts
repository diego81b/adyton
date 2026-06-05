import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisableTwoFactorDto {
  @ApiProperty({ description: 'Master password, re-verified before disabling 2FA' })
  @IsString()
  @MaxLength(128)
  password!: string;
}
