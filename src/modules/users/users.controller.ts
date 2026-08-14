import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateRiderProfileDto } from './dto/create-rider-profile.dto';
import { UpdateRiderProfileDto } from './dto/update-rider-profile.dto';
import { SwitchModeDto } from './dto/switch-mode.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── Own profile ────────────────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Get own profile with stats' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile' })
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete own account' })
  deleteMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.deleteMe(user.sub);
  }

  @Post('me/active-mode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Switch between passenger and rider mode',
    description:
      'Changes only which side of the market is browsed; the rider capability itself is admin-granted and untouched. Returns a new token pair, because the mode is carried in the JWT — the client must replace its stored tokens and clear any cached feed.',
  })
  @ApiResponse({ status: 200, description: 'Mode switched; new tokens issued' })
  @ApiResponse({
    status: 403,
    description: 'Rider mode requested without an approved rider profile',
  })
  switchMode(@CurrentUser() user: JwtPayload, @Body() dto: SwitchModeDto) {
    return this.usersService.switchMode(user.sub, dto);
  }

  // ── Public profile ─────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get public profile of any user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getPublicProfile(id);
  }

  // ── Rider profile ──────────────────────────────────────────────────────────

  @Get('me/rider-profile')
  @ApiOperation({ summary: 'Get own rider profile' })
  getRiderProfile(@CurrentUser() user: JwtPayload) {
    return this.usersService.getRiderProfile(user.sub);
  }

  @Post('me/rider-profile')
  @ApiOperation({ summary: 'Create rider profile — promotes role to RIDER' })
  @ApiResponse({ status: 409, description: 'Rider profile already exists' })
  createRiderProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRiderProfileDto,
  ) {
    return this.usersService.createRiderProfile(user.sub, dto);
  }

  @Patch('me/rider-profile')
  @ApiOperation({ summary: 'Update rider profile' })
  updateRiderProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateRiderProfileDto,
  ) {
    return this.usersService.updateRiderProfile(user.sub, dto);
  }
}
