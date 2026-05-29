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
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { VaultService } from './vault.service';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto';
import { ListVaultEntriesQueryDto } from './dto/list-vault-entries-query.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@UseGuards(JwtAuthGuard)
@Controller('vault')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get()
  list(@Req() req: RequestWithUser, @Query() query: ListVaultEntriesQueryDto) {
    return this.vaultService.list(req.user.userId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Body() dto: CreateVaultEntryDto,
  ) {
    return this.vaultService.create(req.user.userId, dto, req.ip, ua ?? '');
  }

  @Get(':id')
  findOne(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Param('id') id: string,
  ) {
    return this.vaultService.findOneAndAudit(req.user.userId, id, req.ip, ua ?? '');
  }

  @Patch(':id')
  update(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Param('id') id: string,
    @Body() dto: UpdateVaultEntryDto,
  ) {
    return this.vaultService.update(req.user.userId, id, dto, req.ip, ua ?? '');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Param('id') id: string,
  ) {
    return this.vaultService.remove(req.user.userId, id, req.ip, ua ?? '');
  }

  @Get(':id/versions')
  listVersions(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.vaultService.listVersions(req.user.userId, id);
  }

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
