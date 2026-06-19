import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_RIDE_COMPLETION, QUEUE_TRUST_SCORE } from '../queue.constants';
import type { TrustScoreJobData } from './trust-score.processor';

export interface RideCompletionJobData {
  rideId: string;
}

@Processor(QUEUE_RIDE_COMPLETION)
export class RideCompletionProcessor extends WorkerHost {
  private readonly logger = new Logger(RideCompletionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_TRUST_SCORE) private readonly trustScoreQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<RideCompletionJobData>): Promise<void> {
    const { rideId } = job.data;

    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (
      !ride ||
      ride.status !== 'COMPLETED' ||
      !ride.riderId ||
      !ride.passengerId
    ) {
      this.logger.warn(
        `Skipping ride-completion job for ride ${rideId}: invalid state`,
      );
      return;
    }

    // Create cash payment record
    const existing = await this.prisma.payment.findFirst({ where: { rideId } });
    if (!existing) {
      await this.prisma.payment.create({
        data: {
          ride: { connect: { id: rideId } },
          payer: { connect: { id: ride.passengerId } },
          amount: ride.fare,
          currency: 'BDT',
          status: 'COMPLETED',
          // gatewayProvider and gatewayTxId intentionally null = cash payment
        },
      });
    }

    // Increment ridesCompleted for rider and passenger
    await Promise.all([
      this.prisma.userStats.upsert({
        where: { userId: ride.riderId },
        create: {
          userId: ride.riderId,
          ridesCompleted: 1,
          totalEarnings: ride.fare,
        },
        update: {
          ridesCompleted: { increment: 1 },
          totalEarnings: { increment: ride.fare },
        },
      }),
      this.prisma.userStats.upsert({
        where: { userId: ride.passengerId },
        create: { userId: ride.passengerId, ridesCompleted: 1 },
        update: { ridesCompleted: { increment: 1 } },
      }),
    ]);

    // Recalculate trust scores
    await Promise.all([
      this.trustScoreQueue.add('recalculate', {
        userId: ride.riderId,
      } satisfies TrustScoreJobData),
      this.trustScoreQueue.add('recalculate', {
        userId: ride.passengerId,
      } satisfies TrustScoreJobData),
    ]);

    this.logger.log(
      `Ride ${rideId} completion processed — payment + stats updated`,
    );
  }
}
