import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Payment, Prisma } from '@prisma/client';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.PaymentCreateInput): Promise<Payment> {
    return this.prisma.payment.create({ data });
  }

  async findByPayer(payerId: string, skip: number, take: number) {
    return this.prisma.payment.findMany({
      where: { payerId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { ride: { select: { originAddress: true, destAddress: true, scheduledAt: true } } },
    });
  }

  async countByPayer(payerId: string): Promise<number> {
    return this.prisma.payment.count({ where: { payerId } });
  }

  async findByRide(rideId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({ where: { rideId } });
  }

  async getRiderEarnings(riderId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [total, thisMonth, lastMonth, rideCount] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { ride: { riderId }, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ride: { riderId }, status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          ride: { riderId },
          status: 'COMPLETED',
          createdAt: { gte: startOfLastMonth, lt: startOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.count({ where: { ride: { riderId }, status: 'COMPLETED' } }),
    ]);

    return {
      totalEarnings: total._sum.amount ?? 0,
      thisMonth: thisMonth._sum.amount ?? 0,
      lastMonth: lastMonth._sum.amount ?? 0,
      completedRides: rideCount,
      currency: 'BDT',
    };
  }
}
