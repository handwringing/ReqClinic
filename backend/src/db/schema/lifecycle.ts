import { sqliteTable, text, integer, check, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Retention, deletion and recovery domain (§14).
 *
 * `delete_tasks` records soft/hard deletion requests with legal-hold awareness.
 * `deletion_ledger` is an append-only hash-chained ledger that survives main-DB
 * snapshots so deleted facts can be replayed after a restore (preventing
 * resurrection of deleted data). Per §14.4 the ledger is conceptually outside
 * the main database; here it is materialised as a SQLite table but
 * intentionally has NO foreign key to `delete_tasks` — a FK would be violated
 * when the main DB is restored to a snapshot predating the task row.
 */

// §14.1 delete_tasks
export const deleteTasks = sqliteTable(
  'delete_tasks',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    // target_id is the id of the object to delete; validity is enforced by the
    // application layer based on `scope` (doc §14.1).
    targetId: text('target_id').notNull(),
    requesterType: text('requester_type').notNull(),
    // requester_id resolves to users.id or guest_sessions.id by `requester_type`;
    // application-layer validated (doc §14.1).
    requesterId: text('requester_id').notNull(),
    reason: text('reason'),
    status: text('status').notNull(),
    // legal_hold=1 pauses physical deletion and surfaces status to the user.
    legalHold: integer('legal_hold').notNull().default(0),
    legalHoldReason: text('legal_hold_reason'),
    // Server-computed estimated physical purge time for GET /delete-tasks/:id.
    estimatedPurgeAt: text('estimated_purge_at'),
    completedAt: text('completed_at'),
    failureReason: text('failure_reason'),
    // audit_ref holds only an audit reference, never deleted business body.
    auditRef: text('audit_ref'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'delete_tasks_scope_check',
      sql`scope IN ('quick_session','formal_project','training_attempt','user_account','expired_data','temp_export')`,
    ),
    check('delete_tasks_requester_type_check', sql`requester_type IN ('user','guest','system')`),
    check('delete_tasks_status_check', sql`status IN ('pending','in_progress','completed','failed','cancelled')`),
    check('delete_tasks_legal_hold_check', sql`legal_hold IN (0,1)`),
    index('idx_delete_tasks_target_id').on(t.targetId),
    index('idx_delete_tasks_status').on(t.status),
  ],
);

// §14.4 deletion_ledger
export const deletionLedger = sqliteTable(
  'deletion_ledger',
  {
    // Monotonic append-only sequence; auto-incremented by SQLite.
    ledgerSeq: integer('ledger_seq').primaryKey({ autoIncrement: true }),
    // No FK to delete_tasks: the ledger must survive main-DB snapshots and
    // remain valid after a restore to a point before the task row existed.
    deleteTaskId: text('delete_task_id').notNull(),
    scope: text('scope').notNull(),
    // target_hmac = HMAC(server_ledger_key, scope || ':' || target_id); never
    // stores business body or the plaintext target id beyond the HMAC input.
    targetHmac: text('target_hmac').notNull(),
    acceptedAt: text('accepted_at').notNull(),
    status: text('status').notNull(),
    // db_snapshot_watermark ties an entry to the DB snapshot watermark at write
    // time so the restore replay can find entries after the snapshot.
    dbSnapshotWatermark: text('db_snapshot_watermark'),
    // entry_hash covers all fields except itself plus prev_entry_hash, forming
    // a verifiable chain; a broken chain is a P0 restore blocker (§14.4).
    entryHash: text('entry_hash').notNull(),
    prevEntryHash: text('prev_entry_hash'),
    writtenAt: text('written_at').notNull(),
  },
  (t) => [
    check(
      'deletion_ledger_scope_check',
      sql`scope IN ('quick_session','formal_project','training_attempt','user_account','expired_data','temp_export')`,
    ),
    check('deletion_ledger_status_check', sql`status IN ('accepted','completed','failed','cancelled')`),
  ],
);

export type DeleteTask = typeof deleteTasks.$inferSelect;
export type NewDeleteTask = typeof deleteTasks.$inferInsert;
export type DeletionLedgerEntry = typeof deletionLedger.$inferSelect;
export type NewDeletionLedgerEntry = typeof deletionLedger.$inferInsert;
