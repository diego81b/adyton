import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecoveryStatusResponseDto {
  @ApiProperty({ description: 'Whether the user has an active recovery kit' })
  hasKit!: boolean;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp of kit confirmation (only present when hasKit is true)' })
  confirmedAt?: string;
}

export class RecoveryVaultKeyResponseDto {
  @ApiProperty({ description: 'Base64-encoded HKDF salt for recovery key derivation' })
  recoverySalt!: string;

  @ApiProperty({ description: 'Base64-encoded AES-GCM wrapped vault key' })
  recoveryWrappedVaultKey!: string;

  @ApiProperty({ description: 'Base64-encoded AES-GCM IV used when wrapping' })
  wrapIv!: string;
}
