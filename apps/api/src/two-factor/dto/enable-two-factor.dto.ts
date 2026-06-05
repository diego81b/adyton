import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnableTwoFactorDto {
  @ApiProperty({ example: '123456', description: '6-digit TOTP code confirming the scanned secret' })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit TOTP code' })
  code!: string;
}
