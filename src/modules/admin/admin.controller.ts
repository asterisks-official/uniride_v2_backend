import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { VerifyRiderDto } from './dto/verify-rider.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { AdminRidesQueryDto } from './dto/admin-rides-query.dto';
import { AdminReportsQueryDto } from './dto/admin-reports-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Dashboard ──────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard stats' })
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List all users (searchable, filterable)' })
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminService.getUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get full profile of any user' })
  getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend or unsuspend a user' })
  suspendUser(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.adminService.suspendUser(admin.sub, id, dto);
  }

  // ── Rider verification ─────────────────────────────────────────────────────

  @Get('riders/pending')
  @ApiOperation({ summary: 'List pending rider verification requests' })
  getPendingRiders(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.adminService.getPendingRiders({ page, limit });
  }

  @Patch('riders/:userId/verify')
  @ApiOperation({ summary: 'Approve or reject a rider profile' })
  verifyRider(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: VerifyRiderDto,
  ) {
    return this.adminService.verifyRider(admin.sub, userId, dto);
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  @Get('reports')
  @ApiOperation({ summary: 'List all reports' })
  getReports(@Query() query: AdminReportsQueryDto) {
    return this.adminService.getReports(query);
  }

  @Patch('reports/:id')
  @ApiOperation({ summary: 'Resolve or dismiss a report' })
  resolveReport(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.adminService.resolveReport(admin.sub, id, dto);
  }

  // ── Rides ──────────────────────────────────────────────────────────────────

  @Get('rides')
  @ApiOperation({ summary: 'List all rides' })
  getRides(@Query() query: AdminRidesQueryDto) {
    return this.adminService.getRides(query);
  }
}
