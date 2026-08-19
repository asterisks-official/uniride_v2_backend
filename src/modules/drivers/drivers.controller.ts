import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DriversService } from './drivers.service';
import { SetAvailabilityDto, HeartbeatDto } from './dto/availability.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get('me/availability')
  @ApiOperation({
    summary: 'Own availability',
    description:
      '`dispatchable` is the one that matters: online *and* recently seen. ' +
      'An app killed mid-shift stays online with nothing to correct it.',
  })
  getMine(@CurrentUser() user: JwtPayload) {
    return this.drivers.getMine(user.sub);
  }

  @Post('me/availability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Go online or offline' })
  setAvailability(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.drivers.setAvailability(user.sub, user.role, dto);
  }

  @Post('me/location')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Position heartbeat while online',
    description:
      'Does not put anyone online — going online is an explicit act, and a ' +
      'background location update must never substitute for it.',
  })
  heartbeat(@CurrentUser() user: JwtPayload, @Body() dto: HeartbeatDto) {
    return this.drivers.heartbeat(user.sub, dto);
  }
}
