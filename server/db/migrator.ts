import { RowDataPacket } from 'mysql2/promise';
import { getPool } from './pool.ts';
import { migration001InitialSchema } from './migrations/001_initial_schema.ts';
import { Migration } from './migrations/types.ts';

export const ALL_MIGRATIONS: Migration[] = [migration001InitialSchema];

export interface ExpectedTableSpec {
  migrationId: string;
  tableName: string;
  columns: string[];
  expectedEngine: string;
  expectedCharset: string;
}

export interface ExistingTableInfo {
  tableName: string;
  engine: string | null;
  collation: string | null;
}

export interface ExistingColumnInfo {
  tableName: string;
  columnName: string;
  columnType?: string | null;
}

export interface TableCompatibilityIssue {
  tableName: string;
  reason:
    | 'UNTRACKED_EXISTING_TABLE'
    | 'MISSING_EXPECTED_TABLE'
    | 'MISSING_COLUMNS'
    | 'ENGINE_MISMATCH'
    | 'COLLATION_MISMATCH';
  detail: string;
}

export interface SchemaCompatibilityReport {
  compatible: boolean;
  state: 'fresh_empty' | 'pending_clean' | 'up_to_date' | 'incompatible';
  hasMigrationsTable: boolean;
  appliedMigrations: string[];
  pendingMigrations: string[];
  expectedApplicationTableCount: number;
  existingTableCount: number;
  untrackedMatchingTables: string[];
  missingTablesOnApplied: string[];
  existingNonMigrationTables: string[];
  tableIssues: TableCompatibilityIssue[];
}

export class MigrationSafetyError extends Error {
  public readonly report: SchemaCompatibilityReport;

  constructor(message: string, report: SchemaCompatibilityReport) {
    super(message);
    this.name = 'MigrationSafetyError';
    this.report = report;
  }
}

export function extractExpectedTablesFromMigration(migration: Migration): ExpectedTableSpec[] {
  const specs: ExpectedTableSpec[] = [];
  const createRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?\s*\(([\s\S]*)\)\s*ENGINE=([a-zA-Z0-9_]+)\s+DEFAULT\s+CHARSET=([a-zA-Z0-9_]+)/i;

  for (const stmt of migration.upStatements) {
    const match = stmt.match(createRegex);
    if (!match) continue;
    const [, tableName, body, engine, charset] = match;

    const columns: string[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^(PRIMARY\s+KEY|UNIQUE\s+KEY|KEY\s+|INDEX\s+|CONSTRAINT\s+|FULLTEXT\s+)/i.test(line)) {
        continue;
      }
      const colMatch = line.match(/^`?([a-zA-Z0-9_]+)`?\s+/);
      if (colMatch) {
        columns.push(colMatch[1]);
      }
    }

    specs.push({
      migrationId: migration.id,
      tableName,
      columns,
      expectedEngine: engine,
      expectedCharset: charset,
    });
  }

  return specs;
}

export function extractExpectedTablesRegistry(): ExpectedTableSpec[] {
  return ALL_MIGRATIONS.flatMap(extractExpectedTablesFromMigration);
}

export function analyzeSchemaCompatibility(input: {
  expectedTables: ExpectedTableSpec[];
  existingTables: ExistingTableInfo[];
  existingColumns: ExistingColumnInfo[];
  appliedMigrationIds: string[];
  hasMigrationsTable: boolean;
}): SchemaCompatibilityReport {
  const appliedSet = new Set(input.appliedMigrationIds);
  const allMigrationIds = ALL_MIGRATIONS.map((m) => m.id);
  const pendingMigrations = allMigrationIds.filter((id) => !appliedSet.has(id));

  const existingTableMap = new Map<string, ExistingTableInfo>();
  for (const t of input.existingTables) {
    existingTableMap.set(t.tableName.toLowerCase(), t);
  }

  const columnsByTable = new Map<string, Set<string>>();
  for (const col of input.existingColumns) {
    const key = col.tableName.toLowerCase();
    if (!columnsByTable.has(key)) {
      columnsByTable.set(key, new Set<string>());
    }
    columnsByTable.get(key)!.add(col.columnName.toLowerCase());
  }

  const expectedTableNames = new Set(input.expectedTables.map((t) => t.tableName.toLowerCase()));
  const existingNonMigrationTables = input.existingTables
    .map((t) => t.tableName)
    .filter(
      (name) =>
        name.toLowerCase() !== 'schema_migrations' && !expectedTableNames.has(name.toLowerCase()),
    );

  const untrackedMatchingTables: string[] = [];
  const missingTablesOnApplied: string[] = [];
  const tableIssues: TableCompatibilityIssue[] = [];

  for (const expected of input.expectedTables) {
    const key = expected.tableName.toLowerCase();
    const existing = existingTableMap.get(key);
    const migrationAlreadyApplied = appliedSet.has(expected.migrationId);

    if (!migrationAlreadyApplied) {
      if (existing) {
        untrackedMatchingTables.push(expected.tableName);
        tableIssues.push({
          tableName: expected.tableName,
          reason: 'UNTRACKED_EXISTING_TABLE',
          detail: `Table "${expected.tableName}" already exists even though migration "${expected.migrationId}" is not recorded in schema_migrations.`,
        });
      } else {
        continue;
      }
    } else if (!existing) {
      missingTablesOnApplied.push(expected.tableName);
      tableIssues.push({
        tableName: expected.tableName,
        reason: 'MISSING_EXPECTED_TABLE',
        detail: `Migration "${expected.migrationId}" is marked applied, but table "${expected.tableName}" is missing.`,
      });
      continue;
    }

    if (existing) {
      if (
        existing.engine &&
        existing.engine.toLowerCase() !== expected.expectedEngine.toLowerCase()
      ) {
        tableIssues.push({
          tableName: expected.tableName,
          reason: 'ENGINE_MISMATCH',
          detail: `Expected engine ${expected.expectedEngine}, found ${existing.engine}.`,
        });
      }

      if (
        existing.collation &&
        !existing.collation.toLowerCase().startsWith(expected.expectedCharset.toLowerCase())
      ) {
        tableIssues.push({
          tableName: expected.tableName,
          reason: 'COLLATION_MISMATCH',
          detail: `Expected ${expected.expectedCharset} collation, found ${existing.collation}.`,
        });
      }

      const existingCols = columnsByTable.get(key) ?? new Set<string>();
      const missingCols = expected.columns.filter((c) => !existingCols.has(c.toLowerCase()));
      if (missingCols.length > 0) {
        tableIssues.push({
          tableName: expected.tableName,
          reason: 'MISSING_COLUMNS',
          detail: `Missing expected columns: ${missingCols.join(', ')}.`,
        });
      }
    }
  }

  let state: SchemaCompatibilityReport['state'];
  if (tableIssues.length > 0) {
    state = 'incompatible';
  } else if (
    !input.hasMigrationsTable &&
    input.existingTables.length === 0 &&
    pendingMigrations.length > 0
  ) {
    state = 'fresh_empty';
  } else if (pendingMigrations.length === 0) {
    state = 'up_to_date';
  } else {
    state = 'pending_clean';
  }

  return {
    compatible: state !== 'incompatible',
    state,
    hasMigrationsTable: input.hasMigrationsTable,
    appliedMigrations: [...input.appliedMigrationIds],
    pendingMigrations,
    expectedApplicationTableCount: input.expectedTables.length,
    existingTableCount: input.existingTables.length,
    untrackedMatchingTables,
    missingTablesOnApplied,
    existingNonMigrationTables,
    tableIssues,
  };
}

async function ensureMigrationsTable(): Promise<void> {
  const pool = getPool();
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(120) NOT NULL,
      name VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function getAppliedMigrationIds(): Promise<string[]> {
  await ensureMigrationsTable();
  const pool = getPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM schema_migrations ORDER BY applied_at ASC, id ASC',
  );
  return rows.map((row) => String(row.id));
}

/**
 * Strictly read-only inspection of current schema_migrations, existing tables,
 * columns, engines, and collations against expected migrations.
 * Never executes DDL or writes any records.
 */
export async function inspectMigrationStatus(): Promise<SchemaCompatibilityReport> {
  const pool = getPool();
  const [tableRows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_COLLATION AS collation
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME ASC`,
  );

  const existingTables: ExistingTableInfo[] = tableRows.map((r) => ({
    tableName: String(r.tableName),
    engine: r.engine ? String(r.engine) : null,
    collation: r.collation ? String(r.collation) : null,
  }));

  const hasMigrationsTable = existingTables.some(
    (t) => t.tableName.toLowerCase() === 'schema_migrations',
  );

  let appliedMigrationIds: string[] = [];
  if (hasMigrationsTable) {
    const [migRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM schema_migrations ORDER BY applied_at ASC, id ASC',
    );
    appliedMigrationIds = migRows.map((row) => String(row.id));
  }

  let existingColumns: ExistingColumnInfo[] = [];
  if (existingTables.length > 0) {
    const [colRows] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC`,
    );
    existingColumns = colRows.map((r) => ({
      tableName: String(r.tableName),
      columnName: String(r.columnName),
      columnType: r.columnType ? String(r.columnType) : null,
    }));
  }

  return analyzeSchemaCompatibility({
    expectedTables: extractExpectedTablesRegistry(),
    existingTables,
    existingColumns,
    appliedMigrationIds,
    hasMigrationsTable,
  });
}

export async function dryRunMigrations(): Promise<{
  safeToApply: boolean;
  wouldApply: Array<{ id: string; name: string; statementCount: number }>;
  wouldSkip: string[];
  report: SchemaCompatibilityReport;
}> {
  const report = await inspectMigrationStatus();
  const appliedSet = new Set(report.appliedMigrations);

  const wouldApply: Array<{ id: string; name: string; statementCount: number }> = [];
  const wouldSkip: string[] = [];

  for (const migration of ALL_MIGRATIONS) {
    if (appliedSet.has(migration.id)) {
      wouldSkip.push(migration.id);
    } else {
      wouldApply.push({
        id: migration.id,
        name: migration.name,
        statementCount: migration.upStatements.length,
      });
    }
  }

  return {
    safeToApply: report.compatible,
    wouldApply,
    wouldSkip,
    report,
  };
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const preflight = await inspectMigrationStatus();
  if (!preflight.compatible) {
    const summary = preflight.tableIssues
      .slice(0, 10)
      .map((i) => `${i.tableName}: ${i.detail}`)
      .join(' | ');
    throw new MigrationSafetyError(
      `Refusing to run migrations because pre-existing database schema conflicts were detected (${preflight.tableIssues.length} issue(s)): ${summary}`,
      preflight,
    );
  }

  await ensureMigrationsTable();
  const pool = getPool();
  const appliedIds = new Set(await getAppliedMigrationIds());

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of ALL_MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }

    const conn = await pool.getConnection();
    try {
      for (const stmt of migration.upStatements) {
        await conn.execute(stmt);
      }
      await conn.execute('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [
        migration.id,
        migration.name,
      ]);
      applied.push(migration.id);
    } finally {
      conn.release();
    }
  }

  return { applied, skipped };
}

/**
 * DESTRUCTIVE OPERATOR-ONLY ACTION:
 * Executes all `downStatements` (e.g. DROP TABLE IF EXISTS) for the latest applied migration.
 * Never imported or invoked by runtime server startup or HTTP routes.
 */
export async function rollbackLastMigration(): Promise<string | null> {
  await ensureMigrationsTable();
  const pool = getPool();
  const appliedIds = await getAppliedMigrationIds();
  if (appliedIds.length === 0) {
    return null;
  }

  const lastId = appliedIds[appliedIds.length - 1];
  const migration = ALL_MIGRATIONS.find((m) => m.id === lastId);
  if (!migration) {
    throw new Error(`Migration ${lastId} not found in registry`);
  }

  const conn = await pool.getConnection();
  try {
    for (const stmt of migration.downStatements) {
      await conn.execute(stmt);
    }
    await conn.execute('DELETE FROM schema_migrations WHERE id = ?', [migration.id]);
    return migration.id;
  } finally {
    conn.release();
  }
}
