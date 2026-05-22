import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum RequestAction {
  ACCEPT = 'ACCEPT',
  DECLINE = 'DECLINE',
}

export class RespondRequestDto {
  @ApiProperty({ enum: RequestAction, example: 'ACCEPT' })
  @IsEnum(RequestAction)
  action: RequestAction;
}
