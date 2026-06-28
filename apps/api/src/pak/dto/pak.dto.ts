import { IsString, IsNotEmpty, Length, IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IssueQrDto {
  @ApiProperty({ description: 'Desktop ephemeral P-256 public key, base64 SPKI' })
  @IsString() @IsNotEmpty()
  desktopPublicKeySpki!: string;

  @ApiProperty({ description: '32-byte challenge, hex encoded' })
  @IsString() @Length(64, 64)
  challengeHex!: string;
}

export class SubmitRelayDto {
  @ApiProperty() @IsString() @IsNotEmpty() phoneEphemeralPub!: string;
  @ApiProperty() @IsString() @IsNotEmpty() ciphertext!: string;
  @ApiProperty() @IsString() @IsNotEmpty() iv!: string;
  @ApiProperty() @IsString() @IsNotEmpty() deviceId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() signature!: string;
}

export class EnrollDeviceDto {
  @ApiProperty({ description: 'Device P-256 public key, base64 SPKI' })
  @IsString() @IsNotEmpty()
  devicePublicKeySpki!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  deviceName!: string;

  @ApiProperty({ enum: ['android', 'ios'] })
  @IsIn(['android', 'ios'])
  platform!: string;

  @ApiProperty({ enum: ['master_password', 'existing_device', 'recovery_kit'] })
  @IsIn(['master_password', 'existing_device', 'recovery_kit'])
  enrollmentMethod!: string;

  @ApiProperty({ description: 'Ephemeral public key for enrollment ECDH' })
  @IsString() @IsNotEmpty()
  enrollmentEphemeralPub!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  signature!: string;

  @ApiProperty({ description: 'Enrollment session ID — links this device enrollment to a desktop polling session', required: false })
  @IsOptional()
  @IsString()
  enrollmentSessionId?: string;
}

export class RenameDeviceDto {
  @ApiProperty() @IsString() @IsNotEmpty() @Length(1, 256)
  deviceName!: string;
}

export class StartEnrollSessionDto {
  @ApiProperty({ description: 'Desktop ephemeral P-256 public key, base64 SPKI (for enrollment ECDH)' })
  @IsString() @IsNotEmpty()
  desktopPublicKeySpki!: string;

  @ApiProperty({ description: '32-byte challenge, hex encoded (HKDF salt)' })
  @IsString() @Length(64, 64)
  challengeHex!: string;
}

export class SubmitEnrollVaultDto {
  @ApiProperty({ description: 'AES-GCM ciphertext (vault key encrypted for phone), base64' })
  @IsString() @IsNotEmpty()
  ciphertext!: string;

  @ApiProperty({ description: 'AES-GCM IV, base64, 12 bytes' })
  @IsString() @IsNotEmpty()
  iv!: string;
}
