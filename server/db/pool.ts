import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { buildMysqlPoolOptions, getMysqlConfigStatus } from './config.ts';

export class DatabaseUnavailableError extends Error {
  public readonly code = 'DATABASE_NOT_CONFIGURED';
  public readonly statusCode = 503;
  public readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(
      `MySQL 8 database is not configured. Supply environment variables: ${missingFields.join(', ')}`,
    );
    this.name = 'DatabaseUnavailableError';
    this.missingFields = missingFields;
  }
}

let poolInstance: Pool | null = null;

export function getPool(): Pool {
  if (poolInstance) {
    return poolInstance;
  }
  const options = buildMysqlPoolOptions();
  if (!options) {
    const status = getMysqlConfigStatus();
    throw new DatabaseUnavailableError(status.missingFields);
  }
  poolInstance = mysql.createPool(options);
  return poolInstance;
}

export function isDatabaseConfigured(): boolean {
  return getMysqlConfigStatus().configured;
}

export function scrubDatabaseSecrets(text: string): string {
  return text
    .replace(/mysqls?:\/\/[^@\s]+@/gi, 'mysql://[REDACTED]@')
    .replace(/(password\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]');
}

export function formatDatabaseErrorForLog(err: unknown): Record<string, unknown> {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return {
      name: typeof e.name === 'string' ? e.name : 'DatabaseError',
      code: typeof e.code === 'string' ? e.code : undefined,
      errno: typeof e.errno === 'number' ? e.errno : undefined,
      sqlState: typeof e.sqlState === 'string' ? e.sqlState : undefined,
      message:
        typeof e.message === 'string'
          ? scrubDatabaseSecrets(e.message)
          : 'Unknown database error',
    };
  }
  return { message: scrubDatabaseSecrets(String(err)) };
}

export function formatReadinessDatabaseError(err: unknown, isProduction: boolean): string {
  if (isProduction) {
    return 'Database connection unavailable';
  }
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    const msg = scrubDatabaseSecrets(err.message);
    return code ? `${code}: ${msg}` : msg;
  }
  return 'Database connection error';
}

export async function pingDatabase(options?: {
  isProduction?: boolean;
  probeFn?: () => Promise<void>;
}): Promise<{
  connected: boolean;
  configured: boolean;
  missingFields: string[];
  latencyMs?: number;
  error?: string;
}> {
  const status = getMysqlConfigStatus();
  if (!status.configured) {
    return {
      connected: false,
      configured: false,
      missingFields: status.missingFields,
    };
  }

  const isProd = options?.isProduction ?? process.env.NODE_ENV === 'production';
  const startedAt = Date.now();
  try {
    if (options?.probeFn) {
      await options.probeFn();
    } else {
      const pool = getPool();
      await pool.query('SELECT 1 AS ok');
    }
    return {
      connected: true,
      configured: true,
      missingFields: [],
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    console.error('[MySQL Readiness Error]', formatDatabaseErrorForLog(err));
    return {
      connected: false,
      configured: true,
      missingFields: [],
      error: formatReadinessDatabaseError(err, isProd),
    };
  }
}

export async function queryRows<T extends RowDataPacket[]>(
  sql: string,
  params: unknown[] = [],
  conn?: PoolConnection,
): Promise<T> {
  const executor = conn ?? getPool();
  const [rows] = await executor.execute<T>(sql, params as any[]);
  return rows;
}

export async function executeSql(
  sql: string,
  params: unknown[] = [],
  conn?: PoolConnection,
): Promise<ResultSetHeader> {
  const executor = conn ?? getPool();
  const [result] = await executor.execute<ResultSetHeader>(sql, params as any[]);
  return result;
}

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
