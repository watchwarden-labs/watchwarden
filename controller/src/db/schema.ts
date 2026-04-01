import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/logger.js';
import { sql } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  // Create migrations tracking table
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const migrationsDir = join(__dirname, 'migrations');
  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    // In compiled JS, migrations dir may be at a different relative path
    const altDir = join(process.cwd(), 'src', 'db', 'migrations');
    try {
      files = readdirSync(altDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
    } catch {
      log.warn('migrate', '[migrate] No migrations directory found, skipping');
      return;
    }
    for (const file of files) {
      await applyMigration(altDir, file);
    }
    return;
  }

  for (const file of files) {
    await applyMigration(migrationsDir, file);
  }
}

async function applyMigration(dir: string, file: string): Promise<void> {
  const [applied] = await sql`SELECT name FROM _migrations WHERE name = ${file}`;
  if (applied) return;

  const content = readFileSync(join(dir, file), 'utf-8');
  log.info('migrate', `[migrate] Applying ${file}`);
  // NOTE: postgres.js does not support sql.unsafe inside sql.begin() transactions
  // (limitation of the library). Migrations are NOT wrapped in a transaction, so a
  // partial failure leaves the DB in an intermediate state. To compensate:
  // 1. All DDL uses IF NOT EXISTS / IF EXISTS to be safely re-runnable
  // 2. The _migrations INSERT happens AFTER the DDL — a re-run on the same
  //    file will re-apply the idempotent DDL and then succeed on the INSERT
  // 3. PostgreSQL DDL is transactional by default for single statements, so
  //    each CREATE TABLE / ALTER TABLE is atomic individually
  await sql.unsafe(content);
  await sql`INSERT INTO _migrations (name) VALUES (${file})`;
}
