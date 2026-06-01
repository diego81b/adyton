import { ApiProperty } from '@nestjs/swagger';

export class UserProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ description: '64-char hex KDF salt' })
  kdfSalt!: string;

  @ApiProperty()
  totpEnabled!: boolean;
}
