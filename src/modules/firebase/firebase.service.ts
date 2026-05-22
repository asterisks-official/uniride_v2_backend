import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.config.get<string>('firebase.projectId');
    const privateKey = this.config.get<string>('firebase.privateKey');
    const clientEmail = this.config.get<string>('firebase.clientEmail');

    if (!projectId || !privateKey || privateKey === 'REPLACE_ME' || !clientEmail) {
      this.logger.warn('Firebase credentials not configured — FCM push disabled');
      return;
    }

    // Avoid re-initialising if app already exists (hot-reload)
    this.app =
      admin.apps.find((a) => a?.name === 'uniride') ??
      admin.initializeApp(
        {
          credential: admin.credential.cert({ projectId, privateKey, clientEmail }),
        },
        'uniride',
      );

    this.logger.log(`Firebase Admin initialised (project: ${projectId})`);
  }

  get isReady(): boolean {
    return this.app !== null;
  }

  async sendMulticast(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.app || tokens.length === 0) return;

    const validTokens = tokens.filter(Boolean);
    if (validTokens.length === 0) return;

    const message: admin.messaging.MulticastMessage = {
      tokens: validTokens,
      notification: { title, body },
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
      ...(data && { data }),
    };

    try {
      const result = await this.app.messaging().sendEachForMulticast(message);
      const failed = result.responses.filter((r) => !r.success);
      if (failed.length > 0) {
        this.logger.warn(`FCM: ${result.successCount} sent, ${failed.length} failed`);
      } else {
        this.logger.debug(`FCM: ${result.successCount} notification(s) delivered`);
      }
    } catch (err) {
      this.logger.error('FCM sendEachForMulticast error', err);
    }
  }
}
