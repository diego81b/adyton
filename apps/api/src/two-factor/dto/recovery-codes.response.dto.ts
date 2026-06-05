import { ApiProperty } from '@nestjs/swagger';

export class RecoveryCodesResponseDto {
  @ApiProperty({
    type: [String],
    description: 'Plaintext one-time recovery codes — shown exactly once, only Argon2id hashes are stored',
  })
  recoveryCodes!: string[];
}
