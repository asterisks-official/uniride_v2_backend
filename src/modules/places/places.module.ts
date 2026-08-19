import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';
import { GeocodingController } from './geocoding.controller';
import { GeocodingService } from './geocoding.service';

@Module({
  // Two controllers: /saved-places is the user's own list, /places is the
  // lookup that fills it. Same domain, different lifetimes.
  controllers: [PlacesController, GeocodingController],
  providers: [PlacesService, GeocodingService],
  // Rides marks a place as used when it is posted from.
  exports: [PlacesService, GeocodingService],
})
export class PlacesModule {}
