import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/// Every field a rejected applicant may correct before resubmitting.
///
/// Deliberately the whole application rather than a few cosmetic fields: a
/// rejection can be about the vehicle, any of the documents, or the face check,
/// and an applicant who cannot fix the thing they were rejected for has no
/// route back in.
export class UpdateRiderProfileDto {
  @ApiPropertyOptional({ example: 'motorcycle' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;

  @ApiPropertyOptional({ example: 'Honda' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleMake?: string;

  @ApiPropertyOptional({ example: 'CB Hornet 160R' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleModel?: string;

  @ApiPropertyOptional({ example: 2022 })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(new Date().getFullYear() + 1)
  vehicleYear?: number;

  @ApiPropertyOptional({ example: 'Red' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehicleColor?: string;

  @ApiPropertyOptional({ example: 'DHA-5678' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  licensePlate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  licenseDocUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  vehiclePhotoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  licensePlatePhotoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  studentIdDocUrl?: string;

  @ApiPropertyOptional({
    description:
      'A fresh selfie from the liveness check. Stamps faceVerifiedAt again.',
  })
  @IsOptional()
  @IsUrl()
  selfieUrl?: string;
}
