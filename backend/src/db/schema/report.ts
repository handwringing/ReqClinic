import { sqliteTable, text, integer, primaryKey, check, uniqueIndex, index, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projects } from './project';
import { baselines } from './review';
import { domainProfiles } from './domain';
import { blobs } from './source';

/**
 * Reports, templates & publish snapshots (§10).
 *
 * The file system cannot participate in a SQLite transaction: render a temp
 * file with fsync/hash, register the `staged` blob, atomically rename, then
 * flip to `released` in a short transaction. A `released` snapshot requires the
 * file blob/hash, all gates, confirmer identity and time. Published snapshots
 * are immutable.
 */

// §10 report_templates (composite PK id+version)
export const reportTemplates = sqliteTable(
  'report_templates',
  {
    id: text('id').notNull(),
    audience: text('audience').notNull(),
    version: text('version').notNull(),
    contentHash: text('content_hash').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version] }),
    check('report_templates_status_check', sql`status IN ('draft','active','deprecated')`),
  ],
);

// §10 report_snapshots
export const reportSnapshots = sqliteTable(
  'report_snapshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    reportVersion: integer('report_version').notNull(),
    baselineId: text('baseline_id').notNull().references(() => baselines.id, { onDelete: 'restrict' }),
    dataHash: text('data_hash').notNull(),
    templateId: text('template_id').notNull(),
    templateVersion: text('template_version').notNull(),
    coreSchemaVersion: text('core_schema_version').notNull(),
    reportInputSchemaHash: text('report_input_schema_hash').notNull(),
    compilerVersion: text('compiler_version').notNull(),
    domainProfileId: text('domain_profile_id').notNull().references(() => domainProfiles.id, { onDelete: 'restrict' }),
    domainProfileVersion: integer('domain_profile_version').notNull(),
    domainPackVersionsJson: text('domain_pack_versions_json').notNull(),
    promptVersionsJson: text('prompt_versions_json').notNull().default('[]'),
    modelVersionsJson: text('model_versions_json').notNull().default('[]'),
    audience: text('audience').notNull(),
    language: text('language').notNull(),
    fileBlobId: text('file_blob_id').references(() => blobs.id, { onDelete: 'restrict' }),
    fileSha256: text('file_sha256'),
    status: text('status').notNull(),
    generatedAt: text('generated_at').notNull(),
    releasedBy: text('released_by').references(() => users.id, { onDelete: 'restrict' }),
    releasedAt: text('released_at'),
    // Self-reference declared as a table-level FK below.
    supersedesReportId: text('supersedes_report_id'),
  },
  (t) => [
    check('report_snapshots_report_version_check', sql`report_version > 0`),
    check('report_snapshots_domain_pack_versions_json_check', sql`json_valid(domain_pack_versions_json)`),
    check('report_snapshots_prompt_versions_json_check', sql`json_valid(prompt_versions_json)`),
    check('report_snapshots_model_versions_json_check', sql`json_valid(model_versions_json)`),
    check(
      'report_snapshots_status_check',
      sql`status IN ('draft','gate_failed','rendering','staged','ready','released','publish_failed','superseded')`,
    ),
    uniqueIndex('uq_report_snapshots_project_version').on(t.projectId, t.reportVersion),
    index('idx_report_snapshots_project_version').on(t.projectId, t.reportVersion),
    // Composite FK: (template_id, template_version) -> report_templates(id, version)
    foreignKey({
      columns: [t.templateId, t.templateVersion],
      foreignColumns: [reportTemplates.id, reportTemplates.version],
    }).onDelete('restrict'),
    // Self-reference: supersedes_report_id -> report_snapshots(id)
    foreignKey({
      columns: [t.supersedesReportId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
  ],
);

// §10 report_gate_results
export const reportGateResults = sqliteTable(
  'report_gate_results',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id').notNull().references(() => reportSnapshots.id, { onDelete: 'restrict' }),
    gateCode: text('gate_code').notNull(),
    status: text('status').notNull(),
    defectsJson: text('defects_json').notNull().default('[]'),
    checkedAt: text('checked_at').notNull(),
  },
  (t) => [
    check('report_gate_results_status_check', sql`status IN ('passed','failed','warning')`),
    check('report_gate_results_defects_json_check', sql`json_valid(defects_json)`),
    uniqueIndex('uq_report_gate_results_report_gate').on(t.reportId, t.gateCode),
  ],
);

export type ReportTemplate = typeof reportTemplates.$inferSelect;
export type NewReportTemplate = typeof reportTemplates.$inferInsert;
export type ReportSnapshot = typeof reportSnapshots.$inferSelect;
export type NewReportSnapshot = typeof reportSnapshots.$inferInsert;
export type ReportGateResult = typeof reportGateResults.$inferSelect;
export type NewReportGateResult = typeof reportGateResults.$inferInsert;
