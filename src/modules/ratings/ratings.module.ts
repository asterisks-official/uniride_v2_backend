import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';
import { RatingsRepository } from './ratings.repository';
import { NotificationsModule } from '../notifications/notifications.module';
import { QUEUE_TRUST_SCORE } from '../../jobs/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_TRUST_SCORE }),
    NotificationsModule,
  ],
  controllers: [RatingsController],
  providers: [RatingsService, RatingsRepository],
  exports: [RatingsService],
})
export class RatingsModule {}
