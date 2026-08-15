import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { VerifyRiderDto, VerifyAction } from './dto/verify-rider.dto';
import { ResolveReportDto, ResolveAction } from './dto/resolve-report.dto';
import { AdminRidesQueryDto } from './dto/admin-rides-query.dto';
import { AdminReportsQueryDto } from './dto/admin-reports-query.dto';
import {
  getPaginationParams,
  buildPaginationMeta,
} from '../../shared/utils/pagination.util';
import {
  MAX_RIDER_REJECTIONS,
  identitiesToBlock,
} from '../../shared/utils/identity';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Dashboard ──────────────────────────────────────────────────────────────

  async getDashboardStats() {
    const [
      totalUsers,
      totalRiders,
      totalRides,
      activeRides,
      pendingVerifications,
      openReports,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { role: 'RIDER', deletedAt: null } }),
      this.prisma.ride.count(),
      this.prisma.ride.count({
        where: { status: { in: ['SEARCHING', 'MATCHED', 'IN_PROGRESS'] } },
      }),
      this.prisma.riderProfile.count({
        where: { verificationStatus: 'PENDING' },
      }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
    ]);

    return {
      totalUsers,
      totalRiders,
      totalRides,
      activeRides,
      pendingVerifications,
      openReports,
    };
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async getUsers(query: AdminUsersQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.search) {
      where['OR'] = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.role) where['role'] = query.role;
    if (query.isSuspended !== undefined)
      where['isSuspended'] = query.isSuspended;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: where as never,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          university: true,
          isSuspended: true,
          suspendedReason: true,
          isEmailVerified: true,
          createdAt: true,
          stats: {
            select: {
              ridesCompleted: true,
              averageRating: true,
              trustScore: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where: where as never }),
    ]);

    return { users, pagination: buildPaginationMeta(total, page, limit) };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        riderProfile: true,
        stats: true,
        devices: {
          select: { fcmToken: true, deviceType: true, updatedAt: true },
        },
        _count: {
          select: {
            ridesAsRider: true,
            ridesAsPassenger: true,
            ratingsReceived: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async suspendUser(adminId: string, userId: string, dto: SuspendUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'SUPER_ADMIN')
      throw new ForbiddenException('Cannot suspend a super admin');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended: dto.suspend,
        suspendedReason: dto.suspend ? (dto.reason ?? null) : null,
      },
    });

    await this.logAudit(
      adminId,
      dto.suspend ? 'SUSPEND_USER' : 'UNSUSPEND_USER',
      'User',
      userId,
      { isSuspended: user.isSuspended },
      { isSuspended: dto.suspend, reason: dto.reason },
    );

    return updated;
  }

  // ── Rider verification ─────────────────────────────────────────────────────

  async getPendingRiders(query: { page?: number; limit?: number }) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const [riders, total] = await Promise.all([
      this.prisma.riderProfile.findMany({
        where: { verificationStatus: 'PENDING' },
        skip,
        take,
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              university: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.riderProfile.count({
        where: { verificationStatus: 'PENDING' },
      }),
    ]);
    return { riders, pagination: buildPaginationMeta(total, page, limit) };
  }

  async verifyRider(adminId: string, userId: string, dto: VerifyRiderDto) {
    const profile = await this.prisma.riderProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Rider profile not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const approving = dto.action === VerifyAction.APPROVE;
    const newStatus = approving ? 'APPROVED' : 'REJECTED';

    // Rejection is a strike. The third one is final: the applicant has had
    // three goes at producing genuine documents, and a fourth attempt under a
    // fresh email is the thing the ban list exists to stop.
    const rejectionCount = approving
      ? profile.rejectionCount
      : profile.rejectionCount + 1;
    const banned = !approving && rejectionCount >= MAX_RIDER_REJECTIONS;

    const banReason =
      `Rider application rejected ${MAX_RIDER_REJECTIONS} times` +
      (dto.note ? `. Last reason: ${dto.note}` : '');

    const [updated] = await this.prisma.$transaction([
      this.prisma.riderProfile.update({
        where: { userId },
        data: {
          verificationStatus: newStatus,
          adminNote: dto.note ?? null,
          rejectionCount,
          reviewedAt: new Date(),
          reviewedBy: adminId,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          // Approval is what actually grants the RIDER role; rejection (or
          // revocation of a previously approved rider) drops them back to
          // PASSENGER.
          role: approving ? 'RIDER' : 'PASSENGER',
          // Move the view along with the capability. On approval the user
          // wants the rider side immediately; on rejection or revocation they
          // must be pushed back, or they would keep browsing rider content
          // until their token expires.
          activeMode: approving ? 'RIDER' : 'PASSENGER',
          ...(banned && { isSuspended: true, suspendedReason: banReason }),
        },
      }),
      // Bans the identifiers, not just the login. createMany + skipDuplicates
      // because an identifier may already be listed from an earlier ban.
      ...(banned
        ? [
            this.prisma.blockedIdentity.createMany({
              data: identitiesToBlock(user).map((identity) => ({
                ...identity,
                reason: banReason,
                userId,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    await this.logAudit(
      adminId,
      `RIDER_${newStatus}`,
      'RiderProfile',
      profile.id,
      null,
      {
        status: newStatus,
        note: dto.note,
        rejectionCount,
        banned,
      },
    );

    const attemptsLeft = MAX_RIDER_REJECTIONS - rejectionCount;
    const reason = dto.note
      ? `Reason: ${dto.note}`
      : 'Please review your documents.';

    const notifType = approving
      ? 'VERIFICATION_APPROVED'
      : 'VERIFICATION_REJECTED';
    const notifTitle = approving
      ? 'Rider profile approved!'
      : banned
        ? 'Account blocked'
        : 'Rider application rejected';
    const notifBody = approving
      ? 'Your rider profile has been approved. You can now post ride offers.'
      : banned
        ? `${reason} This was your ${MAX_RIDER_REJECTIONS}th rejected application, so the account has been blocked.`
        : `${reason} You can correct your details and resubmit — ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`;

    await this.notificationsService.send(
      userId,
      notifType,
      notifTitle,
      notifBody,
    );

    return updated;
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  async getReports(query: AdminReportsQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.severity) where['severity'] = query.severity;

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where: where as never,
        skip,
        take,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        include: {
          reporter: { select: { id: true, name: true, email: true } },
          reported: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.report.count({ where: where as never }),
    ]);

    return { reports, pagination: buildPaginationMeta(total, page, limit) };
  }

  async resolveReport(
    adminId: string,
    reportId: string,
    dto: ResolveReportDto,
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');

    const newStatus =
      dto.action === ResolveAction.RESOLVE ? 'RESOLVED' : 'DISMISSED';

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: newStatus,
        adminNote: dto.note ?? null,
        resolvedAt: new Date(),
        resolvedBy: adminId,
      },
    });

    await this.logAudit(
      adminId,
      `REPORT_${newStatus}`,
      'Report',
      reportId,
      null,
      {
        status: newStatus,
        note: dto.note,
      },
    );

    return updated;
  }

  // ── Rides ──────────────────────────────────────────────────────────────────

  async getRides(query: AdminRidesQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where = query.status ? { status: query.status } : {};

    const [rides, total] = await Promise.all([
      this.prisma.ride.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          rider: { select: { id: true, name: true, email: true } },
          passenger: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.ride.count({ where }),
    ]);

    return { rides, pagination: buildPaginationMeta(total, page, limit) };
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  private async logAudit(
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.prisma.auditLog.create({
      data: {
        adminId,
        action,
        targetType,
        targetId,
        before: before as never,
        after: after as never,
      },
    });
  }
}
