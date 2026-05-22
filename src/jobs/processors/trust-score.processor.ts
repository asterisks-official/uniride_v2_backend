import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_TRUST_SCORE } from '../queue.constants';

export interface TrustScoreJobData {
  userId: string;
}

@Processor(QUEUE_TRUST_SCORE)
export class TrustScoreProcessor extends WorkerHost {
  private readonly logger = new Logger(TrustScoreProcessor.name);

  async process(job: Job<TrustScoreJobData>): Promise<void> {
    this.logger.log(`Processing trust-score job ${job.id} for user ${job.data.userId}`);
    // Phase 4: recalculate user trust score from ratings + completion rate
  }
}
