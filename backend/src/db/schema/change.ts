import { sqliteTable, text, integer, check, index, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projects } from './project';
import { sources } from './source';
import { baselines } from './review';

/**
 * Change & impact (§8). Preview data must never feed formal entities, baselines
 * or released reports. Confirming a real change, transitioning the project to
 * `Changing`, creating impact items and reopening the necessary stages happen
 * in one transaction.
 */

// §8 change_previews
export const changePreviews = sqliteTable(
  'change_previews',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    baselineId: text('baseline_id').notNull().references(() => baselines.id, { onDelete: 'restrict' }),
    scenarioJson: text('scenario_json').notNull(),
    status: text('status').notNull(),
    createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at'),
  },
  (t) => [
    check('change_previews_scenario_json_check', sql`json_valid(scenario_json)`),
    check('change_previews_status_check', sql`status IN ('draft','analyzing','ready','failed','expired')`),
  ],
);

// §8 changes
export const changes = sqliteTable(
  'changes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    sourceId: text('source_id').references(() => sources.id, { onDelete: 'restrict' }),
    sourceType: text('source_type').notNull(),
    description: text('description').notNull(),
    triggerType: text('trigger_type'),
    occurredAt: text('occurred_at'),
    severity: text('severity').notNull(),
    status: text('status').notNull(),
    confirmedBy: text('confirmed_by').references(() => users.id, { onDelete: 'restrict' }),
    confirmedAt: text('confirmed_at'),
    withdrawnBy: text('withdrawn_by').references(() => users.id, { onDelete: 'restrict' }),
    withdrawnAt: text('withdrawn_at'),
    withdrawalReason: text('withdrawal_reason'),
    // Self-reference declared as a table-level FK below.
    supersedesChangeId: text('supersedes_change_id'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('changes_severity_check', sql`severity IN ('low','medium','high','critical')`),
    check(
      'changes_status_check',
      sql`status IN ('draft','confirmed','analyzing','reviewing','baselined','withdrawn','superseded')`,
    ),
    check('changes_version_check', sql`version > 0`),
    // confirmed ⇒ confirmed_by/confirmed_at present
    check(
      'changes_confirmed_check',
      sql`status <> 'confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)`,
    ),
    // withdrawn ⇒ withdrawn_by/withdrawn_at/withdrawal_reason present
    check(
      'changes_withdrawn_check',
      sql`status <> 'withdrawn' OR (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL)`,
    ),
    index('idx_changes_project_status_created').on(t.projectId, t.status, t.createdAt),
    index('idx_changes_project_source_occurred').on(t.projectId, t.sourceId, t.occurredAt),
    // Self-reference: supersedes_change_id -> changes(id) ON DELETE RESTRICT
    foreignKey({
      columns: [t.supersedesChangeId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
  ],
);

// §8 change_impacts
export const changeImpacts = sqliteTable(
  'change_impacts',
  {
    id: text('id').primaryKey(),
    changeId: text('change_id').references(() => changes.id, { onDelete: 'restrict' }),
    previewId: text('preview_id').references(() => changePreviews.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    impactType: text('impact_type').notNull(),
    severity: text('severity').notNull(),
    recommendedAction: text('recommended_action'),
    requiredStage: text('required_stage'),
    rationale: text('rationale').notNull(),
    status: text('status').notNull(),
  },
  (t) => [
    check('change_impacts_severity_check', sql`severity IN ('low','medium','high','critical')`),
    check(
      'change_impacts_required_stage_check',
      sql`required_stage IS NULL OR required_stage IN ('interview','outcome','decision','scope','report')`,
    ),
    check(
      'change_impacts_status_check',
      sql`status IN ('candidate','reviewed','accepted','dismissed')`,
    ),
    // Exactly one of change_id / preview_id (XOR).
    check('change_impacts_source_xor', sql`(change_id IS NULL) <> (preview_id IS NULL)`),
  ],
);

export type ChangePreview = typeof changePreviews.$inferSelect;
export type NewChangePreview = typeof changePreviews.$inferInsert;
export type Change = typeof changes.$inferSelect;
export type NewChange = typeof changes.$inferInsert;
export type ChangeImpact = typeof changeImpacts.$inferSelect;
export type NewChangeImpact = typeof changeImpacts.$inferInsert;
