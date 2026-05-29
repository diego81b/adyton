import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'supersecure123', minLength: 8 })
  @IsString()
  password!: string;

  @ApiPropertyOptional({ example: 'ab12...', description: 'PoW challenge (required when ENABLE_POW=true)' })
  @IsOptional()
  @IsString()
  powChallenge?: string;

  @ApiPropertyOptional({ example: '12345', description: 'PoW nonce (required when ENABLE_POW=true)' })
  @IsOptional()
  @IsString()
  powNonce?: string;
}
