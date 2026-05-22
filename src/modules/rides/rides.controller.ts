import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RidesService } from './rides.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { SearchRidesDto } from './dto/search-rides.dto';
import { UpdateRideDto } from './dto/update-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { RespondRequestDto } from './dto/respond-request.dto';
import { MyRidesDto } from './dto/my-rides.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('rides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  // ── List own rides (must be before /:id) ───────────────────────────────────

  @Get('my')
  @ApiOperation({ summary: 'Get my rides (as rider or passenger)' })
  getMyRides(@CurrentUser() user: JwtPayload, @Query() dto: MyRidesDto) {
    return this.ridesService.getMyRides(user.sub, dto);
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Search available rides' })
  searchRides(@Query() dto: SearchRidesDto) {
    return this.ridesService.searchRides(dto);
  }

  // ── Create (RIDER only) ────────────────────────────────────────────────────

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.RIDER)
  @ApiOperation({ summary: 'Create a ride offer (RIDER only)' })
  @ApiResponse({ status: 403, description: 'RIDER role required' })
  createRide(@CurrentUser() user: JwtPayload, @Body() dto: CreateRideDto) {
    return this.ridesService.createRide(user.sub, dto);
  }

  // ── Get by id ──────────────────────────────────────────────────────────────

  @Get(':rideId')
  @ApiOperation({ summary: 'Get ride details' })
  @ApiResponse({ status: 404, description: 'Ride not found' })
  getRide(@Param('rideId', ParseUUIDPipe) rideId: string) {
    return this.ridesService.getRide(rideId);
  }

  // ── Update (RIDER only) ────────────────────────────────────────────────────

  @Patch(':rideId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RIDER)
  @ApiOperation({ summary: 'Update ride (RIDER, SEARCHING status only)' })
  updateRide(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: UpdateRideDto,
  ) {
    return this.ridesService.updateRide(user.sub, rideId, dto);
  }

  // ── Cancel (RIDER only) ────────────────────────────────────────────────────

  @Delete(':rideId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.RIDER)
  @ApiOperation({ summary: 'Cancel a ride (RIDER only)' })
  cancelRide(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: CancelRideDto,
  ) {
    return this.ridesService.cancelRide(user.sub, rideId, dto);
  }

  // ── Request to join ────────────────────────────────────────────────────────

  @Post(':rideId/requests')
  @ApiOperation({ summary: 'Request to join a ride (PASSENGER)' })
  requestRide(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: RequestRideDto,
  ) {
    return this.ridesService.requestRide(user.sub, rideId, dto);
  }

  // ── View requests (RIDER only) ─────────────────────────────────────────────

  @Get(':rideId/requests')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RIDER)
  @ApiOperation({ summary: 'Get pending requests for a ride (RIDER only)' })
  getRideRequests(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.ridesService.getRideRequests(user.sub, rideId);
  }

  // ── Accept / Decline request (RIDER only) ──────────────────────────────────

  @Patch(':rideId/requests/:requestId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RIDER)
  @ApiOperation({ summary: 'Accept or decline a join request (RIDER only)' })
  respondToRequest(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RespondRequestDto,
  ) {
    return this.ridesService.respondToRequest(user.sub, rideId, requestId, dto);
  }

  // ── Start ride (RIDER only) ────────────────────────────────────────────────

  @Patch(':rideId/start')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RIDER)
  @ApiOperation({ summary: 'Start a matched ride (RIDER only)' })
  startRide(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.ridesService.startRide(user.sub, rideId);
  }

  // ── Confirm completion (rider or passenger) ────────────────────────────────

  @Patch(':rideId/confirm')
  @ApiOperation({ summary: 'Confirm ride completion (both sides must confirm)' })
  confirmRide(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.ridesService.confirmRide(user.sub, rideId);
  }
}
