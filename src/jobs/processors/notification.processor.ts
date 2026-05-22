import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NOTIFICATIONS } from '../queue.constants';

export interface NotificationJobData {
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
}

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  async process(job: Job<NotificationJobData>): Promise<void> {
    this.logger.log(`Processing notification job ${job.id} for user ${job.data.userId}`);
    // Phase 3: implement FCM push notification dispatch
  }
}
