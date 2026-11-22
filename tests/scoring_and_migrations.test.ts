import { describe, expect, it } from 'vitest';
import {
  ALL_MIGRATIONS,
  analyzeSchemaCompatibility,
  extractExpectedTablesFromMigration,
} from '../server/db/migrator.ts';
import { evaluateChallengeAnswers } from '../server/services/challengeService.ts';

describe('Challenge Scoring Engine', () => {
  const sampleQuestions = [
    {
      id: 1,
      correctOptionIndex: 1,
      pointsWeight: 20,
      explanationEn: 'Never share your PIN.',
      explanationRw: 'Ntugatange PIN yawe.',
      explanationFr: 'Ne partagez jamais votre PIN.',
    },
    {
      id: 2,
      correctOptionIndex: 0,
      pointsWeight: 30,
      explanationEn: 'Check HTTPS and official domain.',
      explanationRw: 'Reba HTTPS na domain yemewe.',
      explanationFr: 'Vérifiez HTTPS et le domaine officiel.',
    },
  ];

  it('awards full XP and score when all answers are correct', () => {
    const res = evaluateChallengeAnswers(
      sampleQuestions,
      [
        { questionId: 1, selectedOptionIndex: 1 },
        { questionId: 2, selectedOptionIndex: 0 },
      ],
      80,
    );
    expect(res.score).toBe(50);
    expect(res.maxScore).toBe(50);
    expect(res.correctCount).toBe(2);
    expect(res.xpAwarded).toBe(80);
    expect(res.breakdown.every((b) => b.isCorrect)).toBe(true);
  });

  it('awards proportional XP and minimum participation floor when partial or zero', () => {
    const partial = evaluateChallengeAnswers(
      sampleQuestions,
      [
        { questionId: 1, selectedOptionIndex: 1 },
        { questionId: 2, selectedOptionIndex: 2 },
      ],
      100,
    );
    expect(partial.score).toBe(20);
    expect(partial.correctCount).toBe(1);
    expect(partial.xpAwarded).toBe(40);

    const zero = evaluateChallengeAnswers(
      sampleQuestions,
      [
        { questionId: 1, selectedOptionIndex: 3 },
        { questionId: 2, selectedOptionIndex: 3 },
      ],
      100,
    );
    expect(zero.score).toBe(0);
    expect(zero.xpAwarded).toBe(25);
  });
});

describe('MySQL 8 Migration Integrity & Schema Compatibility', () => {
  it('defines exactly 33 application tables in 001_initial_schema with matching downStatements', () => {
    const ids = ALL_MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);

    const initial = ALL_MIGRATIONS[0];
    expect(initial.upStatements).toHaveLength(33);
    expect(initial.downStatements).toHaveLength(33);

    const parsedTables = extractExpectedTablesFromMigration(initial);
    expect(parsedTables).toHaveLength(33);
    expect(parsedTables.some((t) => t.tableName === 'schema_migrations')).toBe(false);

    for (const sql of initial.upStatements) {
      expect(sql).toContain('ENGINE=InnoDB');
      expect(sql).toContain('utf8mb4');
    }
  });

  it('identifies a fresh empty database as clean for initial migration', () => {
    const expectedTables = extractExpectedTablesFromMigration(ALL_MIGRATIONS[0]);
    const report = analyzeSchemaCompatibility({
      expectedTables,
      existingTables: [],
      existingColumns: [],
      appliedMigrationIds: [],
      hasMigrationsTable: false,
    });

    expect(report.compatible).toBe(true);
    expect(report.state).toBe('fresh_empty');
    expect(report.pendingMigrations).toEqual(['001_initial_schema']);
    expect(report.expectedApplicationTableCount).toBe(33);
  });

  it('detects untracked pre-existing tables and incompatible columns/engines instead of assuming compatibility', () => {
    const expectedTables = extractExpectedTablesFromMigration(ALL_MIGRATIONS[0]);
    const report = analyzeSchemaCompatibility({
      expectedTables,
      existingTables: [
        { tableName: 'users', engine: 'MyISAM', collation: 'latin1_swedish_ci' },
      ],
      existingColumns: [
        { tableName: 'users', columnName: 'id' },
        { tableName: 'users', columnName: 'email' },
      ],
      appliedMigrationIds: [],
      hasMigrationsTable: false,
    });

    expect(report.compatible).toBe(false);
    expect(report.state).toBe('incompatible');
    expect(report.untrackedMatchingTables).toContain('users');
    expect(report.tableIssues.some((i) => i.reason === 'UNTRACKED_EXISTING_TABLE')).toBe(true);
    expect(report.tableIssues.some((i) => i.reason === 'ENGINE_MISMATCH')).toBe(true);
    expect(report.tableIssues.some((i) => i.reason === 'COLLATION_MISMATCH')).toBe(true);
    expect(report.tableIssues.some((i) => i.reason === 'MISSING_COLUMNS')).toBe(true);
  });

  it('marks fully matching migrated database as up_to_date', () => {
    const expectedTables = extractExpectedTablesFromMigration(ALL_MIGRATIONS[0]);
    const existingTables = [
      { tableName: 'schema_migrations', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' },
      ...expectedTables.map((t) => ({
        tableName: t.tableName,
        engine: 'InnoDB',
        collation: 'utf8mb4_unicode_ci',
      })),
    ];
    const existingColumns = expectedTables.flatMap((t) =>
      t.columns.map((columnName) => ({ tableName: t.tableName, columnName })),
    );

    const report = analyzeSchemaCompatibility({
      expectedTables,
      existingTables,
      existingColumns,
      appliedMigrationIds: ['001_initial_schema'],
      hasMigrationsTable: true,
    });

    expect(report.compatible).toBe(true);
    expect(report.state).toBe('up_to_date');
    expect(report.pendingMigrations).toEqual([]);
    expect(report.tableIssues).toEqual([]);
  });
});
