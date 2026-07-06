import { sqliteTable, text, integer, check, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { projects } from './project';
import { aiJobs } from './job';

/**
 * Formal project guidance workspace.
 *
 * These tables are intentionally projection-oriented. They do not create
 * formal baselines, approved requirements, or released reports; they store the
 * AI-guided demand map and conversation needed by the first formal-project
 * experience.
 */

export const formalMapSnapshots = sqliteTable(
  'formal_map_snapshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceQuickSessionId: text('source_quick_session_id'),
    sourceBriefVersionId: text('source_brief_version_id'),
    aiJobId: text('ai_job_id').references(() => aiJobs.id, { onDelete: 'set null' }),
    snapshotJson: text('snapshot_json').notNull(),
    inputHash: text('input_hash').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('formal_map_snapshots_version_check', sql`version > 0`),
    check('formal_map_snapshots_status_check', sql`status IN ('draft','ready','fallback')`),
    check('formal_map_snapshots_source_kind_check', sql`source_kind IN ('direct','quick_upgrade','conversation_update','fallback')`),
    check('formal_map_snapshots_snapshot_json_check', sql`json_valid(snapshot_json)`),
    uniqueIndex('uq_formal_map_snapshots_project_version').on(t.projectId, t.version),
    index('idx_formal_map_snapshots_project_version').on(t.projectId, t.version),
    index('idx_formal_map_snapshots_job').on(t.aiJobId),
  ],
);

export const formalTurns = sqliteTable(
  'formal_turns',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    turnIndex: integer('turn_index').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    messageType: text('message_type').notNull(),
    boundRefsJson: text('bound_refs_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('formal_turns_turn_index_check', sql`turn_index >= 0`),
    check('formal_turns_role_check', sql`role IN ('ai','user')`),
    check('formal_turns_message_type_check', sql`message_type IN ('question','answer','status')`),
    check('formal_turns_bound_refs_json_check', sql`json_valid(bound_refs_json)`),
    uniqueIndex('uq_formal_turns_project_index').on(t.projectId, t.turnIndex),
    index('idx_formal_turns_project').on(t.projectId),
  ],
);

export type FormalMapSnapshot = typeof formalMapSnapshots.$inferSelect;
export type NewFormalMapSnapshot = typeof formalMapSnapshots.$inferInsert;
export type FormalTurn = typeof formalTurns.$inferSelect;
export type NewFormalTurn = typeof formalTurns.$inferInsert;
