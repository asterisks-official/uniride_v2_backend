import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RatingsService } from './ratings.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { RatingsQueryDto } from './dto/ratings-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('ratings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a rating after a completed ride' })
  submitRating(@CurrentUser() user: JwtPayload, @Body() dto: CreateRatingDto) {
    return this.ratingsService.submitRating(user.sub, dto);
  }

  @Get('received')
  @ApiOperation({ summary: 'Get ratings you have received' })
  getReceivedRatings(
    @CurrentUser() user: JwtPayload,
    @Query() query: RatingsQueryDto,
  ) {
    return this.ratingsService.getReceivedRatings(user.sub, query);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get public ratings for any user' })
  getUserRatings(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: RatingsQueryDto,
  ) {
    return this.ratingsService.getUserRatings(userId, query);
  }

  @Get('ride/:rideId')
  @ApiOperation({
    summary:
      'Get ratings for a specific ride (visible to ride participants only)',
  })
  getRideRatings(
    @CurrentUser() user: JwtPayload,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.ratingsService.getRideRatings(rideId, user.sub);
  }
}
