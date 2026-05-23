import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

export class PresignDto {
  @ApiProperty({
    enum: ['avatar', 'license', 'vehicle_photo', 'student_id'],
    example: 'avatar',
  })
  @IsString()
  @IsIn(['avatar', 'license', 'vehicle_photo', 'student_id'])
  folder: string;

  @ApiProperty({
    enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    example: 'image/jpeg',
  })
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  contentType: string;
}
