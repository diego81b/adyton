import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'One-time token from login response newDeviceOtp field' })
  @IsString()
  @IsNotEmpty()
  otp!: string;
}
