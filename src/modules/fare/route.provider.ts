import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Route {
  km: number;
  min: number;

  /// The path, as [lat, lng] pairs, when a router produced one. Absent when
  /// the distance was estimated rather than routed — the preview then falls
  /// back to a straight line, which is honest about what it knows.
  polyline?: [number, number][];
}

/**
 * How far apart two points are, and how long the trip takes.
 *
 * An interface rather than a function so the estimate below can be swapped for
 * OSRM or a Distance Matrix without touching the fare service or any screen.
 * That swap is expected — see `uniride-implementation.md` §4.5.
 */
export abstract class RouteProvider {
  abstract route(from: LatLng, to: LatLng): Promise<Route>;
}

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance. Exported because the proximity feed needs the same
 *  maths in SQL and the two must not drift. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  // Clamp before asin: floating-point error on antipodal-ish inputs can push
  // sqrt(h) a hair over 1, which returns NaN and silently voids a fare.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line distance inflated by a road factor, and duration derived from
 * an average speed.
 *
 * The fallback when routing is unavailable, and still the source of the
 * duration even when it is not. Both constants are runtime config, because the
 * only honest way to set them is to calibrate against real completed rides.
 */
@Injectable()
export class EstimateRouteProvider extends RouteProvider {
  /** Dhaka roads vs. the crow's flight. */
  private static readonly DEFAULT_ROAD_FACTOR = 1.4;
  /** Bike traffic, not car traffic. */
  static readonly DEFAULT_AVG_SPEED_KMH = 18;

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async route(from: LatLng, to: LatLng): Promise<Route> {
    const [roadFactor, avgSpeedKmh] = await Promise.all([
      this.config.getNumber(
        'fare.roadFactor',
        EstimateRouteProvider.DEFAULT_ROAD_FACTOR,
      ),
      this.config.getNumber(
        'fare.avgSpeedKmh',
        EstimateRouteProvider.DEFAULT_AVG_SPEED_KMH,
      ),
    ]);

    const km = haversineKm(from, to) * roadFactor;
    // Guard the divisor: a zeroed config row would otherwise make every fare
    // Infinity, which is a worse outcome than an obviously wrong constant.
    const speed =
      avgSpeedKmh > 0
        ? avgSpeedKmh
        : EstimateRouteProvider.DEFAULT_AVG_SPEED_KMH;

    return {
      km: round(km, 2),
      min: Math.round((km / speed) * 60),
    };
  }
}

// Declared after the estimate on purpose: a decorator's parameter
// metadata is evaluated at class-definition time, and referencing a
// class declared further down the file throws at import.
/**
 * Real roads from OSRM, with the duration still derived locally.
 *
 * Two halves, deliberately:
 *
 * - **Distance comes from the router.** The haversine × 1.4 estimate below
 *   under-reads Dhaka by around 20% on a typical campus run — 12.6 km against
 *   a real 15.3 — and that gap is money.
 * - **Duration does not.** OSRM's estimate is free-flow car routing: 23
 *   minutes for a trip that takes a bike closer to 50 in Dhaka traffic. The
 *   configured average speed is a worse model of physics and a much better
 *   model of this city.
 *
 * Falls back to the pure estimate whenever the router is unreachable, slow, or
 * cannot find a path — a ride must never fail to price because a third party
 * is down.
 *
 * The public OSRM instance is for development, same as the tiles and Photon.
 * Before launch it is self-hosted or replaced.
 */
@Injectable()
export class OsrmRouteProvider extends RouteProvider {
  private readonly logger = new Logger(OsrmRouteProvider.name);

  private static readonly BASE = 'https://router.project-osrm.org';
  private static readonly TIMEOUT_MS = 4000;

  constructor(
    private readonly config: AppConfigService,
    private readonly estimate: EstimateRouteProvider,
  ) {
    super();
  }

  async route(from: LatLng, to: LatLng): Promise<Route> {
    try {
      const url =
        `${OsrmRouteProvider.BASE}/route/v1/driving/` +
        `${from.lng},${from.lat};${to.lng},${to.lat}` +
        // Simplified rather than full: 31 points instead of 426, which is
        // plenty for a 150px preview and keeps the quote response small on a
        // screen that re-quotes as you type.
        `?overview=simplified&geometries=geojson`;

      const res = await fetch(url, {
        signal: AbortSignal.timeout(OsrmRouteProvider.TIMEOUT_MS),
      });
      if (!res.ok) return this.estimate.route(from, to);

      const body = (await res.json()) as {
        code?: string;
        routes?: {
          distance?: number;
          geometry?: { coordinates?: [number, number][] };
        }[];
      };

      const route = body.code === 'Ok' ? body.routes?.[0] : undefined;
      if (route?.distance === undefined) return this.estimate.route(from, to);

      const km = round(route.distance / 1000, 2);
      const avgSpeedKmh = await this.config.getNumber(
        'fare.avgSpeedKmh',
        EstimateRouteProvider.DEFAULT_AVG_SPEED_KMH,
      );
      const speed =
        avgSpeedKmh > 0
          ? avgSpeedKmh
          : EstimateRouteProvider.DEFAULT_AVG_SPEED_KMH;

      return {
        km,
        min: Math.round((km / speed) * 60),
        // GeoJSON is [lng, lat]; every map library here wants [lat, lng].
        polyline: (route.geometry?.coordinates ?? []).map(
          ([lng, lat]) => [lat, lng] as [number, number],
        ),
      };
    } catch (err) {
      this.logger.warn('OSRM unreachable; using the straight-line estimate', err);
      return this.estimate.route(from, to);
    }
  }
}

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
