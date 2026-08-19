import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RouteProvider, type LatLng } from './route.provider';

export interface FareQuote {
  distanceKm: number;
  durationMin: number;

  /// The route the price was computed over, as [lat, lng] pairs. Present when
  /// a router produced one, absent when the distance was estimated — the
  /// preview draws a straight line in that case rather than implying a path
  /// nobody worked out.
  polyline?: [number, number][];
  base: number;
  perKm: number;
  perMin: number;
  total: number;
  currency: string;

  /// True when the trip was short enough that the floor set the price rather
  /// than the distance. Surfaced so the app can say so — otherwise a 1 km and
  /// a 3 km trip costing the same reads as a bug.
  minimumApplied: boolean;
}

export interface FareCoefficients {
  fareBase: Prisma.Decimal | number;
  farePerKm: Prisma.Decimal | number;
  farePerMin: Prisma.Decimal | number;
  fareMinimum?: Prisma.Decimal | number;
}

/**
 * Turns two points into a price.
 *
 * `fare = max(minimum, base + perKm × km + perMin × min)`
 *
 * The floor is not the base fare by another name: the base is added to every
 * trip, while the minimum only bites on short ones. Without it a one-kilometre
 * hop prices at barely more than the base, and no rider will cross town, wait,
 * and carry someone for that.
 *
 * Neither the rider nor the passenger names a fare — the client sends
 * coordinates and receives a number. Two consequences that are easy to lose:
 *
 * 1. The client never computes this. Two devices would disagree, and the
 *    disagreement would surface as one party seeing a different price.
 * 2. The result is *snapshotted* onto the ride at creation and never
 *    recomputed for display. Coefficients are runtime-tunable, so recomputing
 *    would silently reprice completed rides every time someone calibrates.
 */
@Injectable()
export class FareService {
  private static readonly CURRENCY = 'BDT';

  constructor(private readonly routes: RouteProvider) {}

  async quote(
    from: LatLng,
    to: LatLng,
    coefficients: FareCoefficients,
  ): Promise<FareQuote> {
    const { km, min, polyline } = await this.routes.route(from, to);

    const base = toNumber(coefficients.fareBase);
    const perKm = toNumber(coefficients.farePerKm);
    const perMin = toNumber(coefficients.farePerMin);
    const minimum = toNumber(coefficients.fareMinimum ?? 0);

    // Rounded to whole taka: a fare of ৳117.43 is not a price anyone quotes,
    // and the rounding has to happen server-side so the stored total and the
    // displayed total are the same number.
    const computed = Math.round(base + perKm * km + perMin * min);
    const total = Math.max(computed, minimum);

    return {
      distanceKm: km,
      durationMin: min,
      polyline,
      base,
      perKm,
      perMin,
      total,
      currency: FareService.CURRENCY,
      minimumApplied: total > computed,
    };
  }
}

function toNumber(value: Prisma.Decimal | number): number {
  return typeof value === 'number' ? value : Number(value);
}
