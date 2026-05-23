import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';
import {
  getPaginationParams,
  buildPaginationMeta,
} from '../../shared/utils/pagination.util';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async submitReport(reporterId: string, dto: CreateReportDto) {
    if (dto.reportedId === reporterId)
      throw new ForbiddenException('Cannot report yourself');

    const reported = await this.prisma.user.findUnique({
      where: { id: dto.reportedId },
    });
    if (!reported) throw new NotFoundException('Reported user not found');

    if (dto.rideId) {
      const ride = await this.prisma.ride.findUnique({
        where: { id: dto.rideId },
      });
      if (!ride) throw new NotFoundException('Ride not found');
    }

    return this.prisma.report.create({
      data: {
        reporter: { connect: { id: reporterId } },
        reported: { connect: { id: dto.reportedId } },
        ...(dto.rideId && { rideId: dto.rideId }),
        type: dto.type,
        description: dto.description,
      },
    });
  }

  async getMyReports(userId: string, query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where: { reporterId: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          reported: {
            select: { id: true, name: true, profilePictureUrl: true },
          },
        },
      }),
      this.prisma.report.count({ where: { reporterId: userId } }),
    ]);
    return { reports, pagination: buildPaginationMeta(total, page, limit) };
  }
}
