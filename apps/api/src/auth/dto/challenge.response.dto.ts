import { ApiProperty } from '@nestjs/swagger';

export class ChallengeResponseDto {
  @ApiProperty({ example: 'a3f9...', description: '64-char hex challenge string' })
  challenge!: string;

  @ApiProperty({ example: 4, description: 'Number of required leading zero hex digits' })
  difficulty!: number;

  @ApiProperty()
  expiresAt!: Date;
}
