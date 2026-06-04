import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountDto {
  @ApiProperty({ description: 'Current account password, required to confirm deletion.' })
  @IsString()
  @MinLength(1)
  password!: string;
}
