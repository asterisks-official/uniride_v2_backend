const normalizePrivateKey = (key?: string): string | undefined => {
  if (!key) return undefined;
  let k = key.trim();

  // Render/CI dashboards often wrap pasted values in quotes — strip them.
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
    k = k.slice(1, -1).trim();
  }

  // A full service-account JSON may have been pasted — pull out private_key.
  if (k.startsWith('{')) {
    try {
      const parsed = JSON.parse(k) as { private_key?: unknown };
      if (typeof parsed.private_key === 'string') k = parsed.private_key;
    } catch {
      // not JSON — fall through
    }
  }

  // Convert escaped newlines into real ones (and drop stray carriage returns)
  // so OpenSSL can decode the PEM.
  k = k.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');

  // Still not a PEM? It may be base64-encoded — decode once and retry.
  if (!k.includes('BEGIN')) {
    try {
      const decoded = Buffer.from(k, 'base64').toString('utf8');
      if (decoded.includes('BEGIN')) {
        k = decoded.replace(/\\n/g, '\n').replace(/\r/g, '');
      }
    } catch {
      // not base64 — leave as-is
    }
  }

  return k;
};

export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  jwt: {
    privateKey: normalizePrivateKey(process.env.JWT_PRIVATE_KEY),
    publicKey: normalizePrivateKey(process.env.JWT_PUBLIC_KEY),
    accessTokenTtl: parseInt(process.env.JWT_ACCESS_TOKEN_TTL ?? '900', 10),
    refreshTokenTtl: parseInt(
      process.env.JWT_REFRESH_TOKEN_TTL ?? '2592000',
      10,
    ),
  },

  // Where the app reaches this server when S3 is not configured, so presign can
  // hand out an upload URL that actually resolves from the device. The default
  // works over `adb reverse tcp:3000 tcp:3000`.
  devUploadOrigin: process.env.DEV_UPLOAD_ORIGIN ?? 'http://localhost:3000',

  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.AWS_S3_BUCKET,
    cloudfrontUrl: process.env.AWS_CLOUDFRONT_URL,
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
  },

  sentry: {
    dsn: process.env.SENTRY_DSN,
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
});
