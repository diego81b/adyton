import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { setRefreshCookie, clearRefreshCookie } from './cookies';
import { ChallengeService } from './challenge/challenge.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshGuard } from './guards/refresh.guard';
import { RefreshToken } from '../entities/refresh-token.entity';
import { JwtUser } from './strategies/jwt.strategy';
import { ChallengeResponseDto } from './dto/challenge.response.dto';
import { AuthTokensResponseDto } from './dto/auth-tokens.response.dto';
import { UserProfileResponseDto } from './dto/user-profile.response.dto';

type RequestWithRefreshToken = FastifyRequest & { refreshToken: RefreshToken };
type RequestWithUser = FastifyRequest & { user: JwtUser };


@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly challengeService: ChallengeService,
  ) {}

  @Get('challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a PoW challenge (only when ENABLE_POW=true)' })
  @ApiResponse({ status: 200, description: 'Challenge issued', type: ChallengeResponseDto })
  @ApiResponse({ status: 404, description: 'PoW not enabled' })
  async getChallenge() {
    if (process.env.ENABLE_POW !== 'true') {
      throw new NotFoundException('PoW not enabled');
    }
    return this.challengeService.issueChallenge();
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({ status: 201, description: 'User registered, tokens issued', type: AuthTokensResponseDto })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: FastifyRequest,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.authService.register(dto, req.ip, ua ?? '');
    setRefreshCookie(res, result.rawRefreshToken);
    const response: Record<string, unknown> = { accessToken: result.accessToken, user: result.user };
    if (result.newDeviceId) {
      response['newDeviceOtp'] = result.newDeviceId;
    }
    return response;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login (returns { requiresMfa, mfaToken } when 2FA is enabled)' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto, description: 'Tokens issued, or MFA challenge { requiresMfa: true, mfaToken } for 2FA-enabled accounts' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or rate-limited' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const deviceIdCookie = req.cookies?.['deviceId'];
    const result = await this.authService.login(dto, req.ip, ua ?? '', deviceIdCookie);
    if ('requiresMfa' in result) {
      // No tokens, no cookie: the client must complete /auth/2fa/authenticate.
      return { requiresMfa: true, mfaToken: result.mfaToken, methods: result.methods };
    }
    setRefreshCookie(res, result.rawRefreshToken);
    const response: Record<string, unknown> = { accessToken: result.accessToken, user: result.user };
    if (result.newDeviceId) {
      response['newDeviceOtp'] = result.newDeviceId;
    }
    return response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RefreshGuard)
  @ApiOperation({ summary: 'Rotate refresh token' })
  @ApiCookieAuth('refreshToken')
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token missing, expired, or revoked' })
  async refresh(
    @Req() req: RequestWithRefreshToken,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.authService.refresh(req.refreshToken, req.ip, ua ?? '');
    setRefreshCookie(res, result.rawRefreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RefreshGuard)
  @ApiOperation({ summary: 'Logout' })
  @ApiCookieAuth('refreshToken')
  @ApiResponse({ status: 204 })
  async logout(
    @Req() req: RequestWithRefreshToken,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    await this.authService.logout(req.refreshToken, req.ip, ua ?? '');
    clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: UserProfileResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@Req() req: RequestWithUser) {
    return this.authService.getMe(req.user.userId);
  }

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Permanently delete the authenticated account (password required)' })
  @ApiResponse({ status: 204, description: 'Account deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized or wrong password' })
  async deleteAccount(
    @Body() dto: DeleteAccountDto,
    @Req() req: RequestWithUser,
    @Headers('user-agent') ua: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    await this.authService.deleteAccount(req.user.userId, dto.password, req.ip, ua ?? '');
    clearRefreshCookie(res);
  }
}
