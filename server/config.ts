import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export type UploadStorageDriver = 'local' | 'gcs';
export type GcsDeliveryMode = 'proxy' | 'signed_url';

const MIN_PRODUCTION_SECRET_LENGTH = 32;
const MIN_SECRET_UNIQUE_CHARS = 10;
const KNOWN_WEAK_SECRET_VALUES = new Set([
  'changeme',
  'change-me',
  'change_me',
  'secret',
  'password',
  'default',
  'development',
  'production',
  'session_secret',
  'csrf_secret',
  'my_session_secret',
  'my_csrf_secret',
  'replace_me',
  'replace-with-secret',
  'test-secret',
  'supersecret',
]);

// Ephemeral fallback secrets are ONLY permitted in non-production when env vars are absent
// so local development/testing can run; in production, explicit strong secrets must be supplied.
const devFallbackSessionSecret = crypto.randomBytes(32).toString('hex');
const devFallbackCsrfSecret = crypto.randomBytes(32).toString('hex');

export function validateSecretStrength(name: string, rawValue: string | undefined): string[] {
  const errors: string[] = [];
  const value = rawValue?.trim() || '';

  if (!value) {
    errors.push(`${name} is required in production.`);
    return errors;
  }

  if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
    errors.push(
      `${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters long in production.`,
    );
  }

  const lower = value.toLowerCase();
  if (
    KNOWN_WEAK_SECRET_VALUES.has(lower) ||
    lower.startsWith('my_') ||
    lower.startsWith('replace_') ||
    lower.startsWith('example_')
  ) {
    errors.push(`${name} must not use a placeholder or weak default value in production.`);
  }

  const uniqueChars = new Set(value).size;
  if (uniqueChars < MIN_SECRET_UNIQUE_CHARS) {
    errors.push(
      `${name} has insufficient character diversity in production (at least ${MIN_SECRET_UNIQUE_CHARS} distinct characters required).`,
    );
  }

  return errors;
}

export interface ProductionConfigValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionConfigValidationResult {
  if (env.NODE_ENV !== 'production') {
    return { ok: true, errors: [] };
  }

  const errors: string[] = [];

  errors.push(...validateSecretStrength('SESSION_SECRET', env.SESSION_SECRET));
  errors.push(...validateSecretStrength('CSRF_SECRET', env.CSRF_SECRET));

  const sessionSecret = env.SESSION_SECRET?.trim() || '';
  const csrfSecret = env.CSRF_SECRET?.trim() || '';
  if (sessionSecret && csrfSecret && sessionSecret === csrfSecret) {
    errors.push('SESSION_SECRET and CSRF_SECRET must be distinct values in production.');
  }

  const storageDriverRaw = (env.UPLOAD_STORAGE_DRIVER || '').trim().toLowerCase();
  if (storageDriverRaw !== 'gcs') {
    errors.push(
      'UPLOAD_STORAGE_DRIVER must be set to "gcs" in production so persistent user uploads never depend on ephemeral local Cloud Run storage.',
    );
  } else if (!env.GCS_BUCKET_NAME || env.GCS_BUCKET_NAME.trim().length === 0) {
    errors.push('GCS_BUCKET_NAME is required when UPLOAD_STORAGE_DRIVER="gcs" in production.');
  }

  if (env.MYSQL_SSL_ENABLED === 'false') {
    errors.push('MYSQL_SSL_ENABLED cannot be "false" in production.');
  }
  if (env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'false') {
    errors.push('MYSQL_SSL_REJECT_UNAUTHORIZED cannot be "false" in production.');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export class ProductionConfigError extends Error {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid production configuration:\n- ${errors.join('\n- ')}`);
    this.name = 'ProductionConfigError';
    this.errors = errors;
  }
}

export function assertValidProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const result = validateProductionConfig(env);
  if (!result.ok) {
    throw new ProductionConfigError(result.errors);
  }
}

export function resolveUploadStorageDriver(env: NodeJS.ProcessEnv = process.env): UploadStorageDriver {
  const raw = (env.UPLOAD_STORAGE_DRIVER || '').trim().toLowerCase();
  if (raw === 'gcs') return 'gcs';
  if (raw === 'local') return 'local';
  return env.NODE_ENV === 'production' ? 'gcs' : 'local';
}

export function buildAppConfig(env: NodeJS.ProcessEnv = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const signedUrlTtlRaw = Number.parseInt(env.GCS_SIGNED_URL_TTL_SECONDS || '300', 10);
  const gcsSignedUrlTtlSeconds =
    Number.isFinite(signedUrlTtlRaw) && signedUrlTtlRaw >= 30 && signedUrlTtlRaw <= 3600
      ? signedUrlTtlRaw
      : 300;

  return {
    nodeEnv: env.NODE_ENV || 'development',
    isProduction: isProd,
    port: Number.parseInt(env.PORT || '3000', 10),
    appUrl: env.APP_URL || 'http://localhost:3000',
    corsOrigin: env.CORS_ORIGIN || env.APP_URL || 'http://localhost:3000',
    trustProxy: env.TRUST_PROXY !== 'false',
    sessionSecret: isProd ? env.SESSION_SECRET?.trim() || '' : env.SESSION_SECRET || devFallbackSessionSecret,
    csrfSecret: isProd ? env.CSRF_SECRET?.trim() || '' : env.CSRF_SECRET || devFallbackCsrfSecret,
    hasExplicitSessionSecret: Boolean(env.SESSION_SECRET?.trim()),
    hasExplicitCsrfSecret: Boolean(env.CSRF_SECRET?.trim()),
    sessionTtlHours: Number.parseInt(env.SESSION_TTL_HOURS || '168', 10),
    cookieSecure:
      env.COOKIE_SECURE === 'true'
        ? true
        : env.COOKIE_SECURE === 'false'
          ? false
          : isProd,
    adminBootstrapToken: env.ADMIN_BOOTSTRAP_TOKEN || '',
    uploadStorageDriver: resolveUploadStorageDriver(env),
    uploadDir: path.resolve(process.cwd(), env.UPLOAD_DIR || './uploads'),
    maxUploadBytes: Number.parseInt(env.MAX_UPLOAD_BYTES || String(5 * 1024 * 1024), 10),
    gcsBucketName: env.GCS_BUCKET_NAME?.trim() || '',
    gcsKeyPrefix: (env.GCS_KEY_PREFIX || '').trim().replace(/^\/+|\/+$/g, ''),
    gcsDeliveryMode: (env.GCS_DELIVERY_MODE === 'signed_url' ? 'signed_url' : 'proxy') as GcsDeliveryMode,
    gcsSignedUrlTtlSeconds,
    gcsPublicBaseUrl: (env.GCS_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
    uploadCdnOrigin: (env.UPLOAD_CDN_ORIGIN || '').trim(),
  };
}

export const appConfig = buildAppConfig(process.env);
