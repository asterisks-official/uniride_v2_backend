import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  IsDateString,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RideType, GenderPreference } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateRideDto {
  @ApiProperty({ enum: RideType })
  @IsEnum(RideType)
  type: RideType;

  @ApiProperty({ example: 'DIU Campus Gate, Ashulia' })
  @IsString()
  originAddress: string;

  @ApiProperty({ example: 23.9317 })
  @IsNumber()
  @Type(() => Number)
  originLat: number;

  @ApiProperty({ example: 90.3761 })
  @IsNumber()
  @Type(() => Number)
  originLng: number;

  @ApiProperty({ example: 'Mirpur 10, Dhaka' })
  @IsString()
  destAddress: string;

  @ApiProperty({ example: 23.8069 })
  @IsNumber()
  @Type(() => Number)
  destLat: number;

  @ApiProperty({ example: 90.3668 })
  @IsNumber()
  @Type(() => Number)
  destLng: number;

  @ApiProperty({ example: 80 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  fare: number;

  @ApiPropertyOptional({ example: 2, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  seatsAvailable?: number;

  @ApiPropertyOptional({ enum: GenderPreference, default: 'ANY' })
  @IsOptional()
  @IsEnum(GenderPreference)
  genderPref?: GenderPreference;

  @ApiProperty({ example: '2026-05-24T08:00:00.000Z' })
  @IsDateString()
  scheduledAt: string;
}
