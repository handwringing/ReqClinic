import { sqliteTable, text, integer, primaryKey, check, uniqueIndex, index, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';

/**
 * Formal analysis projects (§3): projects, project_members, project_intakes.
 *
 * `projects` represents only formal analysis. Quick consults live in
 * `quick_sessions` and expression training in `training_attempts`; there is no
 * `projects.mode` (removed in v1.2).
 *
 * Some cross-file foreign keys that would create circular module/type
 * dependencies (projects → domain_profiles, project_intakes →
 * quick_sessions/brief_versions) are declared in a deferred migration SQL file
 * rather than in Drizzle schema, to keep the type graph acyclic. The remaining
 * foreign keys use column-level `.references(() => x.id)` which drizzle-kit
 * resolves lazily.
 */

// §3.2 projects
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    name: text('name'),
    description: text('description'),
    status: text('status').notNull(),
    riskLevel: text('risk_level').notNull().default('unknown'),
    // Deferred FK to domain_profiles — declared in a deferred migration SQL
    // file to avoid circular type inference between project.ts ↔ domain.ts.
    // Application transactions must also verify the profile belongs to the same
    // project and is in `approved` status.
    currentDomainProfileId: text('current_domain_profile_id'),
    language: text('language').notNull().default('zh-CN'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [
    check(
      'projects_status_check',
      sql`status IN ('Draft','Ingesting','Eliciting','Reviewing','Baselined','Reporting','Released','Changing','Archived')`,
    ),
    check('projects_risk_level_check', sql`risk_level IN ('unknown','low','medium','high')`),
    check('projects_version_check', sql`version > 0`),
    index('idx_projects_owner_status_updated').on(t.ownerId, t.status, t.updatedAt),
  ],
);

// §3.3 project_members
export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    capabilitiesJson: text('capabilities_json').notNull(),
    status: text('status').notNull(),
    grantedBy: text('granted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    check('project_members_capabilities_json_check', sql`json_valid(capabilities_json)`),
    check('project_members_status_check', sql`status IN ('active','revoked')`),
    check('project_members_version_check', sql`version > 0`),
    index('idx_project_members_user_status_project').on(t.userId, t.status, t.projectId),
  ],
);

// §3.4 project_intakes
export const projectIntakes = sqliteTable(
  'project_intakes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    intakeVersion: integer('intake_version').notNull(),
    originalText: text('original_text').notNull(),
    decisionIntent: text('decision_intent'),
    selectedWorkType: text('selected_work_type'),
    candidateRolesJson: text('candidate_roles_json').notNull().default('[]'),
    candidateConstraintsJson: text('candidate_constraints_json').notNull().default('[]'),
    sourceChannel: text('source_channel').notNull().default('web'),
    submittedBy: text('submitted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    // Self-reference declared as a table-level FK below (uses `t`, avoids TDZ).
    supersedesIntakeId: text('supersedes_intake_id'),
    // FKs to quick_sessions/brief_versions declared in a deferred migration SQL
    // file to avoid circular type inference project.ts ↔ quick.ts.
    sourceQuickSessionId: text('source_quick_session_id'),
    sourceBriefVersionId: text('source_brief_version_id'),
    sourceQuickSessionHash: text('source_quick_session_hash'),
    sourceBriefSnapshotHash: text('source_brief_snapshot_hash'),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('project_intakes_intake_version_check', sql`intake_version > 0`),
    check('project_intakes_original_text_check', sql`length(trim(original_text)) > 0`),
    check('project_intakes_candidate_roles_json_check', sql`json_valid(candidate_roles_json)`),
    check('project_intakes_candidate_constraints_json_check', sql`json_valid(candidate_constraints_json)`),
    uniqueIndex('uq_project_intakes_project_version').on(t.projectId, t.intakeVersion),
    // (intake_version = 1 AND supersedes_intake_id IS NULL) OR (intake_version > 1 AND supersedes_intake_id IS NOT NULL)
    check(
      'project_intakes_supersede_version_check',
      sql`(intake_version = 1 AND supersedes_intake_id IS NULL)
        OR (intake_version > 1 AND supersedes_intake_id IS NOT NULL)`,
    ),
    // source_quick_session_id and source_brief_version_id both NULL or both NOT NULL
    check(
      'project_intakes_source_ids_xor',
      sql`(source_quick_session_id IS NULL AND source_brief_version_id IS NULL)
        OR (source_quick_session_id IS NOT NULL AND source_brief_version_id IS NOT NULL)`,
    ),
    check(
      'project_intakes_source_hashes_xor',
      sql`(source_quick_session_hash IS NULL AND source_brief_snapshot_hash IS NULL)
        OR (source_quick_session_hash IS NOT NULL AND source_brief_snapshot_hash IS NOT NULL)`,
    ),
    check(
      'project_intakes_source_id_hash_link',
      sql`source_quick_session_id IS NULL OR source_quick_session_hash IS NOT NULL`,
    ),
    // Partial unique indexes (require SQLite >= 3.45).
    uniqueIndex('uq_project_intake_initial').on(t.projectId).where(sql`supersedes_intake_id IS NULL`),
    uniqueIndex('uq_project_intake_successor').on(t.projectId, t.supersedesIntakeId).where(sql`supersedes_intake_id IS NOT NULL`),
    index('idx_project_intakes_project_version').on(t.projectId, t.intakeVersion),
    // Self-reference: supersedes_intake_id -> project_intakes(id) ON DELETE RESTRICT
    foreignKey({
      columns: [t.supersedesIntakeId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;
export type ProjectIntake = typeof projectIntakes.$inferSelect;
export type NewProjectIntake = typeof projectIntakes.$inferInsert;
