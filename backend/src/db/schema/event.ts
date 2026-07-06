import { sqliteTable, text, check, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { projects } from './project';
import { quickSessions } from './quick';

/**
 * Product analytics events (§11A) and entity change audit log (§11B).
 *
 * `product_events` validates product flow hypotheses; it is NOT a source of
 * business facts, requirement evidence, employee performance or training
 * certification. `entity_change_logs` is the field-level business audit trail.
 * The two are stored, authorized and retained separately.
 */

// §11A.1 product_events
export const productEvents = sqliteTable(
  'product_events',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull().unique(),
    eventName: text('event_name').notNull(),
    eventSchemaVersion: text('event_schema_version').notNull(),
    occurredAt: text('occurred_at').notNull(),
    receivedAt: text('received_at'),
    environment: text('environment').notNull(),
    appVersion: text('app_version').notNull(),
    mode: text('mode').notNull(),
    sourceKind: text('source_kind').notNull(),
    analyticsSessionId: text('analytics_session_id').notNull(),
    actorKey: text('actor_key'),
    stage: text('stage'),
    experimentId: text('experiment_id'),
    attributesJson: text('attributes_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [
    check(
      'product_events_environment_check',
      sql`environment IN ('demo','development','test','pilot','production')`,
    ),
    check('product_events_mode_check', sql`mode IN ('quick','formal','training','entry')`),
    check(
      'product_events_source_kind_check',
      sql`source_kind IN ('custom','sample','training_fixture','internal_test')`,
    ),
    check('product_events_attributes_json_check', sql`json_valid(attributes_json)`),
    index('idx_product_events_session_occurred').on(t.analyticsSessionId, t.occurredAt),
    index('idx_product_events_occurred_at').on(t.occurredAt),
    index('idx_product_events_mode').on(t.mode),
    index('idx_product_events_source_kind').on(t.sourceKind),
    index('idx_product_events_expires_at').on(t.expiresAt),
  ],
);

// §11B.1 entity_change_logs
export const entityChangeLogs = sqliteTable(
  'entity_change_logs',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    quickSessionId: text('quick_session_id').references(() => quickSessions.id, { onDelete: 'set null' }),
    changeKind: text('change_kind').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    fieldChangesJson: text('field_changes_json'),
    beforeStateHash: text('before_state_hash'),
    afterStateHash: text('after_state_hash'),
    idempotencyKey: text('idempotency_key'),
    occurredAt: text('occurred_at').notNull(),
    receivedAt: text('received_at'),
  },
  (t) => [
    check(
      'entity_change_logs_entity_type_check',
      sql`entity_type IN (
        'project','project_member','project_intake','baseline','requirement',
        'driver','review_action','report_snapshot','change',
        'quick_session','brief_version','brief_export','option_preference',
        'upgrade_record','training_attempt','training_feedback',
        'agreement_version','agreement_consent','guest_session','task'
      )`,
    ),
    check(
      'entity_change_logs_change_kind_check',
      sql`change_kind IN ('created','updated','state_changed','deleted','archived','restored')`,
    ),
    check('entity_change_logs_actor_kind_check', sql`actor_kind IN ('user','guest','system')`),
    check('entity_change_logs_field_changes_json_check', sql`field_changes_json IS NULL OR json_valid(field_changes_json)`),
    index('idx_entity_change_logs_entity_occurred').on(t.entityType, t.entityId, sql`occurred_at DESC`),
    index('idx_entity_change_logs_project_occurred').on(t.projectId, sql`occurred_at DESC`).where(sql`project_id IS NOT NULL`),
    index('idx_entity_change_logs_quick_session_occurred').on(t.quickSessionId, sql`occurred_at DESC`).where(sql`quick_session_id IS NOT NULL`),
    index('idx_entity_change_logs_actor_occurred').on(t.actorKind, t.actorId, sql`occurred_at DESC`),
    index('idx_entity_change_logs_idempotency_key').on(t.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
  ],
);

export type ProductEvent = typeof productEvents.$inferSelect;
export type NewProductEvent = typeof productEvents.$inferInsert;
export type EntityChangeLog = typeof entityChangeLogs.$inferSelect;
export type NewEntityChangeLog = typeof entityChangeLogs.$inferInsert;
