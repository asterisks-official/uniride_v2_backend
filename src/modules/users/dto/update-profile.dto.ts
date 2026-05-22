import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsMobilePhone, IsUrl } from 'class-validator';

export class UpdateProfileDto {
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

  @ApiPropertyOptional({ example: 'https://cdn.uniride.app/avatars/user-id.jpg' })
  @IsOptional()
  @IsUrl()
  profilePictureUrl?: string;
}
