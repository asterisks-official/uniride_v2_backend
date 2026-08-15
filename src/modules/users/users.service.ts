import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { AuthService } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateRiderProfileDto } from './dto/create-rider-profile.dto';
import { UpdateRiderProfileDto } from './dto/update-rider-profile.dto';
import { SwitchModeDto } from './dto/switch-mode.dto';
import { ActiveMode } from '@prisma/client';
import type { User, UserStats, RiderProfile } from '@prisma/client';
import { MAX_RIDER_REJECTIONS } from '../../shared/utils/identity';

type ProfileWithStats = User & { stats: UserStats | null };

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly authService: AuthService,
  ) {}

  /// Switch which side of the market the user is browsing.
  ///
  /// Only the *view* changes — `role` (the admin-granted capability) is never
  /// touched here, so switching to passenger and back does not cost a rider
  /// their approval, and switching to rider cannot grant it.
  async switchMode(userId: string, dto: SwitchModeDto) {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (dto.mode === ActiveMode.RIDER && user.role !== 'RIDER') {
      const profile = await this.usersRepository.findRiderProfile(userId);
      throw new ForbiddenException(
        profile?.verificationStatus === 'PENDING'
          ? 'Your rider application is still under review.'
          : profile?.verificationStatus === 'REJECTED'
            ? 'Your rider application was not approved. Update your details and resubmit.'
            : 'Apply to become a rider before switching to rider mode.',
      );
    }

    const updated = await this.usersRepository.update(userId, {
      activeMode: dto.mode,
    });

    // The mode lives in the JWT, so the old token would keep serving the old
    // side of the feed. Reissue rather than wait for expiry.
    const tokens = await this.authService.reissueTokens(updated);

    return { mode: updated.activeMode, ...tokens };
  }

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
      // The DTO requires a selfie, and the app only produces one by passing the
      // liveness check, so arriving here *is* the verification event.
      faceVerifiedAt: new Date(),
    });

    // Role stays PASSENGER until an admin approves the profile (verificationStatus
    // starts PENDING). Promotion to RIDER happens in admin.verifyRider on APPROVE,
    // so unverified users cannot post rides.
    return profile;
  }

  async updateRiderProfile(
    userId: string,
    dto: UpdateRiderProfileDto,
  ): Promise<RiderProfile> {
    const existing = await this.usersRepository.findRiderProfile(userId);
    if (!existing)
      throw new NotFoundException('Rider profile not found — create one first');

    // Editing a rejected application resubmits it. Without this a rejected
    // applicant has no route back: the profile stays REJECTED no matter what
    // they correct, and createRiderProfile refuses because one already exists.
    const resubmitting = existing.verificationStatus === 'REJECTED';

    // The account is suspended at this point, so this is belt and braces —
    // but the rule that three rejections is the end lives here, not only in
    // whichever guard happens to run first.
    if (resubmitting && existing.rejectionCount >= MAX_RIDER_REJECTIONS) {
      throw new ForbiddenException(
        `This application was rejected ${MAX_RIDER_REJECTIONS} times and can no longer be resubmitted.`,
      );
    }

    return this.usersRepository.updateRiderProfile(userId, {
      ...dto,
      // A replacement selfie means the liveness check ran again.
      ...(dto.selfieUrl && { faceVerifiedAt: new Date() }),
      ...(resubmitting && {
        verificationStatus: 'PENDING',
        adminNote: null,
        reviewedAt: null,
        reviewedBy: null,
      }),
    });
  }
}
