import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_RIDE_EXPIRY } from '../queue.constants';

export interface RideExpiryJobData {
  rideId: string;
}

@Processor(QUEUE_RIDE_EXPIRY)
export class RideExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(RideExpiryProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<RideExpiryJobData>): Promise<void> {
    const { rideId } = job.data;

    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== 'SEARCHING') return;

    await this.prisma.ride.update({
      where: { id: rideId },
      data: { status: 'EXPIRED' },
    });

    this.logger.log(`Ride ${rideId} expired (was SEARCHING at scheduledAt)`);
  }
}
