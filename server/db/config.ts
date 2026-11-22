import fs from 'fs';

export class MysqlConfigurationError extends Error {
  public readonly code = 'MYSQL_CONFIG_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'MysqlConfigurationError';
  }
}

export interface MysqlConfigStatus {
  configured: boolean;
  missingFields: string[];
  mode: 'url' | 'fields' | 'unconfigured';
}

export function getMysqlConfigStatus(env: NodeJS.ProcessEnv = process.env): MysqlConfigStatus {
  if (env.MYSQL_URL && env.MYSQL_URL.trim().length > 0) {
    return { configured: true, missingFields: [], mode: 'url' };
  }

  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'] as const;
  const missingFields = required.filter((key) => !env[key] || env[key]!.trim().length === 0);

  if (missingFields.length === 0) {
    return { configured: true, missingFields: [], mode: 'fields' };
  }

  return { configured: false, missingFields, mode: 'unconfigured' };
}

export function resolveMysqlCaCertificate(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.MYSQL_CA_CERT !== undefined && env.MYSQL_CA_CERT.trim().length > 0) {
    return env.MYSQL_CA_CERT.replace(/\\n/g, '\n');
  }

  if (env.MYSQL_CA_CERT_BASE64 !== undefined && env.MYSQL_CA_CERT_BASE64.trim().length > 0) {
    const decoded = Buffer.from(env.MYSQL_CA_CERT_BASE64.trim(), 'base64').toString('utf8').trim();
    if (!decoded) {
      throw new MysqlConfigurationError(
        'MYSQL_CA_CERT_BASE64 was provided but decoded to an empty certificate.',
      );
    }
    return decoded;
  }

  if (env.MYSQL_CA_CERT_PATH !== undefined && env.MYSQL_CA_CERT_PATH.trim().length > 0) {
    const certPath = env.MYSQL_CA_CERT_PATH.trim();
    if (!fs.existsSync(certPath)) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH points to a file that does not exist: ${certPath}`,
      );
    }
    const stat = fs.statSync(certPath);
    if (!stat.isFile()) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH must point to a regular certificate file: ${certPath}`,
      );
    }
    const content = fs.readFileSync(certPath, 'utf8').trim();
    if (!content) {
      throw new MysqlConfigurationError(
        `MYSQL_CA_CERT_PATH certificate file is empty: ${certPath}`,
      );
    }
    return content;
  }

  return undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number, min = 1): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

export function buildMysqlPoolOptions(env: NodeJS.ProcessEnv = process.env) {
  const status = getMysqlConfigStatus(env);
  if (!status.configured) {
    return null;
  }

  const isProd = env.NODE_ENV === 'production';
  const sslEnabled = env.MYSQL_SSL_ENABLED !== 'false';
  const rejectUnauthorized = env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false';

  if (isProd && (!sslEnabled || !rejectUnauthorized)) {
    throw new MysqlConfigurationError(
      'Strict MySQL TLS verification cannot be disabled in production (MYSQL_SSL_ENABLED and MYSQL_SSL_REJECT_UNAUTHORIZED must not be false).',
    );
  }

  if (sslEnabled && !rejectUnauthorized) {
    throw new MysqlConfigurationError(
      'MySQL TLS certificate verification cannot be silently disabled while MYSQL_SSL_ENABLED is true (MYSQL_SSL_REJECT_UNAUTHORIZED must remain true).',
    );
  }

  const ca = resolveMysqlCaCertificate(env);

  const sslOption = sslEnabled
    ? {
        ca,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2' as const,
      }
    : undefined;

  const connectionLimit = parsePositiveInt(env.MYSQL_CONNECTION_LIMIT, 10, 1);
  const connectTimeout = parsePositiveInt(env.MYSQL_CONNECT_TIMEOUT_MS, 10000, 1000);

  if (status.mode === 'url' && env.MYSQL_URL) {
    let url: URL;
    try {
      url = new URL(env.MYSQL_URL);
    } catch {
      throw new MysqlConfigurationError(
        'MYSQL_URL is not a valid MySQL connection URI.',
      );
    }

    const sslModeParam = (
      url.searchParams.get('ssl-mode') ||
      url.searchParams.get('sslmode') ||
      ''
    ).toLowerCase();
    const sslParam = (url.searchParams.get('ssl') || '').toLowerCase();

    if (
      (sslEnabled || isProd) &&
      (sslModeParam === 'disabled' || sslModeParam === 'disable' || sslParam === 'false')
    ) {
      throw new MysqlConfigurationError(
        'MYSQL_URL attempts to disable SSL while strict TLS verification is active.',
      );
    }

    return {
      host: url.hostname,
      port: url.port ? Number.parseInt(url.port, 10) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, '') || env.MYSQL_DATABASE || 'levelup_rwanda',
      ssl: sslOption,
      waitForConnections: true,
      connectionLimit,
      connectTimeout,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      timezone: 'Z',
      multipleStatements: false,
    };
  }

  return {
    host: env.MYSQL_HOST!,
    port: parsePositiveInt(env.MYSQL_PORT, 3306, 1),
    user: env.MYSQL_USER!,
    password: env.MYSQL_PASSWORD!,
    database: env.MYSQL_DATABASE!,
    ssl: sslOption,
    waitForConnections: true,
    connectionLimit,
    connectTimeout,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: 'Z',
    multipleStatements: false,
  };
}
