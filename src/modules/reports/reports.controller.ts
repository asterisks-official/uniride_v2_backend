import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'Report a user' })
  submitReport(@CurrentUser() user: JwtPayload, @Body() dto: CreateReportDto) {
    return this.reportsService.submitReport(user.sub, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get reports I have submitted' })
  getMyReports(
    @CurrentUser() user: JwtPayload,
    @Query() query: { page?: number; limit?: number },
  ) {
    return this.reportsService.getMyReports(user.sub, query);
  }
}
