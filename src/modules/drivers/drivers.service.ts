import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SetAvailabilityDto, HeartbeatDto } from './dto/availability.dto';

export interface NearbyDriver {
  userId: string;
  lat: number;
  lng: number;
  distanceKm: number;
}

/**
 * Who is available to be dispatched to, and where they are.
 *
 * The whole module exists to answer one question — "who could take this trip
 * right now?" — and the honest answer is narrower than the `isOnline` flag
 * suggests. See [STALE_AFTER_MS].
 */
@Injectable()
export class DriversService {
  /**
   * How long a rider stays dispatchable after their last heartbeat.
   *
   * An app killed mid-shift, a phone that lost signal, or a battery that died
   * all leave `isOnline = true` behind with nothing to correct it. Offering a
   * trip to a ghost costs the passenger the full offer timeout and then some,
   * which is the difference between "matched in 20 seconds" and "this app
   * never finds anyone".
   *
   * Two minutes is roughly four missed heartbeats at the 30s interval the app
   * uses — long enough to survive a tunnel, short enough that a dead phone
   * drops out before it can waste anybody's time.
   */
  static readonly STALE_AFTER_MS = 2 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async getMine(userId: string) {
    const row = await this.prisma.driverAvailability.findUnique({
      where: { userId },
    });

    // Never seen is the same as offline, and saying so beats a 404 the client
    // would have to special-case on first launch.
    if (!row) {
      return {
        isOnline: false,
        lat: null,
        lng: null,
        lastSeenAt: null,
        activeRideId: null,
        dispatchable: false,
      };
    }
    return { ...row, dispatchable: this.isDispatchable(row) };
  }

  async setAvailability(
    userId: string,
    role: UserRole,
    dto: SetAvailabilityDto,
  ) {
    if (dto.isOnline && role !== 'RIDER') {
      throw new ForbiddenException(
        'Only verified riders can go online. Complete rider verification first.',
      );
    }
    if (dto.isOnline && (dto.lat === undefined || dto.lng === undefined)) {
      throw new BadRequestException(
        'Share your location to go online — riders are matched by distance.',
      );
    }

    const now = new Date();
    const row = await this.prisma.driverAvailability.upsert({
      where: { userId },
      create: {
        userId,
        isOnline: dto.isOnline,
        lat: dto.lat,
        lng: dto.lng,
        lastSeenAt: dto.isOnline ? now : null,
      },
      update: {
        isOnline: dto.isOnline,
        // Going offline keeps the last position rather than nulling it: it is
        // the last known whereabouts of someone who may be mid-trip, and
        // deleting it makes a support question unanswerable.
        ...(dto.isOnline && { lat: dto.lat, lng: dto.lng, lastSeenAt: now }),
      },
    });

    return { ...row, dispatchable: this.isDispatchable(row) };
  }

  /**
   * A position update from an online rider.
   *
   * Deliberately does *not* flip anyone online. A heartbeat is evidence of
   * where someone is, not consent to be dispatched to — going online is an
   * explicit act, and a background location update must never substitute for
   * it.
   */
  async heartbeat(userId: string, dto: HeartbeatDto) {
    const existing = await this.prisma.driverAvailability.findUnique({
      where: { userId },
      select: { isOnline: true },
    });
    if (!existing?.isOnline) {
      throw new BadRequestException('Go online before sending your location.');
    }

    return this.prisma.driverAvailability.update({
      where: { userId },
      data: { lat: dto.lat, lng: dto.lng, lastSeenAt: new Date() },
    });
  }

  /** Called by the trip lifecycle so dispatch skips a rider mid-trip. */
  async setActiveRide(userId: string, rideId: string | null) {
    await this.prisma.driverAvailability.updateMany({
      where: { userId },
      data: { activeRideId: rideId },
    });
  }

  /**
   * Online, free, recently seen riders near a point — nearest first.
   *
   * Bounding box first so the index does the narrowing, then haversine for the
   * ordering. Same shape the proximity feed uses; Prisma cannot express the
   * distance term, hence the raw query.
   */
  async findNearby(
    lat: number,
    lng: number,
    radiusKm: number,
    limit = 10,
  ): Promise<NearbyDriver[]> {
    // Degrees of latitude are ~111 km everywhere; longitude shrinks with
    // latitude, so the box is widened rather than squared.
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    const freshSince = new Date(Date.now() - DriversService.STALE_AFTER_MS);

    return this.prisma.$queryRaw<NearbyDriver[]>`
      SELECT
        d.user_id AS "userId",
        d.lat,
        d.lng,
        6371 * acos(
          LEAST(1, cos(radians(${lat})) * cos(radians(d.lat))
                 * cos(radians(d.lng) - radians(${lng}))
                 + sin(radians(${lat})) * sin(radians(d.lat)))
        ) AS "distanceKm"
      FROM driver_availability d
      JOIN users u ON u.id = d.user_id
      WHERE d.is_online = true
        AND d.active_ride_id IS NULL
        AND d.last_seen_at > ${freshSince}
        AND d.lat BETWEEN ${lat - latDelta} AND ${lat + latDelta}
        AND d.lng BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}
        AND u.deleted_at IS NULL
        AND u.is_suspended = false
        AND u.role = 'RIDER'
      ORDER BY "distanceKm" ASC
      LIMIT ${limit}
    `;
  }

  /** Online is a claim; dispatchable is that claim still being fresh. */
  private isDispatchable(row: {
    isOnline: boolean;
    lat: number | null;
    lastSeenAt: Date | null;
  }): boolean {
    if (!row.isOnline || row.lat === null || !row.lastSeenAt) return false;
    return (
      Date.now() - row.lastSeenAt.getTime() < DriversService.STALE_AFTER_MS
    );
  }
}
