import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),

  JWT_PRIVATE_KEY: Joi.string().required(),
  JWT_PUBLIC_KEY: Joi.string().required(),
  JWT_ACCESS_TOKEN_TTL: Joi.number().default(900),
  JWT_REFRESH_TOKEN_TTL: Joi.number().default(2592000),

  AWS_REGION: Joi.string().optional(),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
  AWS_S3_BUCKET: Joi.string().optional(),
  AWS_CLOUDFRONT_URL: Joi.string().optional(),

  FIREBASE_PROJECT_ID: Joi.string().optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().email().optional(),

  RESEND_API_KEY: Joi.string().optional(),
  // Optional, but if set it must be on the UniRide domain. Accepts both
  // `noreply@uniridebd.com` and `UniRide <noreply@uniridebd.com>`.
  //
  // Rejected at boot rather than warned about: a sender on the wrong domain
  // fails SPF/DKIM, so those emails do not quietly look odd — they land in
  // spam or bounce, and OTP delivery is the one flow a new user cannot get
  // past. Failing here is a five-second fix; discovering it from a support
  // ticket is not. See EMAIL_DOMAIN in modules/email/email.service.ts.
  RESEND_FROM_EMAIL: Joi.string()
    // Case-insensitive: domains are, and "UniRideBD.com" is a perfectly
    // legitimate way to write it that should not fail a deploy.
    .pattern(/@uniridebd\.com>?\s*$/i)
    .optional()
    .messages({
      'string.pattern.base':
        'RESEND_FROM_EMAIL must send from @uniridebd.com (e.g. "UniRide <noreply@uniridebd.com>")',
    }),

  SENTRY_DSN: Joi.string().optional(),
  // Optional: place search falls back to a static Dhaka area list without it.
  GOOGLE_MAPS_API_KEY: Joi.string().optional(),
  ENCRYPTION_KEY: Joi.string().length(64).required(),

  THROTTLE_TTL: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(100),
});
