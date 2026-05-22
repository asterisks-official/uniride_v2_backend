import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_RIDE_EXPIRY } from '../queue.constants';

export interface RideExpiryJobData {
  rideId: string;
}

@Processor(QUEUE_RIDE_EXPIRY)
export class RideExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(RideExpiryProcessor.name);

  async process(job: Job<RideExpiryJobData>): Promise<void> {
    this.logger.log(`Processing ride-expiry job ${job.id} for ride ${job.data.rideId}`);
    // Phase 3: mark expired rides as CANCELLED if still PENDING/ACTIVE
  }
}
