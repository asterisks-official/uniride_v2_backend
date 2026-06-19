import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { RatingsRepository } from './ratings.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { RatingsQueryDto } from './dto/ratings-query.dto';
import {
  getPaginationParams,
  buildPaginationMeta,
} from '../../shared/utils/pagination.util';
import { QUEUE_TRUST_SCORE } from '../../jobs/queue.constants';
import type { TrustScoreJobData } from '../../jobs/processors/trust-score.processor';

@Injectable()
export class RatingsService {
  constructor(
    private readonly ratingsRepository: RatingsRepository,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(QUEUE_TRUST_SCORE) private readonly trustScoreQueue: Queue,
  ) {}

  async submitRating(raterId: string, dto: CreateRatingDto) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: dto.rideId },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.status !== 'COMPLETED')
      throw new BadRequestException('Can only rate completed rides');
    if (!ride.riderId || !ride.passengerId)
      throw new BadRequestException('Ride has no matched counterpart');

    const isRider = ride.riderId === raterId;
    const isPassenger = ride.passengerId === raterId;
    if (!isRider && !isPassenger)
      throw new ForbiddenException('You were not part of this ride');

    const rateeId = isRider ? ride.passengerId : ride.riderId;

    const existing = await this.ratingsRepository.findByRideAndRater(
      dto.rideId,
      raterId,
    );
    if (existing)
      throw new ConflictException('You have already rated this ride');

    const rating = await this.ratingsRepository.create({
      ride: { connect: { id: dto.rideId } },
      rater: { connect: { id: raterId } },
      ratee: { connect: { id: rateeId } },
      score: dto.score,
      review: dto.review,
      tags: dto.tags ?? [],
      isRevealed: false,
    });

    // Check if the other party has also rated → reveal both
    const otherRating = await this.ratingsRepository.findByRideAndRater(
      dto.rideId,
      rateeId,
    );
    if (otherRating) {
      await this.ratingsRepository.revealRideRatings(dto.rideId);
      await this.recalculateStats(rateeId);
      await this.recalculateStats(raterId);
      await this.trustScoreQueue.add('recalculate', {
        userId: rateeId,
      } satisfies TrustScoreJobData);
      await this.trustScoreQueue.add('recalculate', {
        userId: raterId,
      } satisfies TrustScoreJobData);
    }

    await this.notificationsService.send(
      rateeId,
      'RATING_RECEIVED',
      'New rating received',
      `You received a ${dto.score}-star rating`,
      { rideId: dto.rideId, score: dto.score },
    );

    return rating;
  }

  async getReceivedRatings(userId: string, query: RatingsQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const [ratings, total] = await Promise.all([
      this.ratingsRepository.findByRatee(userId, skip, take),
      this.ratingsRepository.countByRatee(userId),
    ]);
    return { ratings, pagination: buildPaginationMeta(total, page, limit) };
  }

  async getUserRatings(userId: string, query: RatingsQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const [ratings, total] = await Promise.all([
      this.ratingsRepository.findByRatee(userId, skip, take),
      this.ratingsRepository.countByRatee(userId),
    ]);
    return { ratings, pagination: buildPaginationMeta(total, page, limit) };
  }

  async getRideRatings(rideId: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== userId && ride.passengerId !== userId)
      throw new ForbiddenException();

    return this.prisma.rating.findMany({
      where: { rideId, isRevealed: true },
      include: {
        rater: { select: { id: true, name: true, profilePictureUrl: true } },
        ratee: { select: { id: true, name: true, profilePictureUrl: true } },
      },
    });
  }

  private async recalculateStats(userId: string) {
    const stats = await this.prisma.rating.aggregate({
      where: { rateeId: userId, isRevealed: true },
      _avg: { score: true },
      _count: { score: true },
    });

    await this.ratingsRepository.updateUserStats(userId, {
      averageRating: stats._avg.score ?? 0,
      totalRatings: stats._count.score,
    });
  }
}
