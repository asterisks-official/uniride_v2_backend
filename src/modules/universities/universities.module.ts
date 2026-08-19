import { Module } from '@nestjs/common';
import { UniversitiesController } from './universities.controller';
import { UniversitiesService } from './universities.service';

@Module({
  controllers: [UniversitiesController],
  providers: [UniversitiesService],
  // Rides needs campus coordinates and fare coefficients to price a ride.
  exports: [UniversitiesService],
})
export class UniversitiesModule {}
