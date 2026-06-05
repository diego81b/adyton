import { IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthenticateTwoFactorDto {
  @ApiProperty({ description: 'Opaque pending-MFA token returned by POST /auth/login' })
  @Matches(/^[0-9a-f]{64}$/, { message: 'mfaToken must be a 64-char hex token' })
  mfaToken!: string;

  @ApiPropertyOptional({ example: '123456', description: '6-digit TOTP code (mutually exclusive with recoveryCode)' })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit TOTP code' })
  code?: string;

  @ApiPropertyOptional({
    example: 'a1b2c-d3e4f-a5b6c-d7e8f',
    description: 'One-time recovery code (mutually exclusive with code)',
  })
  @IsOptional()
  @Matches(/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/, { message: 'recoveryCode format is xxxxx-xxxxx-xxxxx-xxxxx' })
  recoveryCode?: string;
}
