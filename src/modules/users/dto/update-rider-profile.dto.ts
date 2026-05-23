import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsUrl } from 'class-validator';

export class UpdateRiderProfileDto {
  @ApiPropertyOptional({ example: 'Red' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehicleColor?: string;

  @ApiPropertyOptional({ example: 'DHA-5678' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  licensePlate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  licenseDocUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  vehiclePhotoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  studentIdDocUrl?: string;
}
