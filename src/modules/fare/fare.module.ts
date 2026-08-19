import { Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { FareService } from './fare.service';
import {
  EstimateRouteProvider,
  OsrmRouteProvider,
  RouteProvider,
} from './route.provider';

@Module({
  providers: [
    AppConfigService,
    // The estimate stays registered in its own right: OSRM falls back to it
    // whenever routing is unavailable, so it is a collaborator now rather
    // than only an alternative.
    EstimateRouteProvider,
    // Bound by token, so replacing OSRM with a Distance Matrix later is a
    // one-line change here and nowhere else.
    { provide: RouteProvider, useClass: OsrmRouteProvider },
    FareService,
  ],
  exports: [FareService, AppConfigService],
})
export class FareModule {}
