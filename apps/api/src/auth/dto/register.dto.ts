import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'supersecure123', minLength: 12 })
  @IsString()
  @MinLength(12)
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
