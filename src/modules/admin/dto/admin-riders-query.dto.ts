import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class AdminRidersQueryDto {
  @ApiPropertyOptional({
    enum: VerificationStatus,
    default: VerificationStatus.PENDING,
    description:
      'Defaults to PENDING — the review queue. Pass APPROVED or REJECTED to look up a past decision.',
  })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
