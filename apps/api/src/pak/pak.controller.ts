import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PakService } from './pak.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { EnrollDeviceDto, IssueQrDto, RenameDeviceDto, SubmitRelayDto } from './dto/pak.dto';
import { DeviceResponseDto, QrPollResponseDto, QrSessionResponseDto } from './dto/pak-response.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('pak')
@Controller()
export class PakController {
  constructor(private readonly pakService: PakService) {}

  // ---------------------------------------------------------------------------
  // QR relay — no auth guard (desktop initiates while not yet logged in)
  // ---------------------------------------------------------------------------

  @Post('auth/qr')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Issue a QR session for PAK login (desktop initiates)' })
  @ApiResponse({ status: 201, type: QrSessionResponseDto, description: 'QR session created' })
  @ApiResponse({ status: 409, description: 'Invalid challengeHex format' })
  async issueQrSession(@Body() dto: IssueQrDto): Promise<QrSessionResponseDto> {
    const { sessionId } = await this.pakService.issueQrSession(
      dto.desktopPublicKeySpki,
      dto.challengeHex,
    );
    return { sessionId, challengeHex: dto.challengeHex, ttlSeconds: 60 };
  }

  @Get('auth/qr-poll/:sessionId')
  @ApiOperation({ summary: 'Poll QR session status (desktop polls while waiting for phone approval)' })
  @ApiResponse({ status: 200, type: QrPollResponseDto })
  async pollQrSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<QrPollResponseDto> {
    return this.pakService.pollQrSession(sessionId);
  }

  @Post('auth/qr-relay/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Submit relay payload from phone (phone approves QR login)' })
  @ApiResponse({ status: 204, description: 'Relay payload stored' })
  @ApiResponse({ status: 404, description: 'QR session not found or expired' })
  @ApiResponse({ status: 409, description: 'QR session already consumed' })
  async submitRelayPayload(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SubmitRelayDto,
  ): Promise<void> {
    await this.pakService.submitRelayPayload(sessionId, dto);
  }

  @Delete('auth/qr-relay/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a QR session (either party can cancel)' })
  @ApiResponse({ status: 204, description: 'QR session cancelled' })
  async cancelQrSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    await this.pakService.cancelQrSession(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Device management — requires JWT auth
  // ---------------------------------------------------------------------------

  @Post('devices/enroll')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Enroll a PAK device for the authenticated user' })
  @ApiResponse({ status: 201, type: DeviceResponseDto, description: 'Device enrolled' })
  @ApiResponse({ status: 409, description: 'Device with this fingerprint already registered' })
  async enrollDevice(
    @Body() dto: EnrollDeviceDto,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<DeviceResponseDto> {
    const device = await this.pakService.enrollDevice(req.user.userId, dto, req.ip, ua ?? '');
    return this.pakService.toDeviceResponse(device);
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List enrolled PAK devices for the authenticated user' })
  @ApiResponse({ status: 200, type: [DeviceResponseDto] })
  async listDevices(@Req() req: RequestWithUser): Promise<DeviceResponseDto[]> {
    const devices = await this.pakService.listDevices(req.user.userId);
    return devices.map((d) => this.pakService.toDeviceResponse(d));
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke a PAK device' })
  @ApiResponse({ status: 204, description: 'Device revoked' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  @ApiResponse({ status: 409, description: 'Device already revoked' })
  async revokeDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Query('reason') reason: 'safe' | 'compromised' = 'safe',
  ): Promise<void> {
    await this.pakService.revokeDevice(req.user.userId, id, reason, req.ip, ua ?? '');
  }

  @Patch('devices/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Rename a PAK device' })
  @ApiResponse({ status: 200, type: DeviceResponseDto })
  @ApiResponse({ status: 404, description: 'Device not found' })
  async renameDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameDeviceDto,
    @Req() req: RequestWithUser,
  ): Promise<DeviceResponseDto> {
    const device = await this.pakService.renameDevice(req.user.userId, id, dto);
    return this.pakService.toDeviceResponse(device);
  }
}
