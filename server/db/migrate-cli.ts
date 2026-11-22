import dotenv from 'dotenv';
import { closePool } from './pool.ts';
import {
  dryRunMigrations,
  inspectMigrationStatus,
  rollbackLastMigration,
  runMigrations,
} from './migrator.ts';

dotenv.config();

function printUsage() {
  console.log(`LEVELUP RWANDA Migration CLI

Commands:
  up                                  Apply pending migrations (runs pre-flight schema compatibility check)
  status                              Read-only inspection of applied/pending migrations and table compatibility
  dry-run                             Read-only preview of pending migrations without modifying the database
  down --confirm-destructive-down     DESTRUCTIVE: Runs DROP TABLE IF EXISTS rollback for latest migration
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'up';

  if (command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'status') {
    const report = await inspectMigrationStatus();
    console.log(JSON.stringify(report, null, 2));
    if (!report.compatible) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'dry-run') {
    const preview = await dryRunMigrations();
    console.log(JSON.stringify(preview, null, 2));
    if (!preview.safeToApply) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'down') {
    const hasCliConfirm = args.includes('--confirm-destructive-down');
    const hasEnvConfirm = process.env.CONFIRM_DESTRUCTIVE_ROLLBACK === 'YES_DROP_ALL_TABLES';
    if (!hasCliConfirm && !hasEnvConfirm) {
      console.error(
        'REFUSED: The "down" command is DESTRUCTIVE and executes DROP TABLE IF EXISTS across application tables, permanently deleting all data.',
      );
      console.error(
        'To intentionally execute rollback in a non-production or recovery environment, pass --confirm-destructive-down.',
      );
      process.exitCode = 1;
      return;
    }
    const rolledBack = await rollbackLastMigration();
    console.log(rolledBack ? `Rolled back migration: ${rolledBack}` : 'No migrations to roll back.');
    return;
  }

  if (command === 'up') {
    const result = await runMigrations();
    console.log('Applied migrations:', result.applied);
    console.log('Skipped migrations:', result.skipped);
    return;
  }

  console.error(`Unknown migration command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
