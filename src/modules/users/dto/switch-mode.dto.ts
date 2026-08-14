import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ActiveMode } from '@prisma/client';

export class SwitchModeDto {
  @ApiProperty({
    enum: ActiveMode,
    example: ActiveMode.RIDER,
    description:
      'Which side of the market to browse. Switching to RIDER requires an approved rider profile; switching to PASSENGER is always allowed.',
  })
  @IsEnum(ActiveMode)
  mode: ActiveMode;
}
