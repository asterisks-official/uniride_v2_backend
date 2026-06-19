import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Ride, RideRequest, Prisma, RequestStatus } from '@prisma/client';

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
