import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanExpiredOtps(): Promise<void> {
    const { count } = await this.prisma.otpVerification.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) this.logger.log(`Deleted ${count} expired OTP record(s)`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanStaleRefreshTokens(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Delete tokens that are expired OR were revoked more than 7 days ago
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: sevenDaysAgo } },
        ],
      },
    });
    if (count > 0) this.logger.log(`Deleted ${count} stale refresh token(s)`);
  }
}
