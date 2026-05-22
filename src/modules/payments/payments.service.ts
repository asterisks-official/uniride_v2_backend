import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PaymentsRepository } from './payments.repository';
import { PrismaService } from '../../database/prisma.service';
import { getPaginationParams, buildPaginationMeta } from '../../shared/utils/pagination.util';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getMyPayments(userId: string, query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const [payments, total] = await Promise.all([
      this.paymentsRepository.findByPayer(userId, skip, take),
      this.paymentsRepository.countByPayer(userId),
    ]);
    return { payments, pagination: buildPaginationMeta(total, page, limit) };
  }

  async getEarnings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.RIDER) {
      throw new ForbiddenException('Only riders have earnings');
    }
    return this.paymentsRepository.getRiderEarnings(userId);
  }

  async getPaymentByRide(userId: string, rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== userId && ride.passengerId !== userId) throw new ForbiddenException();

    const payment = await this.paymentsRepository.findByRide(rideId);
    if (!payment) throw new NotFoundException('No payment record for this ride');
    return payment;
  }
}
