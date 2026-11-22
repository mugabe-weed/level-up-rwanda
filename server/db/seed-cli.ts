import dotenv from 'dotenv';
import { closePool } from './pool.ts';
import { runSeeds } from './seed.ts';

dotenv.config();

async function main() {
  const result = await runSeeds();
  console.log('Seeded sections:', result.seededSections.join(', '));
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
