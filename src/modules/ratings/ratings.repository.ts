import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Rating, UserStats, Prisma } from '@prisma/client';

@Injectable()
export class RatingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.RatingCreateInput): Promise<Rating> {
    return this.prisma.rating.create({ data });
  }

  async findByRideAndRater(
    rideId: string,
    raterId: string,
  ): Promise<Rating | null> {
    return this.prisma.rating.findUnique({
      where: { rideId_raterId: { rideId, raterId } },
    });
  }

  async findByRatee(
    rateeId: string,
    skip: number,
    take: number,
  ): Promise<Rating[]> {
    return this.prisma.rating.findMany({
      where: { rateeId, isRevealed: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countByRatee(rateeId: string): Promise<number> {
    return this.prisma.rating.count({ where: { rateeId, isRevealed: true } });
  }

  async revealRideRatings(rideId: string): Promise<void> {
    await this.prisma.rating.updateMany({
      where: { rideId },
      data: { isRevealed: true },
    });
  }

  async updateUserStats(
    userId: string,
    data: Prisma.UserStatsUpdateInput,
  ): Promise<UserStats> {
    return this.prisma.userStats.update({ where: { userId }, data });
  }

  async getUserStats(userId: string): Promise<UserStats | null> {
    return this.prisma.userStats.findUnique({ where: { userId } });
  }
}
