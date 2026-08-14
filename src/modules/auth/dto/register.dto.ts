import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsMobilePhone,
  IsNotEmpty,
  IsEnum,
} from 'class-validator';
import { Gender } from '@prisma/client';

/// Which side the user is signing up for.
///
/// RIDER does *not* grant the rider capability — it only routes the client
/// into the rider application, which still requires admin approval. Without
/// that separation anyone could self-declare as a driver and verification
/// would be decorative.
export enum JoinAs {
  PASSENGER = 'PASSENGER',
  RIDER = 'RIDER',
}

export class RegisterDto {
  @ApiProperty({ example: 'Shakib Ahmed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'shakib@university.edu' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password: string;

  @ApiProperty({
    enum: Gender,
    example: Gender.MALE,
    description:
      'Required. This is what makes female-only rides enforceable rather than advisory.',
  })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({
    example: '221-15-6029',
    description: 'University student ID number. Required for new accounts.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  studentIdNumber: string;

  @ApiPropertyOptional({
    enum: JoinAs,
    default: JoinAs.PASSENGER,
    description:
      'RIDER starts the rider application; the account is still created in passenger mode until an admin approves it.',
  })
  @IsOptional()
  @IsEnum(JoinAs)
  joinAs?: JoinAs;

  @ApiPropertyOptional({ example: 'BUET' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  university?: string;

  @ApiPropertyOptional({ example: '+8801712345678' })
  @IsOptional()
  @IsMobilePhone()
  phone?: string;
}
