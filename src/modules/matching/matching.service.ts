import { Injectable } from '@nestjs/common';
import { haversineDistanceKm } from '../../shared/utils/geo.util';
import type { Ride, UserStats } from '@prisma/client';

export interface MatchScore {
  rideId: string;
  score: number;
}

@Injectable()
export class MatchingService {
  score(
    ride: Ride,
    requester: {
      originLat: number;
      originLng: number;
      destLat: number;
      destLng: number;
    },
    riderStats: UserStats | null,
  ): number {
    const originDist = haversineDistanceKm(
      requester.originLat,
      requester.originLng,
      ride.originLat,
      ride.originLng,
    );
    const destDist = haversineDistanceKm(
      requester.destLat,
      requester.destLng,
      ride.destLat,
      ride.destLng,
    );

    const originScore = Math.max(0, 100 - originDist * 20) * 0.35;
    const destScore = Math.max(0, 100 - destDist * 20) * 0.25;
    const trustScore = (riderStats?.trustScore ?? 50) * 0.1;
    const ratingScore = (riderStats?.averageRating ?? 3) * 20 * 0.05;

    return originScore + destScore + trustScore + ratingScore;
  }
}
