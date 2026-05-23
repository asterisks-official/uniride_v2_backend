import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationsRepository } from './notifications.repository';
import {
  getPaginationParams,
  buildPaginationMeta,
} from '../../shared/utils/pagination.util';
import { QUEUE_NOTIFICATIONS } from '../../jobs/queue.constants';
import type { NotificationJobData } from '../../jobs/processors/notification.processor';

export interface NotificationsQuery {
  page?: number;
  limit?: number;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notifQueue: Queue,
  ) {}

  async send(
    userId: string,
    type: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ) {
    const notification = await this.notificationsRepository.create({
      user: { connect: { id: userId } },
      type: type as never,
      title,
      body,
      data: (data ?? {}) as never,
    });

    await this.notifQueue.add('push', {
      userId,
      title,
      body,
      type,
      data,
      notificationId: notification.id,
    } satisfies NotificationJobData);

    return notification;
  }

  async getNotifications(userId: string, query: NotificationsQuery) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const [notifications, total] = await Promise.all([
      this.notificationsRepository.findByUser(userId, skip, take),
      this.notificationsRepository.countByUser(userId),
    ]);
    return {
      notifications,
      pagination: buildPaginationMeta(total, page, limit),
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.notificationsRepository.countUnread(userId);
    return { count };
  }

  async markRead(id: string, userId: string) {
    const exists = await this.notificationsRepository.findOne(id, userId);
    if (!exists) throw new NotFoundException('Notification not found');
    await this.notificationsRepository.markRead(id, userId);
    return { message: 'Marked as read' };
  }

  async markAllRead(userId: string) {
    await this.notificationsRepository.markAllRead(userId);
    return { message: 'All notifications marked as read' };
  }

  async deleteNotification(id: string, userId: string) {
    const exists = await this.notificationsRepository.findOne(id, userId);
    if (!exists) throw new NotFoundException('Notification not found');
    await this.notificationsRepository.deleteOne(id, userId);
    return { message: 'Notification deleted' };
  }
}
