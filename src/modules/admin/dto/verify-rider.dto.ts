import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum VerifyAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class VerifyRiderDto {
  @ApiProperty({ enum: VerifyAction })
  @IsEnum(VerifyAction)
  action: VerifyAction;

  @ApiPropertyOptional({ example: 'Documents look good' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
