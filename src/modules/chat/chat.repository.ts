import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { RideMessage, Prisma } from '@prisma/client';

@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMessage(
    data: Prisma.RideMessageCreateInput,
  ): Promise<RideMessage> {
    return this.prisma.rideMessage.create({ data });
  }

  async findMessages(
    rideId: string,
    skip: number,
    take: number,
  ): Promise<RideMessage[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.prisma.rideMessage.findMany({
      where: { rideId, createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async countMessages(rideId: string): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.prisma.rideMessage.count({
      where: { rideId, createdAt: { gte: sevenDaysAgo } },
    });
  }

  async deleteOldMessages(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await this.prisma.rideMessage.deleteMany({
      where: { createdAt: { lt: sevenDaysAgo } },
    });
  }
}
