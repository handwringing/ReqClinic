import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { env } from '../config/env';
import { createDb } from './client';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

interface MigrationRow {
  id: string;
}

/**
 * Apply pending `.sql` migration files from {@link MIGRATIONS_DIR} in filename
 * order. Each migration runs inside a single transaction and is recorded in
 * `schema_migrations` so it is never re-applied.
 *
 * The `schema_migrations` table itself is bootstrapped here (not via a
 * migration file) so the very first run on an empty database can proceed.
 *
 * If the migrations directory does not exist, this is a no-op after the
 * bootstrap table is ensured.
 */
export function runMigrations(raw: Database.Database): { applied: string[] } {
  raw.exec(BOOTSTRAP_SQL);

  const applied: string[] = [];
  if (!existsSync(MIGRATIONS_DIR)) {
    return { applied };
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const alreadyApplied = new Set(
    (
      raw.prepare('SELECT id FROM schema_migrations').all() as MigrationRow[]
    ).map((r) => r.id),
  );

  const insertMigration = raw.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (alreadyApplied.has(id)) continue;

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const apply = raw.transaction(() => {
      raw.exec(sql);
      insertMigration.run(id, new Date().toISOString());
    });
    apply();
    applied.push(id);
  }

  return { applied };
}

/** True when this module is the process entry point. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

// ---- CLI entry point ----------------------------------------------------
// `npm run db:migrate` invokes this file directly. When imported (e.g. by the
// server) the guard below prevents the standalone run.
if (isMainModule()) {
  const { raw } = createDb(env.DATABASE_PATH);
  const { applied } = runMigrations(raw);
  if (applied.length === 0) {
    console.log('[db:migrate] no pending migrations');
  } else {
    console.log(`[db:migrate] applied ${applied.length} migration(s):`);
    for (const id of applied) console.log(`  - ${id}`);
  }
  raw.close();
}
