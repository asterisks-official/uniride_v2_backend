import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { PresignDto } from './dto/presign.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('presign')
  @ApiOperation({
    summary: 'Get a presigned S3 upload URL',
    description:
      'Returns a short-lived PUT URL. Client uploads directly to S3, then saves `publicUrl` to their profile.',
  })
  @ApiResponse({ status: 201, description: '{ uploadUrl, publicUrl, key }' })
  presign(@CurrentUser() user: JwtPayload, @Body() dto: PresignDto) {
    return this.uploadsService.presign(user.sub, dto.folder, dto.contentType);
  }
}
