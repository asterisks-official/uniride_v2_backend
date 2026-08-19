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

export class SavePlaceDto {
  @ApiProperty({ example: 'Home' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

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
    example: 'Mirpur 10',
    description:
      'Coarse area name. Deliberately not a street address — this is what ' +
      'other users see before both sides commit to a ride.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  areaLabel: string;
}
