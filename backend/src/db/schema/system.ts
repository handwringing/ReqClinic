import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Migration tracking table.
 *
 * Each applied migration file (`<name>.sql`) is recorded here with the
 * timestamp at which it was applied. This is the bootstrap table created
 * directly by {@link ../migrate.ts} before any migration file runs.
 */
export const schemaMigrations = sqliteTable('schema_migrations', {
  id: text('id').primaryKey(),
  appliedAt: text('applied_at').notNull(),
});

export type SchemaMigration = typeof schemaMigrations.$inferSelect;
export type NewSchemaMigration = typeof schemaMigrations.$inferInsert;
