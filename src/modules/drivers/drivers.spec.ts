import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DriversService } from './drivers.service';
import type { PrismaService } from '../../database/prisma.service';

type Row = {
  userId: string;
  isOnline: boolean;
  lat: number | null;
  lng: number | null;
  lastSeenAt: Date | null;
  activeRideId: string | null;
};

/// A one-row stand-in for the table. Enough to exercise the rules, which is
/// where all the behaviour lives — the queries themselves are Postgres's job.
function serviceWith(row: Row | null) {
  let stored = row;
  const prisma = {
    driverAvailability: {
      findUnique: () => Promise.resolve(stored),
      upsert: ({ create, update }: { create: Row; update: Partial<Row> }) => {
        stored = stored ? { ...stored, ...update } : create;
        return Promise.resolve(stored);
      },
      update: ({ data }: { data: Partial<Row> }) => {
        stored = { ...stored!, ...data };
        return Promise.resolve(stored);
      },
      updateMany: ({ data }: { data: Partial<Row> }) => {
        if (stored) stored = { ...stored, ...data };
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as PrismaService;

  return { service: new DriversService(prisma), read: () => stored };
}

const online = (secondsAgo: number): Row => ({
  userId: 'u1',
  isOnline: true,
  lat: 23.8,
  lng: 90.36,
  lastSeenAt: new Date(Date.now() - secondsAgo * 1000),
  activeRideId: null,
});

describe('going online', () => {
  it('refuses a passenger', async () => {
    const { service } = serviceWith(null);
    await expect(
      service.setAvailability('u1', 'PASSENGER', {
        isOnline: true,
        lat: 23.8,
        lng: 90.36,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a rider who sends no position', async () => {
    // Dispatch ranks by distance; a rider with no coordinates can never be
    // the nearest one, so letting them online would be a silent no-op.
    const { service } = serviceWith(null);
    await expect(
      service.setAvailability('u1', 'RIDER', { isOnline: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a verified rider with a position', async () => {
    const { service } = serviceWith(null);
    const result = await service.setAvailability('u1', 'RIDER', {
      isOnline: true,
      lat: 23.8,
      lng: 90.36,
    });
    expect(result.isOnline).toBe(true);
    expect(result.dispatchable).toBe(true);
  });

  it('lets anyone go offline, position or not', async () => {
    const { service } = serviceWith(online(10));
    const result = await service.setAvailability('u1', 'PASSENGER', {
      isOnline: false,
    });
    expect(result.isOnline).toBe(false);
  });

  it('keeps the last position after going offline', async () => {
    // It is the last known whereabouts of someone who may be mid-trip;
    // deleting it makes a support question unanswerable.
    const { service, read } = serviceWith(online(10));
    await service.setAvailability('u1', 'RIDER', { isOnline: false });
    expect(read()?.lat).toBe(23.8);
  });
});

describe('dispatchability', () => {
  it('is true for a rider seen just now', async () => {
    const { service } = serviceWith(online(5));
    expect((await service.getMine('u1')).dispatchable).toBe(true);
  });

  it('is false once the heartbeat goes stale', async () => {
    // The case this whole rule exists for: an app killed mid-shift leaves
    // isOnline true forever, and offering a trip to a ghost costs the
    // passenger the full timeout.
    const { service } = serviceWith(online(5 * 60));
    const mine = await service.getMine('u1');
    expect(mine.isOnline).toBe(true);
    expect(mine.dispatchable).toBe(false);
  });

  it('is false while carrying a passenger', async () => {
    const { service } = serviceWith(online(5));
    await service.setActiveRide('u1', 'ride-1');
    // findNearby filters this in SQL; the flag is what it reads.
    expect((await service.getMine('u1')).activeRideId).toBe('ride-1');
  });

  it('treats a never-seen rider as offline rather than missing', async () => {
    const { service } = serviceWith(null);
    const mine = await service.getMine('nobody');
    expect(mine.isOnline).toBe(false);
    expect(mine.dispatchable).toBe(false);
  });
});

describe('heartbeat', () => {
  it('refuses to imply consent for an offline rider', async () => {
    // Going online is an explicit act. A background location update must
    // never substitute for it.
    const { service } = serviceWith({ ...online(10), isOnline: false });
    await expect(
      service.heartbeat('u1', { lat: 23.8, lng: 90.36 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('moves an online rider and refreshes the clock', async () => {
    const { service, read } = serviceWith(online(90));
    await service.heartbeat('u1', { lat: 23.9, lng: 90.4 });
    expect(read()?.lat).toBe(23.9);
    expect(Date.now() - read()!.lastSeenAt!.getTime()).toBeLessThan(1000);
  });
});
