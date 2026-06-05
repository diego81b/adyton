import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegenerateRecoveryCodesDto {
  @ApiProperty({ description: 'Master password, re-verified before regenerating recovery codes' })
  @IsString()
  @MaxLength(128)
  password!: string;
}
