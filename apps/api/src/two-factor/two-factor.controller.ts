import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TwoFactorService } from './two-factor.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { setRefreshCookie } from '../auth/cookies';
import { EnableTwoFactorDto } from './dto/enable-two-factor.dto';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { RegenerateRecoveryCodesDto } from './dto/regenerate-recovery-codes.dto';
import { AuthenticateTwoFactorDto } from './dto/authenticate-two-factor.dto';
import { TwoFactorSetupResponseDto } from './dto/two-factor-setup.response.dto';
import { RecoveryCodesResponseDto } from './dto/recovery-codes.response.dto';
import { AuthTokensResponseDto } from '../auth/dto/auth-tokens.response.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('2fa')
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Start TOTP enrollment (returns secret + QR; pending until /enable)' })
  @ApiResponse({ status: 200, type: TwoFactorSetupResponseDto })
  @ApiResponse({ status: 409, description: '2FA already enabled' })
  async setup(@Req() req: RequestWithUser): Promise<TwoFactorSetupResponseDto> {
    return this.twoFactorService.setup(req.user.userId);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Confirm enrollment with a valid TOTP code; returns recovery codes (once)' })
  @ApiResponse({ status: 200, type: RecoveryCodesResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid code' })
  @ApiResponse({ status: 409, description: '2FA already enabled' })
  async enable(
    @Body() dto: EnableTwoFactorDto,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<RecoveryCodesResponseDto> {
    const recoveryCodes = await this.twoFactorService.enable(req.user.userId, dto.code, req.ip, ua ?? '');
    return { recoveryCodes };
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Disable 2FA (password required); wipes secret + recovery codes' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 401, description: 'Wrong password' })
  async disable(
    @Body() dto: DisableTwoFactorDto,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.twoFactorService.disable(req.user.userId, dto.password, req.ip, ua ?? '');
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Regenerate recovery codes (password required); invalidates previous codes' })
  @ApiResponse({ status: 200, type: RecoveryCodesResponseDto })
  @ApiResponse({ status: 401, description: 'Wrong password' })
  async regenerateRecoveryCodes(
    @Body() dto: RegenerateRecoveryCodesDto,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<RecoveryCodesResponseDto> {
    const recoveryCodes = await this.twoFactorService.regenerateRecoveryCodes(
      req.user.userId,
      dto.password,
      req.ip,
      ua ?? '',
    );
    return { recoveryCodes };
  }

  @Post('authenticate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a 2FA login with a TOTP or recovery code; issues the token pair' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid/expired MFA token, wrong code, or too many attempts' })
  async authenticate(
    @Body() dto: AuthenticateTwoFactorDto,
    @Req() req: FastifyRequest,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const deviceIdCookie = req.cookies?.['deviceId'];
    const result = await this.twoFactorService.authenticate(dto, req.ip, ua ?? '', deviceIdCookie);
    setRefreshCookie(res, result.rawRefreshToken);
    const response: Record<string, unknown> = { accessToken: result.accessToken, user: result.user };
    if (result.newDeviceId) {
      response['newDeviceOtp'] = result.newDeviceId;
    }
    return response;
  }
}
