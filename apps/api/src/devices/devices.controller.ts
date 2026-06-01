import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { TrustedDeviceResponseDto } from './dto/trusted-device.response.dto';
import { RegisterDeviceResponseDto } from './dto/register-device.response.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('devices')
@ApiBearerAuth('access-token')
@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @ApiOperation({ summary: 'List trusted devices' })
  @ApiResponse({ status: 200, type: [TrustedDeviceResponseDto] })
  async listDevices(@Req() req: RequestWithUser) {
    return this.devicesService.listDevices(req.user.userId);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register device using one-time OTP from login' })
  @ApiResponse({ status: 201, type: RegisterDeviceResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const rawDeviceId = await this.devicesService.registerDevice(
      req.user.userId,
      dto.otp,
      ua ?? '',
      req.ip,
    );

    res.setCookie('deviceId', rawDeviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as 'lax' | 'strict',
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
    });

    return { deviceId: rawDeviceId };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a specific device' })
  @ApiParam({ name: 'id', description: 'Device UUID' })
  @ApiResponse({ status: 204, description: 'Device revoked' })
  async revokeDevice(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.devicesService.revokeDevice(req.user.userId, id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all devices' })
  @ApiResponse({ status: 204 })
  async revokeAllDevices(@Req() req: RequestWithUser): Promise<void> {
    await this.devicesService.revokeAllDevices(req.user.userId);
  }
}
