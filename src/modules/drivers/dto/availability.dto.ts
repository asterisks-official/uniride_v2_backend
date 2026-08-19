import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetAvailabilityDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isOnline: boolean;

  @ApiPropertyOptional({
    example: 23.8069,
    description:
      'Required when going online — a rider with no position cannot be ' +
      'dispatched to, because there is no way to tell who is nearest.',
  })
  @IsOptional()
  @IsNumber()
  @IsLatitude()
  @Type(() => Number)
  lat?: number;

  @ApiPropertyOptional({ example: 90.3668 })
  @IsOptional()
  @IsNumber()
  @IsLongitude()
  @Type(() => Number)
  lng?: number;
}

/// A position heartbeat from an online rider.
export class HeartbeatDto {
  @ApiProperty({ example: 23.8069 })
  @IsNumber()
  @IsLatitude()
  @Type(() => Number)
  lat: number;

  @ApiProperty({ example: 90.3668 })
  @IsNumber()
  @IsLongitude()
  @Type(() => Number)
  lng: number;
}
