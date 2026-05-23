import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthRepository } from './auth.repository';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/reset-password.dto';
import { hashOtp, generateOtp } from '../../shared/utils/crypto.util';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import type {
  AuthTokens,
  UserResponse,
} from './interfaces/auth-responses.interface';
import { EmailService } from '../email/email.service';
import type { User } from '@prisma/client';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const REFRESH_TOKEN_BYTES = 40;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(
    dto: RegisterDto,
  ): Promise<{ message: string; accessToken: string; devOtp?: string }> {
    const existing = await this.authRepository.findUserByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.authRepository.createUser({
      email: dto.email,
      passwordHash,
      name: dto.name,
      university: dto.university,
      phone: dto.phone,
    });

    const otp = await this.sendEmailOtp(user, 'email_verification');

    // Short-lived token so client can immediately call POST /auth/verify-email
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });

    const isDev = this.config.get<string>('nodeEnv') !== 'production';
    return {
      message: 'Verification OTP sent to your email',
      accessToken,
      ...(isDev && { devOtp: otp }),
    };
  }

  async verifyEmail(
    userId: string,
    dto: VerifyOtpDto,
  ): Promise<AuthTokens & { user: UserResponse }> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified)
      throw new BadRequestException('Email already verified');

    await this.validateOtp(user.id, 'email_verification', dto.otp);

    const updated = await this.authRepository.updateUser(user.id, {
      isEmailVerified: true,
    });
    return {
      ...(await this.issueTokens(updated)),
      user: this.toUserResponse(updated),
    };
  }

  async login(dto: LoginDto): Promise<AuthTokens & { user: UserResponse }> {
    const user = await this.authRepository.findUserByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    if (user.isSuspended) {
      throw new ForbiddenException(
        `Account suspended: ${user.suspendedReason ?? 'contact support'}`,
      );
    }
    if (user.deletedAt) throw new ForbiddenException('Account not found');
    if (!user.isEmailVerified)
      throw new ForbiddenException('Please verify your email first');

    if (dto.fcmToken && dto.deviceType) {
      await this.authRepository.upsertUserDevice(
        user.id,
        dto.fcmToken,
        dto.deviceType,
      );
    }

    return {
      ...(await this.issueTokens(user)),
      user: this.toUserResponse(user),
    };
  }

  async refreshTokens(dto: RefreshDto): Promise<AuthTokens> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.authRepository.findRefreshToken(tokenHash);

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.authRepository.revokeRefreshToken(stored.id);

    const user = await this.authRepository.findUserById(stored.userId);
    if (!user || user.isSuspended || user.deletedAt) {
      throw new UnauthorizedException('Account unavailable');
    }

    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.authRepository.findRefreshToken(tokenHash);
    if (stored && !stored.revokedAt) {
      await this.authRepository.revokeRefreshToken(stored.id);
    }
    return { message: 'Logged out successfully' };
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<{ message: string; devOtp?: string }> {
    const user = await this.authRepository.findUserByEmail(dto.email);
    let otp: string | undefined;
    // Always return success to prevent user enumeration
    if (user && !user.deletedAt) {
      otp = await this.sendEmailOtp(user, 'password_reset');
    }
    const isDev = this.config.get<string>('nodeEnv') !== 'production';
    return {
      message: 'If that email exists, a reset OTP has been sent',
      ...(isDev && otp && { devOtp: otp }),
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.authRepository.findUserByEmail(dto.email);
    if (!user) throw new BadRequestException('Invalid request');

    await this.validateOtp(user.id, 'password_reset', dto.otp);

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.authRepository.updateUser(user.id, { passwordHash });
    await this.authRepository.revokeAllUserRefreshTokens(user.id);

    return { message: 'Password reset successfully' };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async sendEmailOtp(user: User, purpose: string): Promise<string> {
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.authRepository.createOtp({
      user: { connect: { id: user.id } },
      purpose,
      otpHash,
      expiresAt,
    });

    if (purpose === 'password_reset') {
      await this.emailService.sendPasswordResetOtp(user.email, user.name, otp);
    } else {
      await this.emailService.sendVerificationOtp(user.email, user.name, otp);
    }

    this.logger.log(`[DEV] OTP for ${user.email} (${purpose}): ${otp}`);
    return otp;
  }

  private async validateOtp(
    userId: string,
    purpose: string,
    otp: string,
  ): Promise<void> {
    const record = await this.authRepository.findLatestOtp(userId, purpose);

    if (!record)
      throw new BadRequestException('No OTP found — request a new one');
    if (record.attempts >= OTP_MAX_ATTEMPTS)
      throw new BadRequestException('OTP locked — request a new one');
    if (record.expiresAt < new Date())
      throw new BadRequestException('OTP expired');

    const hash = hashOtp(otp);
    if (hash !== record.otpHash) {
      await this.authRepository.incrementOtpAttempts(record.id);
      throw new BadRequestException('Invalid OTP');
    }

    await this.authRepository.markOtpUsed(record.id);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload);

    const rawToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const ttlSeconds = this.config.get<number>('jwt.refreshTokenTtl', 2592000);

    await this.authRepository.createRefreshToken({
      user: { connect: { id: user.id } },
      tokenHash,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });

    return { accessToken, refreshToken: rawToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toUserResponse(user: User): UserResponse {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
    };
  }
}
