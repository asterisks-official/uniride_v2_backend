import { IsLatitude, IsLongitude, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * What it costs to travel between two points.
 *
 * Notably absent: a fare, a seat count, and any notion of a campus. Neither
 * party names a price, launch is bike-only so every ride carries one pillion,
 * and trips go wherever the rider is going.
 */
export class QuoteRideDto {
  @ApiProperty({ example: 23.8069 })
  @IsNumber()
  @IsLatitude()
  @Type(() => Number)
  fromLat: number;

  @ApiProperty({ example: 90.3668 })
  @IsNumber()
  @IsLongitude()
  @Type(() => Number)
  fromLng: number;

  @ApiProperty({ example: 23.8759 })
  @IsNumber()
  @IsLatitude()
  @Type(() => Number)
  toLat: number;

  @ApiProperty({ example: 90.3204 })
  @IsNumber()
  @IsLongitude()
  @Type(() => Number)
  toLng: number;
}
