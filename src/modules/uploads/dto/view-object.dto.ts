import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ViewObjectDto {
  @ApiProperty({
    description:
      'The object key returned by /uploads/presign, or the stored publicUrl ' +
      'containing it. Both are accepted because the database holds full URLs ' +
      '(license_doc_url and friends) rather than bare keys.',
    example: 'license/8f1c.../3b2e....jpg',
  })
  @IsString()
  @MaxLength(2048)
  key: string;
}
