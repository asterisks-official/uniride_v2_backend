import { Controller, Get, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('my')
  @ApiOperation({ summary: 'List payments I made (as passenger)' })
  getMyPayments(@CurrentUser() user: JwtPayload, @Query('page') page?: number, @Query('limit') limit?: number) {
    return this.paymentsService.getMyPayments(user.sub, { page, limit });
  }

  @Get('earnings')
  @ApiOperation({ summary: 'Rider earnings summary (RIDER only)' })
  getEarnings(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.getEarnings(user.sub);
  }

  @Get('ride/:rideId')
  @ApiOperation({ summary: 'Get payment record for a specific ride' })
  getPaymentByRide(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.paymentsService.getPaymentByRide(user.sub, rideId);
  }
}
