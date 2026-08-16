import {
  Injectable,
  ConflictException,
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
import { AdminRidersQueryDto } from './dto/admin-riders-query.dto';
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

  async getPendingRiders(query: AdminRidersQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    // Defaults to the queue. A reviewer who cannot look up what they decided
    // yesterday has to ask someone, so the other two statuses are reachable by
    // the same endpoint rather than being invisible.
    const status = query.status ?? 'PENDING';
    // Oldest first while reviewing (fairness — first in, first seen); newest
    // first when looking back, since a decision you want is usually a recent one.
    const orderBy =
      status === 'PENDING'
        ? ({ createdAt: 'asc' } as const)
        : ({ reviewedAt: 'desc' } as const);

    const [riders, total] = await Promise.all([
      this.prisma.riderProfile.findMany({
        where: { verificationStatus: status },
        skip,
        take,
        orderBy,
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
        where: { verificationStatus: status },
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

    // Deciding the same way twice is refused. Without this, two admins working
    // the same queue entry — or one double-click — burn two of the applicant's
    // three attempts for a single mistake, and the third is a permanent ban.
    // A rejected applicant has to resubmit (which returns them to PENDING)
    // before another decision is meaningful.
    if (profile.verificationStatus === newStatus) {
      throw new ConflictException(
        approving
          ? 'This rider is already approved.'
          : 'This application has already been rejected. They must resubmit before it can be reviewed again.',
      );
    }

    // A strike is a *failed application*, so only a rejection out of review
    // counts as one. Revoking an already-approved rider is a different act —
    // the admin changed their mind, the applicant did not submit anything bad —
    // and must not push someone toward a ban they never earned.
    const isApplicationRejection =
      !approving && profile.verificationStatus === 'PENDING';

    // The third strike is final: the applicant has had three goes at producing
    // genuine documents, and a fourth attempt under a fresh email is the thing
    // the ban list exists to stop.
    const rejectionCount = isApplicationRejection
      ? profile.rejectionCount + 1
      : profile.rejectionCount;
    // Tied to isApplicationRejection, not just !approving: a revocation must never
    // be the thing that triggers a permanent ban.
    const banned =
      isApplicationRejection && rejectionCount >= MAX_RIDER_REJECTIONS;

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

  /**
   * Lifts a three-strike ban: clears the blocklist entries, un-suspends the
   * account and resets the strike count.
   *
   * The ban is the most consequential thing an admin can do here — it stops the
   * person's email, student ID *and* phone from ever registering again — and
   * until this existed, undoing one meant hand-written SQL across three tables.
   * An irreversible mistake is a much worse thing to ship than a recoverable one.
   */
  async unblockRider(adminId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { riderProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const blocked = await this.prisma.blockedIdentity.findMany({
      where: { userId },
    });
    if (blocked.length === 0 && !user.isSuspended) {
      throw new ConflictException('This account is not blocked.');
    }

    await this.prisma.$transaction([
      this.prisma.blockedIdentity.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { isSuspended: false, suspendedReason: null },
      }),
      // Reset the strikes too. Leaving them at 3 would mean the next rejection
      // re-bans immediately, which is not what "unblock" means to the admin
      // pressing it.
      ...(user.riderProfile
        ? [
            this.prisma.riderProfile.update({
              where: { userId },
              data: { rejectionCount: 0, adminNote: null },
            }),
          ]
        : []),
    ]);

    await this.logAudit(
      adminId,
      'UNBLOCK_RIDER',
      'User',
      userId,
      {
        isSuspended: user.isSuspended,
        rejectionCount: user.riderProfile?.rejectionCount ?? null,
        blockedIdentities: blocked.map((entry) => entry.type),
      },
      { isSuspended: false, rejectionCount: 0, blockedIdentities: [] },
    );

    await this.notificationsService.send(
      userId,
      'SYSTEM',
      'Your account has been restored',
      'An admin has lifted the block on your account. You can apply to become a rider again.',
    );

    return { message: 'Account unblocked', clearedIdentities: blocked.length };
  }

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
