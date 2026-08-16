import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createWriteStream, existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, normalize } from 'path';
import { pipeline } from 'stream/promises';

/**
 * Where dev uploads are written.
 *
 * Backed by a named docker volume (see `docker-compose.yml`) rather than the
 * container's writable layer — otherwise every rebuild orphans the document
 * URLs already stored in the database. Falls back to a temp directory when run
 * outside compose.
 */
export const DEV_UPLOAD_ROOT =
  process.env.DEV_UPLOAD_DIR ?? join(tmpdir(), 'uniride-dev-uploads');

/// Stands in for S3 when AWS credentials are not configured.
///
/// Without this the local flow dead-ends: `presign` hands the app an upload URL
/// with nothing behind it, the direct PUT 404s, and every document-backed
/// feature — the whole rider application — is untestable on a laptop.
///
/// Registered only outside production (see `uploads.module.ts`), which is also
/// why it can be unauthenticated: the app PUTs with a bare client and no bearer
/// token, exactly as it would to S3.
@ApiExcludeController()
@Controller('uploads')
export class DevUploadsController {
  private readonly logger = new Logger(DevUploadsController.name);

  @Put('dev-object')
  async put(
    @Query('key') key: string,
    @Req() req: Request,
  ): Promise<{ key: string }> {
    const target = resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(req, createWriteStream(target));
    this.logger.log(`[DEV] stored ${key}`);
    return { key };
  }

  @Get('dev-object')
  get(@Query('key') key: string, @Res() res: Response): void {
    const target = resolveKey(key);
    if (!existsSync(target)) throw new NotFoundException('No such object');
    res.sendFile(target);
  }
}

/// Maps an object key onto a path under [DEV_UPLOAD_ROOT], refusing anything
/// that would climb out of it.
function resolveKey(key: string): string {
  if (!key || !/^[A-Za-z0-9._/-]+$/.test(key)) {
    throw new BadRequestException('Invalid key');
  }
  const target = normalize(join(DEV_UPLOAD_ROOT, key));
  if (!target.startsWith(DEV_UPLOAD_ROOT)) {
    throw new BadRequestException('Invalid key');
  }
  return target;
}
