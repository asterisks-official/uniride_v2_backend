import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, Min, Max, MaxLength, IsOptional, IsUrl } from 'class-validator';

export class CreateRiderProfileDto {
  @ApiProperty({ example: 'motorcycle' })
  @IsString()
  @MaxLength(50)
  vehicleType: string;

  @ApiProperty({ example: 'Honda' })
  @IsString()
  @MaxLength(50)
  vehicleMake: string;

  @ApiProperty({ example: 'CB Hornet 160R' })
  @IsString()
  @MaxLength(100)
  vehicleModel: string;

  @ApiProperty({ example: 2022 })
  @IsInt()
  @Min(2000)
  @Max(new Date().getFullYear() + 1)
  vehicleYear: number;

  @ApiProperty({ example: 'Red' })
  @IsString()
  @MaxLength(30)
  vehicleColor: string;

  @ApiProperty({ example: 'DHA-1234' })
  @IsString()
  @MaxLength(20)
  licensePlate: string;

  @ApiProperty({ description: 'CloudFront URL of uploaded driving license doc' })
  @IsUrl()
  licenseDocUrl: string;

  @ApiProperty({ description: 'CloudFront URL of uploaded vehicle photo' })
  @IsUrl()
  vehiclePhotoUrl: string;

  @ApiPropertyOptional({ description: 'CloudFront URL of uploaded student ID doc' })
  @IsOptional()
  @IsUrl()
  studentIdDocUrl?: string;
}
