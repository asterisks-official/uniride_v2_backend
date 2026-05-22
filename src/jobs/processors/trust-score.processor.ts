import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_TRUST_SCORE } from '../queue.constants';

export interface TrustScoreJobData {
  userId: string;
}

@Processor(QUEUE_TRUST_SCORE)
export class TrustScoreProcessor extends WorkerHost {
  private readonly logger = new Logger(TrustScoreProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<TrustScoreJobData>): Promise<void> {
    const { userId } = job.data;

    const stats = await this.prisma.userStats.findUnique({ where: { userId } });
    if (!stats) return;

    const base = 50;
    const rideBonus = Math.min(stats.ridesCompleted, 20);
    const ratingBonus = stats.totalRatings > 0 ? (stats.averageRating - 3) * 10 : 0;
    const cancellationPenalty = Math.min(stats.ridesCancelled, 10) * 2;

    const trustScore = Math.min(100, Math.max(0, base + rideBonus + ratingBonus - cancellationPenalty));

    await this.prisma.userStats.update({
      where: { userId },
      data: { trustScore: Math.round(trustScore) },
    });

    this.logger.log(`TrustScore updated for ${userId}: ${Math.round(trustScore)}`);
  }
}
