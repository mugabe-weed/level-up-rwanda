import dotenv from 'dotenv';
import { bootstrapAdminSchema } from '../../shared/schemas.ts';
import { provisionFirstSuperAdmin } from './bootstrapAdmin.ts';
import { closePool } from './pool.ts';

dotenv.config();

function getArg(name: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

async function main() {
  const parsed = bootstrapAdminSchema.safeParse({
    bootstrapToken: getArg('token') || process.env.ADMIN_BOOTSTRAP_TOKEN || '',
    email: getArg('email'),
    displayName: getArg('name'),
    username: getArg('username'),
    password: getArg('password'),
  });

  if (!parsed.success) {
    console.error('Validation failed:', parsed.error.flatten().fieldErrors);
    console.error(
      'Usage: npm run bootstrap-admin -- --email=admin@example.rw --name="Platform Admin" --username=rw_admin --password="StrongPassword123!" --token="$ADMIN_BOOTSTRAP_TOKEN"',
    );
    process.exitCode = 1;
    return;
  }

  const admin = await provisionFirstSuperAdmin({
    email: parsed.data.email,
    displayName: parsed.data.displayName,
    username: parsed.data.username,
    password: parsed.data.password,
  });

  console.log('First super_admin provisioned:', admin);
}

main()
  .catch((err) => {
    console.error('Bootstrap admin failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
