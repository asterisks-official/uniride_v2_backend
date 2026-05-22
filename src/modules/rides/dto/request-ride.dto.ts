import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RequestRideDto {
  @ApiPropertyOptional({ example: "Hi, I'm heading to Mirpur 10 too!" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}
