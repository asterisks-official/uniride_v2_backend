import {
  DHAKA_AREAS,
  distanceToAreaKm,
  nearestArea,
  searchAreas,
} from './dhaka-areas';

/**
 * The fallback that keeps place search working with no Google key — local
 * development, CI, a spent quota, or an outage. Worth testing precisely
 * because it is the path nobody exercises by hand.
 */
describe('dhaka areas fallback', () => {
  describe('searchAreas', () => {
    it('ranks a prefix match above a mere substring', () => {
      const results = searchAreas('mirpur');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name.startsWith('Mirpur')).toBe(true);
    });

    it('is case-insensitive and ignores padding', () => {
      expect(searchAreas('  UTTARA ').length).toBeGreaterThan(0);
    });

    it('returns nothing for an empty query rather than everything', () => {
      expect(searchAreas('   ')).toHaveLength(0);
    });

    it('respects the limit', () => {
      expect(searchAreas('a', 3).length).toBeLessThanOrEqual(3);
    });
  });

  describe('nearestArea', () => {
    it('resolves a coordinate to the area it sits in', () => {
      // DIU Ashulia's own coordinates.
      expect(nearestArea(23.8944, 90.3167).name).toBe('Ashulia');
    });

    it('resolves Mirpur 10 to itself', () => {
      expect(nearestArea(23.8069, 90.3668).name).toBe('Mirpur 10');
    });
  });

  describe('distanceToAreaKm', () => {
    it('is ~zero at the area centre', () => {
      const area = nearestArea(23.8069, 90.3668);
      expect(distanceToAreaKm(23.8069, 90.3668, area)).toBeLessThan(0.1);
    });

    it('is large enough far out to suppress a confident label', () => {
      // Bay of Bengal. Nothing here should be named a Dhaka neighbourhood.
      const area = nearestArea(21.0, 90.0);
      expect(distanceToAreaKm(21.0, 90.0, area)).toBeGreaterThan(100);
    });
  });

  it('keeps every seeded area inside a Dhaka-ish bounding box', () => {
    // Catches a transposed or fat-fingered coordinate, which would otherwise
    // only show up as a nonsense fare.
    for (const area of DHAKA_AREAS) {
      expect(area.lat).toBeGreaterThan(23.5);
      expect(area.lat).toBeLessThan(24.1);
      expect(area.lng).toBeGreaterThan(90.1);
      expect(area.lng).toBeLessThan(90.6);
    }
  });

  it('has no duplicate names — ids are derived from them', () => {
    const names = DHAKA_AREAS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
