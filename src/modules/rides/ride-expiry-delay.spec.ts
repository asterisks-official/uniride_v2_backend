import { expiryDelayMs, INSTANT_SEARCH_WINDOW_MS } from './rides.service';

describe('expiryDelayMs', () => {
  const now = new Date('2026-08-19T10:00:00Z');

  it('gives an INSTANT ride the search window, not zero', () => {
    // An instant ride's scheduledAt IS the posting moment, so the scheduled
    // formula yields 0 and the expiry worker killed every "leaving now" post
    // the second it was born — the rider saw their fresh offer as expired.
    expect(expiryDelayMs('INSTANT', now, now)).toBe(INSTANT_SEARCH_WINDOW_MS);
    expect(expiryDelayMs('INSTANT', now, now)).toBeGreaterThan(0);
  });

  it('expires a SCHEDULED ride at its departure time', () => {
    const departure = new Date('2026-08-19T18:00:00Z');
    expect(expiryDelayMs('SCHEDULED', departure, now)).toBe(
      departure.getTime() - now.getTime(),
    );
  });

  it('never returns a negative delay for a past departure', () => {
    const past = new Date('2026-08-19T09:00:00Z');
    expect(expiryDelayMs('SCHEDULED', past, now)).toBe(0);
  });
});
