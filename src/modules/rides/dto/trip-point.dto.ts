import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * One end of a trip.
 *
 * Two strings rather than one because they are shown to different people at
 * different times: [areaLabel] is the coarse name a stranger sees while
 * browsing, [address] is the specific one the matched driver navigates to.
 * Collapsing them would either leak an address to the feed or send a driver to
 * the middle of a neighbourhood.
 */
export class TripPointDto {
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

  @ApiProperty({
    example: 'Home',
    description: 'What the user calls it, or the resolved address.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  address: string;

  @ApiProperty({
    example: 'Mirpur 10',
    description:
      'Coarse area. This is the one shown before either side has committed.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  areaLabel: string;
}
