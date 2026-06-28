import { ApiProperty } from '@nestjs/swagger';

export class QrSessionResponseDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty() challengeHex!: string;
  @ApiProperty() ttlSeconds!: number;
}

export class QrPollResponseDto {
  @ApiProperty({ enum: ['pending', 'approved', 'denied', 'expired'] })
  status!: 'pending' | 'approved' | 'denied' | 'expired';

  @ApiProperty({ required: false }) phoneEphemeralPub?: string;
  @ApiProperty({ required: false }) ciphertext?: string;
  @ApiProperty({ required: false }) iv?: string;
  @ApiProperty({ required: false }) deviceId?: string;
  @ApiProperty({ required: false }) signature?: string;
}

export class DeviceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() deviceName!: string;
  @ApiProperty() platform!: string;
  @ApiProperty() enrollmentMethod!: string;
  @ApiProperty() enrolledAt!: Date;
  @ApiProperty({ nullable: true }) lastUsedAt!: Date | null;
  @ApiProperty({ nullable: true }) revokedAt!: Date | null;
  @ApiProperty() publicKeyFingerprint!: string;
}
