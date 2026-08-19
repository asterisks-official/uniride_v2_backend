import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  controllers: [DriversController],
  providers: [DriversService],
  // Dispatch asks this module who is available; the trip lifecycle tells it
  // who has become busy.
  exports: [DriversService],
})
export class DriversModule {}
