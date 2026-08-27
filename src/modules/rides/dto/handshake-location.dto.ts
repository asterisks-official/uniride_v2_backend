import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsNumber, IsOptional } from 'class-validator';

/**
 * Where the phone was when its owner moved the ride forward.
 *
 * Optional on every endpoint that takes it. A denied permission, a cold fix or
 * a basement is not a reason to refuse to start or end someone's trip — the
 * record simply says nothing about that corner, which is honest and still
 * leaves the other three.
 */
export class HandshakeLocationDto {
  @ApiPropertyOptional({ example: 23.7456 })
  @IsOptional()
  @IsNumber()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 90.3736 })
  @IsOptional()
  @IsNumber()
  @IsLongitude()
  lng?: number;
}
