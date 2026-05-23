import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateRiderProfileDto } from './dto/create-rider-profile.dto';
import { UpdateRiderProfileDto } from './dto/update-rider-profile.dto';
import type { User, UserStats, RiderProfile } from '@prisma/client';

type ProfileWithStats = User & { stats: UserStats | null };

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getMe(userId: string): Promise<ProfileWithStats> {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<User> {
    await this.getMe(userId);
    return this.usersRepository.update(userId, dto);
  }

  async deleteMe(userId: string): Promise<{ message: string }> {
    await this.getMe(userId);
    await this.usersRepository.softDelete(userId);
    return { message: 'Account deleted successfully' };
  }

  async getPublicProfile(userId: string): Promise<Partial<User>> {
    const user = await this.usersRepository.findPublicById(userId);
    if (!user) throw new NotFoundException('User not found');
    // Strip sensitive fields from public view

    const {
      passwordHash,
      isSuspended,
      suspendedReason,
      deletedAt,
      ...publicUser
    } = user;
    void passwordHash;
    void isSuspended;
    void suspendedReason;
    void deletedAt;
    return publicUser;
  }

  // ── Rider profile ──────────────────────────────────────────────────────────

  async getRiderProfile(userId: string): Promise<RiderProfile> {
    const profile = await this.usersRepository.findRiderProfile(userId);
    if (!profile) throw new NotFoundException('Rider profile not found');
    return profile;
  }

  async createRiderProfile(
    userId: string,
    dto: CreateRiderProfileDto,
  ): Promise<RiderProfile> {
    const existing = await this.usersRepository.findRiderProfile(userId);
    if (existing) throw new ConflictException('Rider profile already exists');

    const profile = await this.usersRepository.createRiderProfile({
      user: { connect: { id: userId } },
      ...dto,
    });

    // Promote role to RIDER
    await this.usersRepository.update(userId, { role: 'RIDER' });

    return profile;
  }

  async updateRiderProfile(
    userId: string,
    dto: UpdateRiderProfileDto,
  ): Promise<RiderProfile> {
    const existing = await this.usersRepository.findRiderProfile(userId);
    if (!existing)
      throw new NotFoundException('Rider profile not found — create one first');
    return this.usersRepository.updateRiderProfile(userId, dto);
  }
}
