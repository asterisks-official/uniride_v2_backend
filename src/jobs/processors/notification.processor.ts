import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseService } from '../../modules/firebase/firebase.service';
import { QUEUE_NOTIFICATIONS } from '../queue.constants';

export interface NotificationJobData {
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
  notificationId: string;
}

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { userId, title, body, type, data, notificationId } = job.data;

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { deliveredAt: new Date() },
    });

    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { fcmToken: true },
    });

    if (devices.length === 0) {
      this.logger.debug(`No FCM tokens for user ${userId} — skipping push`);
      return;
    }

    const tokens = devices.map((d) => d.fcmToken).filter(Boolean) as string[];

    // Flatten data to Record<string, string> as FCM requires string values
    const fcmData: Record<string, string> = { type };
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && v !== undefined) fcmData[k] = String(v);
      }
    }

    await this.firebase.sendMulticast(tokens, title, body, fcmData);
  }
}
