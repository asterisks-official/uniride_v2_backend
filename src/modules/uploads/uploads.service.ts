import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const PRESIGN_TTL_SECONDS = 300; // 5 minutes

const EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

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
}
