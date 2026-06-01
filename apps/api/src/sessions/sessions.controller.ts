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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { SessionsService } from './sessions.service';
import { SessionSummaryResponseDto } from './dto/session-summary.response.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('sessions')
@ApiBearerAuth('access-token')
@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'List active sessions' })
  @ApiResponse({ status: 200, type: [SessionSummaryResponseDto] })
  listSessions(@Req() req: RequestWithUser) {
    return this.sessionsService.listSessions(req.user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a session' })
  @ApiParam({ name: 'id', description: 'Session UUID' })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 403, description: 'Session belongs to another user' })
  async revokeSession(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.sessionsService.revokeSession(req.user.userId, id);
  }
}
