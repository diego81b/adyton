import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UserSettingsResponseDto } from './dto/user-settings.response.dto';

type RequestWithUser = FastifyRequest & { user: JwtUser };

@ApiTags('settings')
@ApiBearerAuth('access-token')
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user settings (defaults merged with stored overrides)' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getSettings(@Req() req: RequestWithUser): Promise<UserSettingsResponseDto> {
    return this.settingsService.getSettings(req.user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Update user settings (partial merge — absent fields preserved)' })
  @ApiResponse({ status: 200, type: UserSettingsResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  updateSettings(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<UserSettingsResponseDto> {
    return this.settingsService.updateSettings(req.user.userId, dto);
  }
}
