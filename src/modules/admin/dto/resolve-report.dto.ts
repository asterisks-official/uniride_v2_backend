import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ResolveAction {
  RESOLVE = 'RESOLVE',
  DISMISS = 'DISMISS',
}

export class ResolveReportDto {
  @ApiProperty({ enum: ResolveAction })
  @IsEnum(ResolveAction)
  action: ResolveAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
