import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

/// Every folder the app is allowed to write into. `license_plate` and `selfie`
/// belong here because the rider application uploads both — the plate photo is
/// separate from the vehicle photo, and the selfie is the live face check.
export const UPLOAD_FOLDERS = [
  'avatar',
  'license',
  'vehicle_photo',
  'license_plate',
  'student_id',
  'selfie',
] as const;

export class PresignDto {
  @ApiProperty({ enum: UPLOAD_FOLDERS, example: 'avatar' })
  @IsString()
  @IsIn(UPLOAD_FOLDERS as unknown as string[])
  folder: string;

  @ApiProperty({
    enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    example: 'image/jpeg',
  })
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  contentType: string;
}
