import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  IsDateString,
  IsInt,
  IsLatitude,
  IsLongitude,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RideType,
  GenderPreference,
  RideDirection,
  RideMode,
} from '@prisma/client';
import { Type } from 'class-transformer';
import { TripPointDto } from './trip-point.dto';

/**
 * Two shapes, one endpoint.
 *
 * **Trip shape** (current app): `pickup` + `destination`, two real points, plus
 * a `mode`. The server prices it. This covers both an instant request and a
 * scheduled post — `mode` and `scheduledAt` are the only difference.
 *
 * **Legacy shape** (v1 clients still in the wild): flat `originAddress` /
 * `dest*` fields and a client-supplied `fare`.
 *
 * Kept additive on /api/v1 rather than split across versions because a Play
 * Store update is not instantaneous — old builds keep posting for weeks. The
 * branch is in `RidesService.createRide`; see `uniride-implementation.md` C8.
 */
export class CreateRideDto {
  @ApiProperty({ enum: RideType })
  @IsEnum(RideType)
  type: RideType;

  // ── Trip shape ─────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    enum: RideMode,
    default: 'SCHEDULED',
    description:
      'INSTANT dispatches to an online rider now. SCHEDULED posts it for ' +
      'others to browse and ask to join.',
  })
  @IsOptional()
  @IsEnum(RideMode)
  mode?: RideMode;

  @ApiPropertyOptional({
    type: TripPointDto,
    description: 'Where the passenger is picked up. Present ⇒ trip shape.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TripPointDto)
  pickup?: TripPointDto;

  @ApiPropertyOptional({ type: TripPointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TripPointDto)
  destination?: TripPointDto;

  @ApiPropertyOptional({
    description:
      'Omit for an INSTANT ride — the server stamps the request time. ' +
      'Required for SCHEDULED.',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({ enum: GenderPreference, default: 'ANY' })
  @IsOptional()
  @IsEnum(GenderPreference)
  genderPref?: GenderPreference;

  // ── Analytics only ─────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Recorded when one end of the trip is a campus. Analytics only — it no ' +
      'longer decides the destination or the fare.',
  })
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @ApiPropertyOptional({ enum: RideDirection, description: 'Analytics only.' })
  @IsOptional()
  @IsEnum(RideDirection)
  direction?: RideDirection;

  // ── Legacy shape only ──────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 'DIU Campus Gate, Ashulia' })
  @IsOptional()
  @IsString()
  originAddress?: string;

  @ApiPropertyOptional({ example: 23.9317 })
  @IsOptional()
  @IsNumber()
  @IsLatitude()
  @Type(() => Number)
  originLat?: number;

  @ApiPropertyOptional({ example: 90.3761 })
  @IsOptional()
  @IsNumber()
  @IsLongitude()
  @Type(() => Number)
  originLng?: number;

  @ApiPropertyOptional({ example: 'Mirpur 10, Dhaka' })
  @IsOptional()
  @IsString()
  destAddress?: string;

  @ApiPropertyOptional({ example: 23.8069 })
  @IsOptional()
  @IsNumber()
  @IsLatitude()
  @Type(() => Number)
  destLat?: number;

  @ApiPropertyOptional({ example: 90.3668 })
  @IsOptional()
  @IsNumber()
  @IsLongitude()
  @Type(() => Number)
  destLng?: number;

  @ApiPropertyOptional({
    example: 80,
    description:
      'Legacy shape only. Ignored in the trip shape — the server prices those ' +
      'and never trusts a client fare.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  fare?: number;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    deprecated: true,
    description: 'Ignored. Launch is bike-only, so every ride carries one.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  seatsAvailable?: number;
}
