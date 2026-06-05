import { ApiProperty } from '@nestjs/swagger';

export class TwoFactorSetupResponseDto {
  @ApiProperty({ description: 'Base32 TOTP secret (160-bit) for manual entry into an authenticator app' })
  secret!: string;

  @ApiProperty({ description: 'otpauth:// URI encoded in the QR code' })
  otpauthUri!: string;

  @ApiProperty({ description: 'QR code as a data: image URI, rendered by the client' })
  qrDataUri!: string;
}
