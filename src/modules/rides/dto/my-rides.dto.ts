import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RideStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export enum MyRidesRole {
  RIDER = 'rider',
  PASSENGER = 'passenger',
}

export class MyRidesDto {
  @ApiPropertyOptional({
    enum: MyRidesRole,
    description: 'Filter by your role in the ride',
  })
  @IsOptional()
  @IsEnum(MyRidesRole)
  role?: MyRidesRole;

  @ApiPropertyOptional({ enum: RideStatus })
  @IsOptional()
  @IsEnum(RideStatus)
  status?: RideStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
