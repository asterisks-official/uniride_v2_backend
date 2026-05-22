import { IsOptional, IsNumber, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { GenderPreference } from '@prisma/client';
import { Type } from 'class-transformer';

export class SearchRidesDto {
  @ApiPropertyOptional({ example: 23.9317 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  originLat?: number;

  @ApiPropertyOptional({ example: 90.3761 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  originLng?: number;

  @ApiPropertyOptional({ example: 23.8069 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  destLat?: number;

  @ApiPropertyOptional({ example: 90.3668 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  destLng?: number;

  @ApiPropertyOptional({ example: '2026-05-24', description: 'Filter by date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  seats?: number;

  @ApiPropertyOptional({ enum: GenderPreference })
  @IsOptional()
  @IsEnum(GenderPreference)
  genderPref?: GenderPreference;

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
