import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type {
  Ride,
  RideRequest,
  Prisma,
  RequestStatus,
  Gender,
  GenderPreference,
} from '@prisma/client';

const riderSelect = {
  id: true,
  name: true,
  profilePictureUrl: true,
  stats: { select: { averageRating: true, ridesCompleted: true } },
} as const;

const passengerSelect = {
  id: true,
  name: true,
  profilePictureUrl: true,
} as const;

const requestPassengerSelect = {
  id: true,
  name: true,
  profilePictureUrl: true,
  stats: { select: { averageRating: true, ridesCompleted: true } },
} as const;

@Injectable()
export class RidesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /// Gender is needed to enforce a ride's GenderPreference, which until now
  /// was stored and filtered but never actually checked against the requester.
  async findRequesterGender(userId: string): Promise<Gender | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { gender: true },
    });
    return user?.gender ?? null;
  }

  /**
   * Everyone who should hear about a newly posted ride.
   *
   * The complementary side: a passenger's request goes to verified riders, a
   * rider's offer goes to passengers. Never the poster themselves.
   *
   * Gender-restricted rides are narrowed here rather than filtered after the
   * push is queued — a notification is a disclosure, and sending "Ayesha needs
   * a ride from Mirpur 10 at 8pm" to every man on the platform would leak
   * exactly what the restriction exists to prevent.
   */
  async findRecipientsForNewRide(params: {
    posterId: string;
    forRiders: boolean;
    genderPref: GenderPreference;
    universityId: string | null;
  }): Promise<{ id: string }[]> {
    const { posterId, forRiders, genderPref, universityId } = params;

    return this.prisma.user.findMany({
      where: {
        id: { not: posterId },
        deletedAt: null,
        isSuspended: false,
        isEmailVerified: true,
        ...(forRiders ? { role: 'RIDER' } : {}),
        // Scoped to the poster's university when they have one, so a DIU
        // student is not pinged about a trip at another campus.
        ...(universityId ? { universityId } : {}),
        // Fails closed, matching visibleGenderPrefs: nobody without a
        // recorded gender is told about a restricted ride.
        ...(genderPref === 'FEMALE_ONLY'
          ? { gender: 'FEMALE' }
          : genderPref === 'MALE_ONLY'
            ? { gender: 'MALE' }
            : {}),
      },
      select: { id: true },
      // A safety valve, not a ranking. One campus will never approach this;
      // if it ever does, that is the moment to notify by proximity instead of
      // notifying everyone.
      take: 500,
    });
  }

  async create(data: Prisma.RideCreateInput): Promise<Ride> {
    return this.prisma.ride.create({ data });
  }

  async findById(id: string): Promise<Ride | null> {
    return this.prisma.ride.findUnique({ where: { id } });
  }

  async findWithRelations(id: string) {
    return this.prisma.ride.findUnique({
      where: { id },
      include: {
        creator: { select: riderSelect },
        rider: { select: riderSelect },
        passenger: { select: passengerSelect },
        _count: { select: { requests: { where: { status: 'PENDING' } } } },
      },
    });
  }

  async findMany(args: Prisma.RideFindManyArgs): Promise<Ride[]> {
    return this.prisma.ride.findMany(args);
  }

  async count(args: Prisma.RideCountArgs): Promise<number> {
    return this.prisma.ride.count(args);
  }

  async update(id: string, data: Prisma.RideUpdateInput): Promise<Ride> {
    return this.prisma.ride.update({ where: { id }, data });
  }

  async findMyRidesAndCount(
    userId: string,
    role: 'rider' | 'passenger' | undefined,
    status: string | undefined,
    skip: number,
    take: number,
  ) {
    const statusFilter = status ? { status: status as Ride['status'] } : {};
    const roleFilter =
      role === 'rider'
        ? { riderId: userId }
        : role === 'passenger'
          ? { passengerId: userId }
          : { OR: [{ riderId: userId }, { passengerId: userId }] };

    const where: Prisma.RideWhereInput = { ...roleFilter, ...statusFilter };

    const [rides, total] = await this.prisma.$transaction([
      this.prisma.ride.findMany({
        where,
        skip,
        take,
        orderBy: { scheduledAt: 'desc' },
        include: {
          creator: { select: riderSelect },
          rider: { select: riderSelect },
          passenger: { select: passengerSelect },
        },
      }),
      this.prisma.ride.count({ where }),
    ]);

    return { rides, total };
  }

  // ── Requests ────────────────────────────────────────────────────────────────

  async createRequest(
    data: Prisma.RideRequestCreateInput,
  ): Promise<RideRequest> {
    return this.prisma.rideRequest.create({ data });
  }

  async findRequest(
    rideId: string,
    passengerId: string,
  ): Promise<RideRequest | null> {
    return this.prisma.rideRequest.findUnique({
      where: { rideId_passengerId: { rideId, passengerId } },
    });
  }

  async findRequestById(id: string): Promise<RideRequest | null> {
    return this.prisma.rideRequest.findUnique({ where: { id } });
  }

  async findRequests(rideId: string, status?: RequestStatus) {
    return this.prisma.rideRequest.findMany({
      where: { rideId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { passenger: { select: requestPassengerSelect } },
    });
  }

  async updateRequest(
    id: string,
    data: Prisma.RideRequestUpdateInput,
  ): Promise<RideRequest> {
    return this.prisma.rideRequest.update({ where: { id }, data });
  }

  async acceptRequestTx(
    rideId: string,
    requestId: string,
    requesterId: string,
    fillSide: 'rider' | 'passenger',
  ) {
    const fill =
      fillSide === 'rider'
        ? { riderId: requesterId }
        : { passengerId: requesterId };

    return this.prisma.$transaction([
      this.prisma.rideRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' },
      }),
      this.prisma.ride.update({
        where: { id: rideId },
        data: { status: 'MATCHED', ...fill },
      }),
      this.prisma.rideRequest.updateMany({
        where: { rideId, status: 'PENDING', id: { not: requestId } },
        data: { status: 'DECLINED' },
      }),
    ]);
  }
}
