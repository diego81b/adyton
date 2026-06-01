import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ description: '64-char hex KDF salt for client-side Argon2id derivation' })
  kdfSalt!: string;

  @ApiProperty()
  totpEnabled!: boolean;
}

export class AuthTokensResponseDto {
  @ApiProperty({ description: 'Short-lived JWT access token (15 min); store in memory only' })
  accessToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiPropertyOptional({
    description: 'Present only on first login from an unknown device; consumed by POST /auth/devices/register',
  })
  newDeviceOtp?: string;
}
