import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApiApp } from '../server/app.ts';
import {
  buildAppConfig,
  validateProductionConfig,
  validateSecretStrength,
} from '../server/config.ts';
import { buildMysqlPoolOptions, MysqlConfigurationError } from '../server/db/config.ts';
import { pingDatabase, scrubDatabaseSecrets } from '../server/db/pool.ts';
import { buildCspImgSrcDirectives } from '../server/middleware/security.ts';
import {
  assertMimeMatchesDetectedExtension,
  buildGcsObjectKey,
  generateSafeMediaUrl,
  sanitizeMediaCoordinates,
} from '../server/uploads.ts';

describe('Task 2 — Secure Database Error Reporting', () => {
  it('scrubs credentials from connection strings in logs and non-prod diagnostics', () => {
    const raw =
      "Access denied using mysql://avnadmin:SuperSecretPass99!@mysql-prod.aivencloud.com:25060/levelup_rwanda";
    const scrubbed = scrubDatabaseSecrets(raw);
    expect(scrubbed).not.toContain('SuperSecretPass99!');
    expect(scrubbed).not.toContain('avnadmin');
    expect(scrubbed).toContain('mysql://[REDACTED]@');
  });

  it('returns generic database readiness errors in production while logging detailed info server-side', async () => {
    const prevHost = process.env.MYSQL_HOST;
    const prevUser = process.env.MYSQL_USER;
    const prevPass = process.env.MYSQL_PASSWORD;
    const prevDb = process.env.MYSQL_DATABASE;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      process.env.MYSQL_HOST = 'secret-db.aivencloud.com';
      process.env.MYSQL_USER = 'avnadmin';
      process.env.MYSQL_PASSWORD = 'SecretDbPassword!';
      process.env.MYSQL_DATABASE = 'levelup_rwanda';

      const prodRes = await pingDatabase({
        isProduction: true,
        probeFn: async () => {
          const err = new Error(
            "Access denied for user 'avnadmin'@'10.0.0.5' (using password: YES) on secret-db.aivencloud.com",
          ) as Error & { code?: string };
          err.code = 'ER_ACCESS_DENIED_ERROR';
          throw err;
        },
      });

      expect(prodRes.connected).toBe(false);
      expect(prodRes.configured).toBe(true);
      expect(prodRes.error).toBe('Database connection unavailable');
      expect(prodRes.error).not.toContain('avnadmin');
      expect(prodRes.error).not.toContain('aivencloud');
      expect(consoleSpy).toHaveBeenCalledTimes(1);

      const devRes = await pingDatabase({
        isProduction: false,
        probeFn: async () => {
          const err = new Error('Connection timed out') as Error & { code?: string };
          err.code = 'ETIMEDOUT';
          throw err;
        },
      });
      expect(devRes.connected).toBe(false);
      expect(devRes.error).toContain('ETIMEDOUT');
      expect(devRes.error).toContain('Connection timed out');
    } finally {
      consoleSpy.mockRestore();
      if (prevHost === undefined) delete process.env.MYSQL_HOST;
      else process.env.MYSQL_HOST = prevHost;
      if (prevUser === undefined) delete process.env.MYSQL_USER;
      else process.env.MYSQL_USER = prevUser;
      if (prevPass === undefined) delete process.env.MYSQL_PASSWORD;
      else process.env.MYSQL_PASSWORD = prevPass;
      if (prevDb === undefined) delete process.env.MYSQL_DATABASE;
      else process.env.MYSQL_DATABASE = prevDb;
    }
  });
});

describe('Task 3 — MySQL TLS Hardening', () => {
  it('enforces strict TLSv1.2 verification and explicit connectTimeout by default', () => {
    const caBase64 = Buffer.from('-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----').toString(
      'base64',
    );
    const options = buildMysqlPoolOptions({
      NODE_ENV: 'production',
      MYSQL_HOST: 'example.aivencloud.com',
      MYSQL_PORT: '25060',
      MYSQL_USER: 'avnadmin',
      MYSQL_PASSWORD: 'test-password',
      MYSQL_DATABASE: 'levelup_rwanda',
      MYSQL_CA_CERT_BASE64: caBase64,
      MYSQL_CONNECT_TIMEOUT_MS: '15000',
    });

    expect(options).not.toBeNull();
    expect(options!.connectTimeout).toBe(15000);
    expect(options!.ssl).toBeDefined();
    expect(options!.ssl!.rejectUnauthorized).toBe(true);
    expect(options!.ssl!.minVersion).toBe('TLSv1.2');
    expect(options!.ssl!.ca).toContain('BEGIN CERTIFICATE');
  });

  it('fails loudly when MYSQL_CA_CERT_PATH points to a non-existent file', () => {
    expect(() =>
      buildMysqlPoolOptions({
        MYSQL_HOST: 'example.aivencloud.com',
        MYSQL_USER: 'avnadmin',
        MYSQL_PASSWORD: 'test-password',
        MYSQL_DATABASE: 'levelup_rwanda',
        MYSQL_CA_CERT_PATH: '/nonexistent/aiven-ca-missing.pem',
      }),
    ).toThrow(MysqlConfigurationError);
  });

  it('refuses to silently disable certificate verification or allow insecure TLS in production', () => {
    expect(() =>
      buildMysqlPoolOptions({
        NODE_ENV: 'production',
        MYSQL_HOST: 'example.aivencloud.com',
        MYSQL_USER: 'avnadmin',
        MYSQL_PASSWORD: 'test-password',
        MYSQL_DATABASE: 'levelup_rwanda',
        MYSQL_SSL_ENABLED: 'false',
      }),
    ).toThrow(MysqlConfigurationError);

    expect(() =>
      buildMysqlPoolOptions({
        MYSQL_HOST: 'example.aivencloud.com',
        MYSQL_USER: 'avnadmin',
        MYSQL_PASSWORD: 'test-password',
        MYSQL_DATABASE: 'levelup_rwanda',
        MYSQL_SSL_ENABLED: 'true',
        MYSQL_SSL_REJECT_UNAUTHORIZED: 'false',
      }),
    ).toThrow(MysqlConfigurationError);

    expect(() =>
      buildMysqlPoolOptions({
        NODE_ENV: 'production',
        MYSQL_URL: 'mysql://user:pass@host:3306/db?ssl-mode=DISABLED',
      }),
    ).toThrow(MysqlConfigurationError);
  });
});

describe('Task 4 — Production Secret & Config Validation', () => {
  it('never generates weak fallback secrets in production', () => {
    const prodConfig = buildAppConfig({ NODE_ENV: 'production' });
    expect(prodConfig.sessionSecret).toBe('');
    expect(prodConfig.csrfSecret).toBe('');
  });

  it('rejects missing, short, low-entropy, or reused secrets without leaking secret values', () => {
    const weakSecret = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const shortSecret = 'too-short-secret';

    expect(validateSecretStrength('SESSION_SECRET', undefined).length).toBeGreaterThan(0);
    expect(validateSecretStrength('SESSION_SECRET', shortSecret).join(' ')).not.toContain(
      shortSecret,
    );
    expect(validateSecretStrength('CSRF_SECRET', weakSecret).join(' ')).not.toContain(weakSecret);

    const sameSecret = 'AbCdEf1234567890!@#$%^&*()_+-=QwErTyUiOp';
    const validation = validateProductionConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: sameSecret,
      CSRF_SECRET: sameSecret,
      UPLOAD_STORAGE_DRIVER: 'local',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes('distinct values'))).toBe(true);
    expect(validation.errors.some((e) => e.includes('UPLOAD_STORAGE_DRIVER'))).toBe(true);
    expect(validation.errors.join('\n')).not.toContain(sameSecret);
  });

  it('passes validation when strong distinct secrets and GCS bucket are configured', () => {
    const validation = validateProductionConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: '9a7c4e2f81b03d65a9c8e7f61234567890abcdef1234567890abcdef11223344',
      CSRF_SECRET: '44332211fedcba0987654321fedcba0987654321a1b2c3d4e5f60718293a4b5c',
      UPLOAD_STORAGE_DRIVER: 'gcs',
      GCS_BUCKET_NAME: 'levelup-rwanda-media-prod',
    });
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
  });
});

describe('Task 7 — Persistent GCS Storage Readiness & Helmet CSP', () => {
  it('includes GCS and valid HTTPS CDN origins in Helmet CSP imgSrc directives', () => {
    const imgSrc = buildCspImgSrcDirectives({
      GCS_PUBLIC_BASE_URL: 'https://media.levelup.rw/assets',
      UPLOAD_CDN_ORIGIN: 'http://insecure.example.com',
    });

    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain('https://storage.googleapis.com');
    expect(imgSrc).toContain('https://media.levelup.rw');
    expect(imgSrc).not.toContain('http://insecure.example.com');
  });

  it('validates media paths strictly and blocks traversal or spoofed extensions', () => {
    expect(() => sanitizeMediaCoordinates('posts', '../secret.jpg')).toThrow();
    expect(() => sanitizeMediaCoordinates('posts', 'evil.svg')).toThrow();
    expect(() => sanitizeMediaCoordinates('other' as any, 'ok.jpg')).toThrow();
    expect(() => assertMimeMatchesDetectedExtension('image/png', 'jpg')).toThrow();

    const clean = sanitizeMediaCoordinates('posts', '1795129622-abc123.jpg');
    expect(clean.relativeKey).toBe('posts/1795129622-abc123.jpg');
    expect(buildGcsObjectKey(clean.relativeKey, 'levelup-rwanda')).toBe(
      'levelup-rwanda/posts/1795129622-abc123.jpg',
    );
  });

  it('generates permission-checked canonical URLs and safe HTTPS public URLs only when appropriate', () => {
    expect(
      generateSafeMediaUrl({
        folder: 'posts',
        filename: '1795-abc.webp',
        visibility: 'private',
        driver: 'gcs',
        gcsPublicBaseUrl: 'https://storage.googleapis.com/my-bucket',
      }),
    ).toBe('/api/v1/media/posts/1795-abc.webp');

    expect(
      generateSafeMediaUrl({
        folder: 'posts',
        filename: '1795-abc.webp',
        visibility: 'public',
        driver: 'gcs',
        gcsPublicBaseUrl: 'https://storage.googleapis.com/my-bucket',
      }),
    ).toContain('https://storage.googleapis.com/my-bucket/');
  });

  it('rejects malformed media filenames on /api/v1/media/:folder/:filename', async () => {
    const app = createApiApp();
    const res = await request(app).get('/api/v1/media/posts/malicious.svg');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
