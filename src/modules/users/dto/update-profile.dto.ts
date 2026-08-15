import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  IsMobilePhone,
  IsUrl,
  IsEnum,
  IsNotEmpty,
} from 'class-validator';
import { Gender } from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    enum: Gender,
    description:
      'Accounts created before gender was required use this to fill it in.',
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ example: '221-15-6029' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  studentIdNumber?: string;
  @ApiPropertyOptional({ example: 'Shakib Ahmed' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Software engineering student at BUET' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ example: 'BUET' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  university?: string;

  @ApiPropertyOptional({ example: '+8801712345678' })
  @IsOptional()
  @IsMobilePhone()
  phone?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.uniride.app/avatars/user-id.jpg',
  })
  @IsOptional()
  @IsUrl()
  profilePictureUrl?: string;
}
