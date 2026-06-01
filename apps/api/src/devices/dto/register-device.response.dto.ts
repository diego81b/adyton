import { ApiProperty } from '@nestjs/swagger';

export class RegisterDeviceResponseDto {
  @ApiProperty({ description: 'Raw device ID set as httpOnly cookie; also returned in body for confirmation' })
  deviceId!: string;
}
