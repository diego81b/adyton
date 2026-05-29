import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { SessionsService } from './sessions.service';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('sessions')
@ApiBearerAuth('access-token')
@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'List active sessions' })
  @ApiResponse({ status: 200 })
  listSessions(@Req() req: RequestWithUser) {
    return this.sessionsService.listSessions(req.user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a session' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 403 })
  async revokeSession(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.sessionsService.revokeSession(req.user.userId, id);
  }
}
