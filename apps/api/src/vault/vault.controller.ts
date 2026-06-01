import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { VaultService } from './vault.service';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto';
import { ListVaultEntriesQueryDto } from './dto/list-vault-entries-query.dto';
import { VaultEntryResponseDto } from './dto/vault-entry.response.dto';
import { VaultEntryVersionResponseDto } from './dto/vault-entry-version.response.dto';
import { PaginatedVaultEntriesResponseDto } from './dto/paginated-vault-entries.response.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('vault')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('vault')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @ApiOperation({ summary: 'List vault entries (cursor-paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated entry list', type: PaginatedVaultEntriesResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get()
  list(@Req() req: RequestWithUser, @Query() query: ListVaultEntriesQueryDto) {
    return this.vaultService.list(req.user.userId, query);
  }

  @ApiOperation({ summary: 'Create a new vault entry' })
  @ApiResponse({ status: 201, description: 'Entry created', type: VaultEntryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Body() dto: CreateVaultEntryDto,
  ) {
    return this.vaultService.create(req.user.userId, dto, req.ip, ua ?? '');
  }

  @ApiOperation({ summary: 'Get a single vault entry' })
  @ApiParam({ name: 'id', description: 'Entry UUID' })
  @ApiResponse({ status: 200, description: 'Entry found', type: VaultEntryResponseDto })
  @ApiResponse({ status: 404, description: 'Entry not found or not owned by caller' })
  @Get(':id')
  findOne(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Param('id') id: string,
  ) {
    return this.vaultService.findOneAndAudit(req.user.userId, id, req.ip, ua ?? '');
  }

  @ApiOperation({ summary: 'Update a vault entry (snapshots current version)' })
  @ApiParam({ name: 'id', description: 'Entry UUID' })
  @ApiResponse({ status: 200, description: 'Entry updated, version incremented', type: VaultEntryResponseDto })
  @ApiResponse({ status: 404, description: 'Entry not found or not owned by caller' })
  @Patch(':id')
  update(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Param('id') id: string,
    @Body() dto: UpdateVaultEntryDto,
  ) {
    return this.vaultService.update(req.user.userId, id, dto, req.ip, ua ?? '');
  }

  @ApiOperation({ summary: 'Delete a vault entry and all its version history' })
  @ApiParam({ name: 'id', description: 'Entry UUID' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Entry not found or not owned by caller' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Param('id') id: string,
  ) {
    return this.vaultService.remove(req.user.userId, id, req.ip, ua ?? '');
  }

  @ApiOperation({ summary: 'List version history for a vault entry (DESC order)' })
  @ApiParam({ name: 'id', description: 'Entry UUID' })
  @ApiResponse({ status: 200, description: 'Version list', type: [VaultEntryVersionResponseDto] })
  @ApiResponse({ status: 404, description: 'Entry not found or not owned by caller' })
  @Get(':id/versions')
  listVersions(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.vaultService.listVersions(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Restore a vault entry to a previous version' })
  @ApiParam({ name: 'id', description: 'Entry UUID' })
  @ApiParam({ name: 'versionId', description: 'Version snapshot UUID' })
  @ApiResponse({ status: 200, description: 'Entry restored, version incremented', type: VaultEntryResponseDto })
  @ApiResponse({ status: 404, description: 'Entry or version not found' })
  @Post(':id/versions/:versionId/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.vaultService.restoreVersion(req.user.userId, id, versionId, req.ip, ua ?? '');
  }
}
