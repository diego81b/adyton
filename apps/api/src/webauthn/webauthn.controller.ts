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
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WebauthnService } from './webauthn.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { setRefreshCookie } from '../auth/cookies';
import {
  WebauthnRegisterVerifyDto,
  WebauthnAuthenticateOptionsDto,
  WebauthnAuthenticateVerifyDto,
} from './dto/webauthn.dto';
import { PasskeyResponseDto } from './dto/passkey.response.dto';
import { AuthTokensResponseDto } from '../auth/dto/auth-tokens.response.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('webauthn')
@Controller('auth/webauthn')
export class WebauthnController {
  constructor(private readonly webauthnService: WebauthnService) {}

  @Post('register/options')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Start passkey registration (requires TOTP 2FA enabled)' })
  @ApiResponse({ status: 200, description: 'PublicKeyCredentialCreationOptionsJSON' })
  @ApiResponse({ status: 400, description: 'TOTP 2FA not enabled' })
  async registerOptions(@Req() req: RequestWithUser) {
    return this.webauthnService.registrationOptions(req.user.userId);
  }

  @Post('register/verify')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Complete passkey registration' })
  @ApiResponse({ status: 201, type: PasskeyResponseDto })
  @ApiResponse({ status: 400, description: 'Challenge expired or attestation invalid' })
  @ApiResponse({ status: 409, description: 'Passkey already registered' })
  async registerVerify(
    @Body() dto: WebauthnRegisterVerifyDto,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<PasskeyResponseDto> {
    return this.webauthnService.registrationVerify(
      req.user.userId,
      dto.response,
      dto.friendlyName,
      req.ip,
      ua ?? '',
    );
  }

  @Get('credentials')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List registered passkeys' })
  @ApiResponse({ status: 200, type: [PasskeyResponseDto] })
  async listCredentials(@Req() req: RequestWithUser): Promise<PasskeyResponseDto[]> {
    return this.webauthnService.listCredentials(req.user.userId);
  }

  @Delete('credentials/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Remove a passkey' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Passkey not found' })
  async removeCredential(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.webauthnService.removeCredential(req.user.userId, id, req.ip, ua ?? '');
  }

  @Post('authenticate/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get passkey assertion options for a pending-MFA login' })
  @ApiResponse({ status: 200, description: 'PublicKeyCredentialRequestOptionsJSON' })
  @ApiResponse({ status: 401, description: 'Invalid/expired MFA token or no passkeys' })
  async authenticateOptions(@Body() dto: WebauthnAuthenticateOptionsDto) {
    return this.webauthnService.authenticationOptions(dto.mfaToken);
  }

  @Post('authenticate/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a 2FA login with a passkey assertion; issues the token pair' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid/expired MFA token, bad assertion, or too many attempts' })
  async authenticateVerify(
    @Body() dto: WebauthnAuthenticateVerifyDto,
    @Req() req: FastifyRequest,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const deviceIdCookie = req.cookies?.['deviceId'];
    const result = await this.webauthnService.authenticationVerify(
      dto.mfaToken,
      dto.response,
      req.ip,
      ua ?? '',
      deviceIdCookie,
    );
    setRefreshCookie(res, result.rawRefreshToken);
    const response: Record<string, unknown> = { accessToken: result.accessToken, user: result.user };
    if (result.newDeviceId) {
      response['newDeviceOtp'] = result.newDeviceId;
    }
    return response;
  }
}
