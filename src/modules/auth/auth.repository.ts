import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type {
  User,
  RefreshToken,
  OtpVerification,
  BlockedIdentity,
  BlockedIdentityType,
  Prisma,
} from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /// Returns the first blocked identifier among [identities], or null.
  async findBlockedIdentity(
    identities: { type: BlockedIdentityType; value: string }[],
  ): Promise<BlockedIdentity | null> {
    if (identities.length === 0) return null;
    return this.prisma.blockedIdentity.findFirst({ where: { OR: identities } });
  }

  /// Whether another live account already uses this student ID.
  ///
  /// Compared on the normalised form, in SQL, so `221-15-6029` and `221156029`
  /// cannot become two accounts — matching how the ban list compares them.
  /// [exceptEmail] skips the caller's own row, which is what lets someone
  /// re-register an unverified signup of their own.
  async isStudentIdTaken(
    normalised: string,
    exceptEmail: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
       WHERE deleted_at IS NULL
         AND lower(email) <> lower(${exceptEmail})
         AND student_id_number IS NOT NULL
         AND lower(regexp_replace(student_id_number, '[^a-zA-Z0-9]', '', 'g'))
             = ${normalised}
       LIMIT 1`;
    return rows.length > 0;
  }

  /// Whether another live account already uses this phone number. Compared on
  /// the last 10 digits, so +880/0-prefixed forms of one number collide.
  async isPhoneTaken(
    normalised: string,
    exceptEmail: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
       WHERE deleted_at IS NULL
         AND lower(email) <> lower(${exceptEmail})
         AND phone IS NOT NULL
         AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${normalised}
       LIMIT 1`;
    return rows.length > 0;
  }

  async findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async createOtp(
    data: Prisma.OtpVerificationCreateInput,
  ): Promise<OtpVerification> {
    return this.prisma.otpVerification.create({ data });
  }

  async findLatestOtp(
    userId: string,
    purpose: string,
  ): Promise<OtpVerification | null> {
    return this.prisma.otpVerification.findFirst({
      where: { userId, purpose, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markOtpUsed(id: string): Promise<void> {
    await this.prisma.otpVerification.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.prisma.otpVerification.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  async createRefreshToken(
    data: Prisma.RefreshTokenCreateInput,
  ): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async upsertUserDevice(
    userId: string,
    fcmToken: string,
    deviceType: string,
  ): Promise<void> {
    await this.prisma.userDevice.upsert({
      where: { userId_fcmToken: { userId, fcmToken } },
      create: { userId, fcmToken, deviceType },
      update: { deviceType, updatedAt: new Date() },
    });
  }
}
