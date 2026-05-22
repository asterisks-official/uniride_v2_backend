import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportType } from '@prisma/client';

export class CreateReportDto {
  @ApiProperty()
  @IsUUID()
  reportedId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rideId?: string;

  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  type: ReportType;

  @ApiProperty({ example: 'Driver was driving recklessly at high speed.' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  description: string;
}
