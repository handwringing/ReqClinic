import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index';

export type DrizzleDB = BetterSQLite3Database<typeof schema>;

export interface AppDb {
  /** The underlying better-sqlite3 driver — used for raw pragmas, migrations
   *  and statements that are awkward to express through Drizzle. */
  raw: Database.Database;
  /** The Drizzle query builder bound to {@link schema}. */
  db: DrizzleDB;
}

/**
 * Open a SQLite database, apply the standard PRAGMA set, and wrap it with
 * Drizzle.
 *
 * @param databasePath file path, or `:memory:` for an in-process database.
 */
export function createDb(databasePath: string): AppDb {
  const raw = new Database(databasePath);
  // Enforce foreign keys (cascade/restrict behaviour declared in schema).
  raw.pragma('foreign_keys = ON');
  // WAL gives concurrent readers + a single writer with crash safety.
  raw.pragma('journal_mode = WAL');
  // FULL is the safest synchronous mode; trades a little write throughput for
  // durability guarantees required by the spec.
  raw.pragma('synchronous = FULL');
  // Wait up to 5s on lock contention before throwing SQLITE_BUSY.
  raw.pragma('busy_timeout = 5000');

  const db = drizzle(raw, { schema });
  return { raw, db };
}
