import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { User, UserStats, Prisma } from '@prisma/client';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<(User & { stats: UserStats | null }) | null> {
    return this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: { stats: true },
    });
  }

  async findPublicById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id, deletedAt: null } });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async createStats(userId: string): Promise<UserStats> {
    return this.prisma.userStats.create({ data: { userId } });
  }
}
