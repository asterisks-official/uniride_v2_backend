import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { UserRole } from '@prisma/client';
import { UPLOAD_FOLDERS } from './dto/presign.dto';

const PRESIGN_TTL_SECONDS = 300; // 5 minutes

/// Keys are minted as `<folder>/<userId>/<uuid>.<ext>`, so ownership is
/// readable from the key itself and viewing needs no database round trip.
const KEY_SHAPE = /^([a-z_]+)\/([0-9a-fA-F-]{36})\/[A-Za-z0-9._-]+$/;

const ADMIN_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

const EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/// Normalises what a caller sends into a key this service is willing to sign,
/// or null if it is not one. Accepts a bare key as well as the full URLs
/// already stored in `license_doc_url` and friends, so existing rows work
/// without a migration.
///
/// Returning null rather than the input is the whole point: without a shape
/// check, `view` would presign *any* object in the bucket for any caller
/// holding a token.
export function parseUploadKey(
  keyOrUrl: string,
): { key: string; folder: string; ownerId: string } | null {
  const trimmed = (keyOrUrl ?? '').trim();
  if (!trimmed) return null;

  let candidate: string;
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      // Dev URLs carry the key in a query parameter rather than the path.
      candidate =
        url.searchParams.get('key') ?? decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  } else {
    candidate = trimmed;
  }

  const key = candidate.replace(/^\/+/, '');
  const match = KEY_SHAPE.exec(key);
  if (!match) return null;

  const [, folder, ownerId] = match;
  if (!UPLOAD_FOLDERS.includes(folder as never)) return null;
  return { key, folder, ownerId };
}

/// Owners may read their own documents; admins may read anyone's, because
/// reviewing them is what the verification queue does. Everyone else is
/// refused — these are licences and national ID cards.
export function canViewUpload(
  ownerId: string,
  requester: { userId: string; role: UserRole },
): boolean {
  return ownerId === requester.userId || ADMIN_ROLES.includes(requester.role);
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly s3: S3Client | null = null;
  private readonly bucket: string;
  private readonly cdnUrl: string;
  private readonly isDev: boolean;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('aws.region');
    const accessKeyId = this.config.get<string>('aws.accessKeyId');
    const secretAccessKey = this.config.get<string>('aws.secretAccessKey');
    this.bucket = this.config.get<string>(
      'aws.s3Bucket',
      'uniride-uploads-dev',
    );
    this.cdnUrl = this.config.get<string>(
      'aws.cloudfrontUrl',
      'https://cdn.uniride.app',
    );
    this.isDev = this.config.get<string>('nodeEnv') !== 'production';

    if (
      region &&
      accessKeyId &&
      secretAccessKey &&
      !accessKeyId.startsWith('REPLACE')
    ) {
      this.s3 = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });
    } else {
      this.logger.warn(
        'AWS credentials not configured — presign will return mock URLs in dev',
      );
    }
  }

  async presign(
    userId: string,
    folder: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    const ext = EXTENSION_MAP[contentType] ?? 'bin';
    const key = `${folder}/${userId}/${randomUUID()}.${ext}`;
    const publicUrl = `${this.cdnUrl}/${key}`;

    if (!this.s3) {
      // Dev fallback — a real endpoint on this server stands in for S3, so the
      // app's upload-then-save flow runs unchanged. See DevUploadsController.
      //
      // publicUrl points back at that endpoint rather than the CDN host, so a
      // URL stored in dev actually resolves. Storing a cdn.uniride.app URL for
      // a file that only exists locally made every document unviewable in the
      // admin panel — which is the one place they need to be looked at.
      const devOrigin = this.config.get<string>(
        'devUploadOrigin',
        'http://localhost:3000',
      );
      const encoded = encodeURIComponent(key);
      const devUrl = `${devOrigin}/api/v1/uploads/dev-object?key=${encoded}`;
      this.logger.log(`[DEV] Mock presign: ${key}`);
      return { uploadUrl: devUrl, publicUrl: devUrl, key };
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGN_TTL_SECONDS,
    });
    return { uploadUrl, publicUrl, key };
  }

  /// Short-lived GET URL for an object that was uploaded through `presign`.
  ///
  /// The bucket is private, so the `publicUrl` stored on a rider application is
  /// not actually fetchable — uploads worked and viewing 403'd, which left the
  /// verification queue unable to look at the documents it exists to review.
  /// Presigning on demand keeps licences and NIDs unreadable to anyone without
  /// a token, which is the right default for identity documents.
  async presignView(
    requester: { userId: string; role: UserRole },
    keyOrUrl: string,
  ): Promise<{ viewUrl: string; expiresIn: number }> {
    const parsed = parseUploadKey(keyOrUrl);
    if (!parsed) throw new ForbiddenException('Not a readable upload key');
    if (!canViewUpload(parsed.ownerId, requester)) {
      throw new ForbiddenException('Not your document');
    }
    const { key } = parsed;

    if (!this.s3) {
      // Dev keeps serving through DevUploadsController, which already streams
      // the file back, so the app's view flow is identical either way.
      const devOrigin = this.config.get<string>(
        'devUploadOrigin',
        'http://localhost:3000',
      );
      const viewUrl = `${devOrigin}/api/v1/uploads/dev-object?key=${encodeURIComponent(key)}`;
      return { viewUrl, expiresIn: PRESIGN_TTL_SECONDS };
    }

    const viewUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
    return { viewUrl, expiresIn: PRESIGN_TTL_SECONDS };
  }
}
