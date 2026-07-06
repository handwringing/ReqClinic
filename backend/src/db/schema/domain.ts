import { sqliteTable, text, integer, primaryKey, check, uniqueIndex, index, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projects } from './project';

/**
 * Domain profile & static domain packs (§4).
 *
 * `domain_profiles` is the AI-generated, human-approved project profile. The
 * static `domain_packs`/`project_domain_packs` tables hold v1's two preset
 * packs (`general`, `software-delivery`); creation/composition/runtime schema
 * extension is out of scope for v1.
 */

// §4.1 domain_profiles
export const domainProfiles = sqliteTable(
  'domain_profiles',
  {
    id: text('id').primaryKey(),
    // FK to projects declared as a table-level FK below (avoids circular type
    // inference between domain.ts ↔ project.ts).
    projectId: text('project_id').notNull(),
    profileVersion: integer('profile_version').notNull(),
    workType: text('work_type').notNull(),
    domainLabelsJson: text('domain_labels_json').notNull(),
    riskFlagsJson: text('risk_flags_json').notNull(),
    terminologyMapJson: text('terminology_map_json').notNull(),
    suggestedPackIdsJson: text('suggested_pack_ids_json').notNull(),
    requiredHumanRolesJson: text('required_human_roles_json').notNull(),
    routingRisk: text('routing_risk').notNull(),
    routingBasisJson: text('routing_basis_json').notNull(),
    rationaleEvidenceLinksJson: text('rationale_evidence_links_json').notNull(),
    unknownsJson: text('unknowns_json').notNull(),
    status: text('status').notNull(),
    classifierModel: text('classifier_model'),
    promptVersion: text('prompt_version'),
    approvedBy: text('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: text('approved_at'),
    // Self-reference declared as a table-level FK below.
    supersedesProfileId: text('supersedes_profile_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('domain_profiles_profile_version_check', sql`profile_version > 0`),
    check('domain_profiles_domain_labels_json_check', sql`json_valid(domain_labels_json)`),
    check('domain_profiles_risk_flags_json_check', sql`json_valid(risk_flags_json)`),
    check('domain_profiles_terminology_map_json_check', sql`json_valid(terminology_map_json)`),
    check('domain_profiles_suggested_pack_ids_json_check', sql`json_valid(suggested_pack_ids_json)`),
    check('domain_profiles_required_human_roles_json_check', sql`json_valid(required_human_roles_json)`),
    check('domain_profiles_routing_risk_check', sql`routing_risk IN ('low','medium','high','unknown')`),
    check('domain_profiles_routing_basis_json_check', sql`json_valid(routing_basis_json)`),
    check('domain_profiles_rationale_evidence_links_json_check', sql`json_valid(rationale_evidence_links_json)`),
    check('domain_profiles_unknowns_json_check', sql`json_valid(unknowns_json)`),
    check(
      'domain_profiles_status_check',
      sql`status IN ('candidate','under_review','approved','rejected','superseded')`,
    ),
    uniqueIndex('uq_domain_profiles_project_version').on(t.projectId, t.profileVersion),
    index('idx_domain_profiles_project_status_version').on(t.projectId, t.status, t.profileVersion),
    // Self-reference: supersedes_profile_id -> domain_profiles(id) ON DELETE RESTRICT
    foreignKey({
      columns: [t.supersedesProfileId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
    // NOTE: FK domain_profiles.project_id -> projects(id) ON DELETE RESTRICT is
    // declared in a deferred migration SQL file to break the circular type
    // inference between domain.ts ↔ project.ts (projects.current_domain_profile_id
    // -> domain_profiles.id is the back-reference that creates the cycle).
  ],
);

// §4.2 domain_packs (static config; composite PK id+version)
export const domainPacks = sqliteTable(
  'domain_packs',
  {
    id: text('id').notNull(),
    version: text('version').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    compatibleCoreSchema: text('compatible_core_schema').notNull(),
    manifestJson: text('manifest_json').notNull(),
    manifestHash: text('manifest_hash').notNull(),
    releasedAt: text('released_at').notNull(),
    deprecatedAt: text('deprecated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version] }),
    check('domain_packs_status_check', sql`status IN ('released','deprecated')`),
    check('domain_packs_manifest_json_check', sql`json_valid(manifest_json)`),
  ],
);

// §4.2 project_domain_packs
export const projectDomainPacks = sqliteTable(
  'project_domain_packs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    domainPackId: text('domain_pack_id').notNull(),
    domainPackVersion: text('domain_pack_version').notNull(),
    domainProfileId: text('domain_profile_id').notNull().references(() => domainProfiles.id, { onDelete: 'restrict' }),
    activationReason: text('activation_reason').notNull(),
    status: text('status').notNull(),
    activatedBy: text('activated_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    activatedAt: text('activated_at').notNull(),
    deactivatedAt: text('deactivated_at'),
  },
  (t) => [
    check('project_domain_packs_status_check', sql`status IN ('active','inactive')`),
    index('idx_project_domain_packs_project_status').on(t.projectId, t.status),
    // Composite FK: (domain_pack_id, domain_pack_version) -> domain_packs(id, version)
    foreignKey({
      columns: [t.domainPackId, t.domainPackVersion],
      foreignColumns: [domainPacks.id, domainPacks.version],
    }).onDelete('restrict'),
  ],
);

export type DomainProfile = typeof domainProfiles.$inferSelect;
export type NewDomainProfile = typeof domainProfiles.$inferInsert;
export type DomainPack = typeof domainPacks.$inferSelect;
export type NewDomainPack = typeof domainPacks.$inferInsert;
export type ProjectDomainPack = typeof projectDomainPacks.$inferSelect;
export type NewProjectDomainPack = typeof projectDomainPacks.$inferInsert;
