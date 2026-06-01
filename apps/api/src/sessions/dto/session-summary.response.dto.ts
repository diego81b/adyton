import { ApiProperty } from '@nestjs/swagger';

export class SessionSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  familyId!: string;

  @ApiProperty()
  ipAddress!: string;

  @ApiProperty()
  userAgent!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  expiresAt!: Date;
}
