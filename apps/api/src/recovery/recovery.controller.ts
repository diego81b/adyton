import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RecoveryService } from './recovery.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { SetupRecoveryKitDto } from './dto/recovery.dto';
import { RecoveryStatusResponseDto, RecoveryVaultKeyResponseDto } from './dto/recovery-response.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('recovery')
@Controller('auth/recovery')
export class RecoveryController {
  constructor(private readonly recoveryService: RecoveryService) {}

  @Post('setup')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Store or update the recovery kit for the authenticated user' })
  @ApiResponse({ status: 204, description: 'Recovery kit stored' })
  async setup(
    @Body() dto: SetupRecoveryKitDto,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.recoveryService.setup(req.user.userId, dto, req.ip, ua ?? '');
  }

  @Delete('setup')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke (delete) the recovery kit for the authenticated user' })
  @ApiResponse({ status: 204, description: 'Recovery kit revoked' })
  async revoke(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.recoveryService.revoke(req.user.userId, req.ip, ua ?? '');
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Check whether the authenticated user has an active recovery kit' })
  @ApiResponse({ status: 200, type: RecoveryStatusResponseDto })
  async getStatus(@Req() req: RequestWithUser): Promise<RecoveryStatusResponseDto> {
    return this.recoveryService.getStatus(req.user.userId);
  }

  @Get('vault-key')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Retrieve the wrapped vault key from the recovery kit (3 per hour per user)' })
  @ApiResponse({ status: 200, type: RecoveryVaultKeyResponseDto })
  @ApiResponse({ status: 404, description: 'No recovery kit found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (3 per hour)' })
  async getVaultKey(
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<RecoveryVaultKeyResponseDto> {
    return this.recoveryService.getVaultKey(req.user.userId, req.ip, ua ?? '');
  }
}
