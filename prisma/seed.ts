import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Same driver adapter PrismaService uses — Prisma 7 requires one explicitly.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Reference data the app cannot run without.
 *
 * Idempotent by design — this runs on every deploy, not once. Campuses are
 * upserted on (universityId, name) rather than on a generated id so re-running
 * never duplicates them and never churns the ids that rides point at.
 */

/**
 * Dhaka bike-share fare, per the product decision of 2026-08-17:
 *
 *   fare = max(40, 15 + 7 × km)
 *
 * `farePerMin` is deliberately zero. The formula still carries a time term —
 * the code and the column stay — but it is switched off, so distance alone
 * sets the price. Turning it back on is one number here and one UPDATE; no
 * deploy, because these are read at request time.
 *
 * Retune from real rides; see `uniride-implementation.md` §8 for what to
 * measure, now that the ±20% driver adjustment that would have calibrated
 * this for free is gone.
 */
const DIU_FARE = {
  fareBase: 15,
  farePerKm: 7,
  farePerMin: 0,
  // Only bites on short trips. Distinct from the base, which every trip pays.
  fareMinimum: 40,
};

/** Shared, non-university-specific constants. Runtime-tunable so pricing can
 *  be corrected without a deploy. */
const APP_CONFIG: Record<string, string> = {
  // Great-circle → road distance multiplier for Dhaka.
  'fare.roadFactor': '1.4',
  // Drives the duration term. Bike traffic, not car traffic.
  'fare.avgSpeedKmh': '18',
  // Proximity feed radius, in degrees (~2 km).
  'feed.radiusDeg': '0.018',
};

async function main() {
  const diu = await prisma.university.upsert({
    where: { shortName: 'DIU' },
    update: { ...DIU_FARE, isLive: true },
    create: {
      name: 'Daffodil International University',
      shortName: 'DIU',
      verifyDomains: ['diu.edu.bd', 's.diu.edu.bd'],
      requiresIdCard: true,
      isLive: true,
      ...DIU_FARE,
    },
  });

  const campuses = [
    {
      name: 'Ashulia',
      address: 'Daffodil Smart City, Ashulia, Savar, Dhaka',
      lat: 23.8759,
      lng: 90.3204,
    },
    {
      name: 'Dhanmondi',
      address: 'Sobhanbag, Dhanmondi, Dhaka',
      lat: 23.7509,
      lng: 90.3799,
    },
  ];

  for (const campus of campuses) {
    const existing = await prisma.campus.findFirst({
      where: { universityId: diu.id, name: campus.name },
    });
    if (existing) {
      await prisma.campus.update({ where: { id: existing.id }, data: campus });
    } else {
      await prisma.campus.create({
        data: { ...campus, universityId: diu.id },
      });
    }
  }

  for (const [key, value] of Object.entries(APP_CONFIG)) {
    await prisma.appConfig.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  // M2 backfill: resolve the legacy free-text university onto the new FK.
  // Anything unmatched stays NULL and keeps seeing every live university,
  // which is exactly today's behaviour.
  const matched = await prisma.user.updateMany({
    where: {
      universityId: null,
      university: {
        in: [
          'DIU',
          'Daffodil International University',
          'Daffodil',
          'daffodil international university',
        ],
      },
    },
    data: { universityId: diu.id },
  });

  console.log(
    `Seeded ${diu.shortName} (${campuses.length} campuses), ` +
      `${Object.keys(APP_CONFIG).length} config keys, ` +
      `backfilled ${matched.count} users.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
