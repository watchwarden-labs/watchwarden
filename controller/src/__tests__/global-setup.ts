import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const connectionUri = container.getConnectionUri();

  // Run migrations
  const sql = postgres(connectionUri);
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(__dirname, '..', 'db', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const content = readFileSync(join(migrationsDir, file), 'utf-8');
    await sql.unsafe(content);
  }
  await sql.end();

  // Pass connection URI to test workers via env
  process.env.TEST_DATABASE_URL = connectionUri;
}

export async function teardown() {
  await container?.stop();
}
