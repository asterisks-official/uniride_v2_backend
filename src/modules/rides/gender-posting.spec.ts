import { ForbiddenException } from '@nestjs/common';
import type { Gender, GenderPreference } from '@prisma/client';
import { RidesService } from './rides.service';

/**
 * Posting is the third door into a gender restriction, after seeing and
 * joining. It was the one left open: a man could post a FEMALE_ONLY offer, the
 * join check would admit only women, and a woman would accept it believing the
 * driver was female — the preference actively misleading the people it exists
 * to protect.
 */
describe('who may post a gender-restricted ride', () => {
  /// Reaches the private guard directly. Standing up the whole service means
  /// a queue, a notifications module and a fare service, none of which this
  /// rule touches.
  function guardFor(gender: Gender | null) {
    const service = Object.create(RidesService.prototype) as RidesService;
    Object.assign(service, {
      ridesRepository: { findRequesterGender: () => Promise.resolve(gender) },
    });
    return (pref: GenderPreference | undefined) =>
      (
        service as unknown as {
          assertMayRestrictByGender: (
            id: string,
            pref: GenderPreference | undefined,
          ) => Promise<void>;
        }
      ).assertMayRestrictByGender('user-1', pref);
  }

  it('lets a woman post a women-only ride', async () => {
    await expect(guardFor('FEMALE')('FEMALE_ONLY')).resolves.toBeUndefined();
  });

  it('lets a man post a men-only ride', async () => {
    await expect(guardFor('MALE')('MALE_ONLY')).resolves.toBeUndefined();
  });

  it('refuses a man posting a women-only ride', async () => {
    await expect(guardFor('MALE')('FEMALE_ONLY')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a woman posting a men-only ride', async () => {
    await expect(guardFor('FEMALE')('MALE_ONLY')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses OTHER either restriction', async () => {
    // Inherited from the join check, kept identical so the two cannot
    // disagree about who a restricted ride is for.
    await expect(guardFor('OTHER')('FEMALE_ONLY')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guardFor('OTHER')('MALE_ONLY')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('fails closed when no gender is recorded, and says why', async () => {
    await expect(guardFor(null)('FEMALE_ONLY')).rejects.toThrow(
      /Add your gender/,
    );
  });

  it('never blocks an unrestricted ride', async () => {
    for (const gender of ['MALE', 'FEMALE', 'OTHER', null] as const) {
      await expect(guardFor(gender)('ANY')).resolves.toBeUndefined();
      await expect(guardFor(gender)(undefined)).resolves.toBeUndefined();
    }
  });
});
