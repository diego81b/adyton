import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VaultEntryResponseDto } from './vault-entry.response.dto';

export class PaginatedVaultEntriesResponseDto {
  @ApiProperty({ type: [VaultEntryResponseDto] })
  data!: VaultEntryResponseDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Opaque cursor for next page; null when no more results' })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
