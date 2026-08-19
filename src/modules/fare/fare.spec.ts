import { FareService } from './fare.service';
import {
  EstimateRouteProvider,
  haversineKm,
  RouteProvider,
} from './route.provider';
import { AppConfigService } from './app-config.service';

/** Stands in for the app_config table with whatever the test needs. */
function configWith(values: Record<string, number>): AppConfigService {
  return {
    getNumber: (key: string, fallback: number) =>
      Promise.resolve(values[key] ?? fallback),
  } as unknown as AppConfigService;
}

const MIRPUR_10 = { lat: 23.8069, lng: 90.3668 };
const DIU_ASHULIA = { lat: 23.8759, lng: 90.3204 };

describe('haversineKm', () => {
  it('measures a known Dhaka hop', () => {
    // Mirpur 10 → DIU Ashulia is ~9 km as the crow flies.
    expect(haversineKm(MIRPUR_10, DIU_ASHULIA)).toBeCloseTo(9.0, 0);
  });

  it('is zero for a point against itself', () => {
    expect(haversineKm(MIRPUR_10, MIRPUR_10)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineKm(MIRPUR_10, DIU_ASHULIA)).toBeCloseTo(
      haversineKm(DIU_ASHULIA, MIRPUR_10),
      9,
    );
  });
});

describe('EstimateRouteProvider', () => {
  it('inflates the straight line by the road factor', async () => {
    const provider = new EstimateRouteProvider(
      configWith({ 'fare.roadFactor': 1.4, 'fare.avgSpeedKmh': 18 }),
    );
    const { km } = await provider.route(MIRPUR_10, DIU_ASHULIA);
    expect(km).toBeCloseTo(haversineKm(MIRPUR_10, DIU_ASHULIA) * 1.4, 1);
  });

  it('derives duration from average speed', async () => {
    const provider = new EstimateRouteProvider(
      configWith({ 'fare.roadFactor': 1, 'fare.avgSpeedKmh': 60 }),
    );
    const { km, min } = await provider.route(MIRPUR_10, DIU_ASHULIA);
    expect(min).toBe(Math.round(km));
  });

  it('falls back rather than dividing by a zeroed config row', async () => {
    // A bad config value must not make every fare Infinity.
    const provider = new EstimateRouteProvider(
      configWith({ 'fare.roadFactor': 1.4, 'fare.avgSpeedKmh': 0 }),
    );
    const { min } = await provider.route(MIRPUR_10, DIU_ASHULIA);
    expect(Number.isFinite(min)).toBe(true);
    expect(min).toBeGreaterThan(0);
  });
});

describe('FareService', () => {
  /** A provider returning a fixed route, so the arithmetic is the only thing
   *  under test. */
  const fixedRoute = (km: number, min: number): RouteProvider => ({
    route: () => Promise.resolve({ km, min }),
  });

  const coefficients = { fareBase: 25, farePerKm: 12, farePerMin: 1.5 };

  it('applies base + distance + time', async () => {
    const fare = new FareService(fixedRoute(10, 30));
    const quote = await fare.quote(MIRPUR_10, DIU_ASHULIA, coefficients);

    // 25 + 12×10 + 1.5×30 = 190
    expect(quote.total).toBe(190);
    expect(quote.distanceKm).toBe(10);
    expect(quote.durationMin).toBe(30);
  });

  it('rounds to whole taka — nobody quotes ৳117.43', async () => {
    const fare = new FareService(fixedRoute(3.33, 11));
    const quote = await fare.quote(MIRPUR_10, DIU_ASHULIA, coefficients);
    expect(Number.isInteger(quote.total)).toBe(true);
  });

  it('charges the base fare on a zero-length trip', async () => {
    const fare = new FareService(fixedRoute(0, 0));
    const quote = await fare.quote(MIRPUR_10, MIRPUR_10, coefficients);
    expect(quote.total).toBe(25);
  });

  it('accepts Prisma Decimal coefficients, not just numbers', async () => {
    // University.fare* come back as Decimal; string coercion would silently
    // concatenate rather than add.
    const fare = new FareService(fixedRoute(10, 0));
    const quote = await fare.quote(MIRPUR_10, DIU_ASHULIA, {
      fareBase: { toString: () => '25' } as never,
      farePerKm: { toString: () => '12' } as never,
      farePerMin: { toString: () => '0' } as never,
    });
    expect(quote.total).toBe(145);
  });

  describe('the minimum', () => {
    const withMin = { ...coefficients, fareMinimum: 40 };

    it('floors a short trip that would price below it', async () => {
      // 25 + 12×1 = 37, under the floor.
      const fare = new FareService(fixedRoute(1, 0));
      const quote = await fare.quote(MIRPUR_10, DIU_ASHULIA, withMin);
      expect(quote.total).toBe(40);
      expect(quote.minimumApplied).toBe(true);
    });

    it('leaves a longer trip alone', async () => {
      const fare = new FareService(fixedRoute(10, 0));
      const quote = await fare.quote(MIRPUR_10, DIU_ASHULIA, withMin);
      expect(quote.total).toBe(145);
      expect(quote.minimumApplied).toBe(false);
    });

    it('is not applied when it exactly equals the computed fare', async () => {
      // 25 + 12×1.25 = 40 exactly. Saying the floor "applied" here would be
      // true but misleading — nothing was raised.
      const fare = new FareService(fixedRoute(1.25, 0));
      const quote = await fare.quote(MIRPUR_10, DIU_ASHULIA, withMin);
      expect(quote.total).toBe(40);
      expect(quote.minimumApplied).toBe(false);
    });

    it('defaults to no floor when the university has none', async () => {
      const fare = new FareService(fixedRoute(1, 0));
      const quote = await fare.quote(MIRPUR_10, DIU_ASHULIA, coefficients);
      expect(quote.total).toBe(37);
      expect(quote.minimumApplied).toBe(false);
    });
  });

  it('returns the components so the client can show them, never recompute', async () => {
    const fare = new FareService(fixedRoute(8.4, 25));
    const quote = await fare.quote(MIRPUR_10, DIU_ASHULIA, coefficients);
    expect(quote).toMatchObject({
      base: 25,
      perKm: 12,
      perMin: 1.5,
      currency: 'BDT',
    });
  });
});
