import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'The FCM registration token for this install.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  fcmToken: string;

  @ApiProperty({ enum: ['android', 'ios', 'web'], example: 'android' })
  @IsString()
  @IsIn(['android', 'ios', 'web'])
  deviceType: string;
}
