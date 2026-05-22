import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatRepository } from './chat.repository';
import { PrismaService } from '../../database/prisma.service';
import { getPaginationParams, buildPaginationMeta } from '../../shared/utils/pagination.util';

@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getMessages(rideId: string, userId: string, query: { page?: number; limit?: number }) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== userId && ride.passengerId !== userId) {
      throw new ForbiddenException('Not a participant of this ride');
    }
    const { skip, take, page, limit } = getPaginationParams(query);
    const [messages, total] = await Promise.all([
      this.chatRepository.findMessages(rideId, skip, take),
      this.chatRepository.countMessages(rideId),
    ]);
    return { messages: messages.reverse(), pagination: buildPaginationMeta(total, page, limit) };
  }

  async sendMessage(rideId: string, senderId: string, content: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== senderId && ride.passengerId !== senderId) {
      throw new ForbiddenException('Not a participant of this ride');
    }
    if (ride.status !== 'IN_PROGRESS' && ride.status !== 'MATCHED') {
      throw new ForbiddenException('Chat is only available for matched or active rides');
    }
    return this.chatRepository.createMessage({
      ride: { connect: { id: rideId } },
      senderId,
      content,
      type: 'TEXT',
    });
  }
}
