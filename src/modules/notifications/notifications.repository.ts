import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Notification, Prisma } from '@prisma/client';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.NotificationCreateInput): Promise<Notification> {
    return this.prisma.notification.create({ data });
  }

  async findOne(id: string, userId: string): Promise<Notification | null> {
    return this.prisma.notification.findFirst({ where: { id, userId } });
  }

  async findByUser(userId: string, skip: number, take: number): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
  }

  async countByUser(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId } });
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(id: string, userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async markDelivered(id: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: { deliveredAt: new Date() },
    });
  }

  async deleteOne(id: string, userId: string): Promise<void> {
    await this.prisma.notification.deleteMany({ where: { id, userId } });
  }

  async findUserFcmTokens(userId: string): Promise<string[]> {
    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { fcmToken: true },
    });
    return devices.map((d) => d.fcmToken);
  }
}
