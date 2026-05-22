import { IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateRatingDto {
  @ApiProperty()
  @IsUUID()
  rideId: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  score: number;

  @ApiPropertyOptional({ example: 'Great ride, very punctual!' })
  @IsOptional()
  @IsString()
  review?: string;

  @ApiPropertyOptional({ type: [String], example: ['punctual', 'friendly', 'safe_driver'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
