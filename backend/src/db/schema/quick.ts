import { sqliteTable, text, integer, check, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users, guestSessions } from './identity';
import { projects } from './project';

/**
 * Quick consult & requirement brief (§4A): quick_sessions, quick_turns,
 * quick_unknowns, brief_versions, brief_exports, option_preferences,
 * upgrade_records.
 *
 * Quick consult state machine
 *   draft → clarifying → understanding_review → option_review → brief_ready
 *         → upgraded / archived
 * is independent of the formal analysis state machine (§12.1).
 */

// §4A.1 quick_sessions
export const quickSessions = sqliteTable(
  'quick_sessions',
  {
    id: text('id').primaryKey(),
    guestSessionId: text('guest_session_id').references(() => guestSessions.id, { onDelete: 'restrict' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'restrict' }),
    originGuestSessionId: text('origin_guest_session_id').references(() => guestSessions.id, { onDelete: 'restrict' }),
    claimedAt: text('claimed_at'),
    status: text('status').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceCaseId: text('source_case_id'),
    originalInput: text('original_input').notNull(),
    intent: text('intent'),
    decisionIntent: text('decision_intent'),
    coverageSlotsJson: text('coverage_slots_json').notNull().default('{}'),
    currentUnderstandingVersion: integer('current_understanding_version').notNull().default(0),
    // FK to brief_versions declared in a deferred migration SQL file to avoid
    // circular type inference quickSessions ↔ briefVersions within this file.
    // (briefVersions.quickSessionId → quickSessions.id is a safe backward
    // column-level reference declared below.)
    currentBriefVersionId: text('current_brief_version_id'),
    expiresAt: text('expires_at'),
    lastActiveAt: text('last_active_at').notNull(),
    upgradedAt: text('upgraded_at'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    check(
      'quick_sessions_status_check',
      sql`status IN ('draft','clarifying','understanding_review','option_review','brief_ready','upgraded','archived')`,
    ),
    check(
      'quick_sessions_source_kind_check',
      sql`source_kind IN ('custom','sample','training_fixture','internal_test')`,
    ),
    check('quick_sessions_original_input_check', sql`length(trim(original_input)) > 0`),
    check('quick_sessions_coverage_slots_json_check', sql`json_valid(coverage_slots_json)`),
    check('quick_sessions_version_check', sql`version > 0`),
    // guest_session_id XOR user_id
    check(
      'quick_sessions_owner_xor',
      sql`(guest_session_id IS NOT NULL AND user_id IS NULL)
        OR (guest_session_id IS NULL AND user_id IS NOT NULL)`,
    ),
    check(
      'quick_sessions_origin_check',
      sql`origin_guest_session_id IS NULL OR origin_guest_session_id = guest_session_id OR user_id IS NOT NULL`,
    ),
    index('idx_quick_sessions_guest_session_id').on(t.guestSessionId),
    index('idx_quick_sessions_user_id').on(t.userId),
    index('idx_quick_sessions_origin_guest_session_id').on(t.originGuestSessionId),
    index('idx_quick_sessions_status').on(t.status),
    index('idx_quick_sessions_expires_at').on(t.expiresAt),
  ],
);

// §4A.1a quick_turns
export const quickTurns = sqliteTable(
  'quick_turns',
  {
    id: text('id').primaryKey(),
    quickSessionId: text('quick_session_id').notNull().references(() => quickSessions.id, { onDelete: 'cascade' }),
    turnIndex: integer('turn_index').notNull(),
    role: text('role').notNull(),
    questionId: text('question_id'),
    content: text('content').notNull(),
    understandingVersion: integer('understanding_version'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('quick_turns_turn_index_check', sql`turn_index >= 0`),
    check('quick_turns_role_check', sql`role IN ('ai','user')`),
    uniqueIndex('uq_quick_turns_session_index').on(t.quickSessionId, t.turnIndex),
  ],
);

// §4A.1b quick_unknowns
export const quickUnknowns = sqliteTable(
  'quick_unknowns',
  {
    id: text('id').primaryKey(),
    quickSessionId: text('quick_session_id').notNull().references(() => quickSessions.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    description: text('description').notNull(),
    isBlocking: integer('is_blocking').notNull().default(1),
    resolvedAt: text('resolved_at'),
    resolvedByTurnId: text('resolved_by_turn_id').references(() => quickTurns.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check(
      'quick_unknowns_category_check',
      sql`category IN ('expected_outcome','user_object','core_scenarios','scope_boundary','completion_criteria','constraints_risks')`,
    ),
    check('quick_unknowns_is_blocking_check', sql`is_blocking IN (0,1)`),
  ],
);

// §4A.2 brief_versions
export const briefVersions = sqliteTable(
  'brief_versions',
  {
    id: text('id').primaryKey(),
    // Backward reference to quick_sessions (defined above); safe column-level
    // .references() since quickSessions does not column-reference briefVersions.
    quickSessionId: text('quick_session_id').notNull().references(() => quickSessions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    isIncomplete: integer('is_incomplete').notNull().default(0),
    blockingUnknownCount: integer('blocking_unknown_count').notNull().default(0),
    generatedAt: text('generated_at').notNull(),
    generatedBy: text('generated_by').notNull(),
  },
  (t) => [
    check('brief_versions_version_check', sql`version > 0`),
    check('brief_versions_snapshot_json_check', sql`json_valid(snapshot_json)`),
    check('brief_versions_is_incomplete_check', sql`is_incomplete IN (0,1)`),
    uniqueIndex('uq_brief_versions_session_version').on(t.quickSessionId, t.version),
  ],
);

// §4A.3 brief_exports
export const briefExports = sqliteTable(
  'brief_exports',
  {
    id: text('id').primaryKey(),
    briefVersionId: text('brief_version_id').notNull().references(() => briefVersions.id, { onDelete: 'cascade' }),
    viewType: text('view_type').notNull(),
    exportType: text('export_type').notNull(),
    exportedAt: text('exported_at').notNull(),
    exportedBy: text('exported_by').notNull(),
    expiresAt: text('expires_at'),
  },
  (t) => [
    check('brief_exports_view_type_check', sql`view_type IN ('simple','exec')`),
    check('brief_exports_export_type_check', sql`export_type IN ('copy','download')`),
    index('idx_brief_exports_brief_version_id').on(t.briefVersionId),
    index('idx_brief_exports_expires_at').on(t.expiresAt),
  ],
);

// §4A.4 option_preferences
export const optionPreferences = sqliteTable(
  'option_preferences',
  {
    id: text('id').primaryKey(),
    quickSessionId: text('quick_session_id').notNull().references(() => quickSessions.id, { onDelete: 'cascade' }),
    briefVersionId: text('brief_version_id').references(() => briefVersions.id, { onDelete: 'set null' }),
    optionId: text('option_id').notNull(),
    matchesAiRecommendation: integer('matches_ai_recommendation').notNull(),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: text('recorded_at').notNull(),
  },
  (t) => [
    check('option_preferences_matches_ai_recommendation_check', sql`matches_ai_recommendation IN (0,1)`),
  ],
);

// §4A.5 upgrade_records
export const upgradeRecords = sqliteTable(
  'upgrade_records',
  {
    id: text('id').primaryKey(),
    quickSessionId: text('quick_session_id').notNull().references(() => quickSessions.id, { onDelete: 'cascade' }),
    briefVersionId: text('brief_version_id').notNull().references(() => briefVersions.id, { onDelete: 'cascade' }),
    targetProjectId: text('target_project_id').references(() => projects.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status').notNull(),
    errorCategory: text('error_category'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (t) => [
    check('upgrade_records_status_check', sql`status IN ('started','succeeded','failed')`),
    uniqueIndex('uq_upgrade_records_session_key').on(t.quickSessionId, t.idempotencyKey),
    index('idx_upgrade_records_target_project_id').on(t.targetProjectId),
    // succeeded ⇒ target_project_id NOT NULL; started/failed ⇒ NULL (full rollback).
    check(
      'upgrade_records_status_target_xor',
      sql`(status='succeeded' AND target_project_id IS NOT NULL)
        OR (status IN ('started','failed') AND target_project_id IS NULL)`,
    ),
  ],
);

export type QuickSession = typeof quickSessions.$inferSelect;
export type NewQuickSession = typeof quickSessions.$inferInsert;
export type QuickTurn = typeof quickTurns.$inferSelect;
export type NewQuickTurn = typeof quickTurns.$inferInsert;
export type QuickUnknown = typeof quickUnknowns.$inferSelect;
export type NewQuickUnknown = typeof quickUnknowns.$inferInsert;
export type BriefVersion = typeof briefVersions.$inferSelect;
export type NewBriefVersion = typeof briefVersions.$inferInsert;
export type BriefExport = typeof briefExports.$inferSelect;
export type NewBriefExport = typeof briefExports.$inferInsert;
export type OptionPreference = typeof optionPreferences.$inferSelect;
export type NewOptionPreference = typeof optionPreferences.$inferInsert;
export type UpgradeRecord = typeof upgradeRecords.$inferSelect;
export type NewUpgradeRecord = typeof upgradeRecords.$inferInsert;
