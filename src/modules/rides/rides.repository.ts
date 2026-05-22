import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Ride, RideRequest, Prisma } from '@prisma/client';

@Injectable()
export class RidesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.RideCreateInput): Promise<Ride> {
    return this.prisma.ride.create({ data });
  }

  async findById(id: string): Promise<Ride | null> {
    return this.prisma.ride.findUnique({ where: { id } });
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

  async createRequest(data: Prisma.RideRequestCreateInput): Promise<RideRequest> {
    return this.prisma.rideRequest.create({ data });
  }

  async findRequest(rideId: string, passengerId: string): Promise<RideRequest | null> {
    return this.prisma.rideRequest.findUnique({
      where: { rideId_passengerId: { rideId, passengerId } },
    });
  }

  async findRequestById(id: string): Promise<RideRequest | null> {
    return this.prisma.rideRequest.findUnique({ where: { id } });
  }

  async updateRequest(id: string, data: Prisma.RideRequestUpdateInput): Promise<RideRequest> {
    return this.prisma.rideRequest.update({ where: { id }, data });
  }
}
