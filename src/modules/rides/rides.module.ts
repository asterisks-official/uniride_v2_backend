import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { RidesRepository } from './rides.repository';
import { QUEUE_RIDE_EXPIRY } from '../../jobs/queue.constants';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_RIDE_EXPIRY })],
  controllers: [RidesController],
  providers: [RidesService, RidesRepository],
  exports: [RidesService, RidesRepository],
})
export class RidesModule {}
