import { sqliteTable, text, integer, primaryKey, check, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projects } from './project';
import { requirements } from './core';

/**
 * Review, versioning & baselines (§7) plus formal-project tasks (§7A).
 *
 * `review_actions` is append-only. Approving a baseline freezes `baseline_items`
 * and the data hash; reports may only read from a named baseline and its frozen
 * entity versions, never from current mutable rows.
 *
 * Note: the §7.2 DDL shorthand for `requirement_versions`/`baselines`/
 * `baseline_items` omits NOT NULL on several columns that are semantically
 * required; those are filled in here per §2 conventions and noted inline.
 */

// §7.1 review_actions
export const reviewActions = sqliteTable(
  'review_actions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    gate: text('gate'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    entityVersion: integer('entity_version').notNull(),
    action: text('action').notNull(),
    beforeValue: text('before_value'),
    afterValue: text('after_value'),
    reviewerId: text('reviewer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    followUpJson: text('follow_up_json'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check(
      'review_actions_gate_check',
      sql`gate IS NULL OR gate IN ('outcome','evidence_conflict','scope','domain_profile','report_release')`,
    ),
    check('review_actions_action_check', sql`action IN ('accept','modify','reject','uncertain')`),
    check('review_actions_before_value_check', sql`before_value IS NULL OR json_valid(before_value)`),
    check('review_actions_after_value_check', sql`after_value IS NULL OR json_valid(after_value)`),
    check('review_actions_follow_up_json_check', sql`follow_up_json IS NULL OR json_valid(follow_up_json)`),
    index('idx_review_actions_project_gate_created').on(t.projectId, t.gate, t.createdAt),
  ],
);

// §7.2 requirement_versions
export const requirementVersions = sqliteTable(
  'requirement_versions',
  {
    id: text('id').primaryKey(),
    // NOT NULL filled in per §2 (doc shorthand omitted it).
    requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    changedBy: text('changed_by').references(() => users.id, { onDelete: 'restrict' }),
    changeReason: text('change_reason'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('requirement_versions_version_check', sql`version > 0`),
    check('requirement_versions_snapshot_json_check', sql`json_valid(snapshot_json)`),
    uniqueIndex('uq_requirement_versions_requirement_version').on(t.requirementId, t.version),
  ],
);

// §7.2 baselines
export const baselines = sqliteTable(
  'baselines',
  {
    id: text('id').primaryKey(),
    // NOT NULL filled in per §2 (doc shorthand omitted it).
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    baselineVersion: integer('baseline_version').notNull(),
    status: text('status').notNull(),
    approvedBy: text('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: text('approved_at'),
    dataHash: text('data_hash').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('baselines_baseline_version_check', sql`baseline_version > 0`),
    check('baselines_status_check', sql`status IN ('draft','approved','superseded')`),
    check('baselines_version_check', sql`version > 0`),
    uniqueIndex('uq_baselines_project_version').on(t.projectId, t.baselineVersion),
    index('idx_baselines_project_version').on(t.projectId, t.baselineVersion),
  ],
);

// §7.2 baseline_items
export const baselineItems = sqliteTable(
  'baseline_items',
  {
    // NOT NULL filled in per §2 (doc shorthand omitted it).
    baselineId: text('baseline_id').notNull().references(() => baselines.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    entityVersion: integer('entity_version').notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.baselineId, t.entityType, t.entityId] }),
    check('baseline_items_entity_version_check', sql`entity_version > 0`),
  ],
);

// §7A.1 tasks
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    assigneeId: text('assignee_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    dueAt: text('due_at'),
    status: text('status').notNull(),
    priority: text('priority').notNull().default('normal'),
    createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    check(
      'tasks_status_check',
      sql`status IN ('pending','in_progress','completed','overdue','rejected','reassigned')`,
    ),
    check('tasks_priority_check', sql`priority IN ('low','normal','high','blocking')`),
    check('tasks_version_check', sql`version > 0`),
    index('idx_tasks_project_assignee_status_due').on(t.projectId, t.assigneeId, t.status, t.dueAt),
  ],
);

export type ReviewAction = typeof reviewActions.$inferSelect;
export type NewReviewAction = typeof reviewActions.$inferInsert;
export type RequirementVersion = typeof requirementVersions.$inferSelect;
export type NewRequirementVersion = typeof requirementVersions.$inferInsert;
export type Baseline = typeof baselines.$inferSelect;
export type NewBaseline = typeof baselines.$inferInsert;
export type BaselineItem = typeof baselineItems.$inferSelect;
export type NewBaselineItem = typeof baselineItems.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
