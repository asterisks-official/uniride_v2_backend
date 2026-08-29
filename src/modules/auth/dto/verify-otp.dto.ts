import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { OTP_LENGTH } from '../../../shared/utils/crypto.util';

export class VerifyOtpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(OTP_LENGTH, OTP_LENGTH)
  otp: string;
}
