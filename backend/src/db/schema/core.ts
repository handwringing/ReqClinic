import { sqliteTable, text, integer, primaryKey, check, uniqueIndex, index, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projects } from './project';
import { sources, evidenceSpans } from './source';

/**
 * Unified requirements-engineering core (§6).
 *
 * Descriptive entities carry an explicit `epistemic_type`. Formal facts cannot
 * rely on free text alone — they must relate to evidence via `evidence_links`.
 * Polymorphic relations (`entity_type`/`entity_id`) are validated in-transaction
 * by the Repository and by the pre-release integrity check (§6.4); SQLite cannot
 * express those as ordinary FKs.
 */

const EPISTEMIC_TYPES = `'Fact','Inference','Assumption','Proposal'`;
const CORE_STATUS = `'candidate','supported','reviewed','accepted','superseded','retired'`;

// §6.1 stakeholders
export const stakeholders = sqliteTable(
  'stakeholders',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    role: text('role').notNull(),
    influence: text('influence'),
    interest: text('interest'),
    authority: text('authority'),
    contactScope: text('contact_scope'),
    notes: text('notes'),
    epistemicType: text('epistemic_type').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('stakeholders_epistemic_type_check', sql`epistemic_type IN (${sql.raw(EPISTEMIC_TYPES)})`),
    check('stakeholders_status_check', sql`status IN (${sql.raw(CORE_STATUS)})`),
    check('stakeholders_version_check', sql`version > 0`),
  ],
);

// §6.1 jobs
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    stakeholderId: text('stakeholder_id').references(() => stakeholders.id, { onDelete: 'restrict' }),
    context: text('context').notNull(),
    jobStatement: text('job_statement').notNull(),
    pain: text('pain'),
    currentWorkaround: text('current_workaround'),
    expectedProgress: text('expected_progress'),
    epistemicType: text('epistemic_type').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('jobs_epistemic_type_check', sql`epistemic_type IN (${sql.raw(EPISTEMIC_TYPES)})`),
    check('jobs_status_check', sql`status IN (${sql.raw(CORE_STATUS)})`),
    check('jobs_version_check', sql`version > 0`),
  ],
);

// §6.1 drivers
export const drivers = sqliteTable(
  'drivers',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    driverType: text('driver_type').notNull(),
    statement: text('statement').notNull(),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('drivers_driver_type_check', sql`driver_type IN ('goal','outcome','obligation','risk','problem','opportunity')`),
    check('drivers_status_check', sql`status IN (${sql.raw(CORE_STATUS)})`),
    check('drivers_version_check', sql`version > 0`),
    index('idx_drivers_project_type_status').on(t.projectId, t.driverType, t.status),
  ],
);

// §6.1 outcomes (extends drivers where driver_type='outcome')
export const outcomes = sqliteTable(
  'outcomes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    driverId: text('driver_id').notNull().unique().references(() => drivers.id, { onDelete: 'restrict' }),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    successMetric: text('success_metric'),
    baselineValue: text('baseline_value'),
    targetValue: text('target_value'),
    unit: text('unit'),
    failureCondition: text('failure_condition'),
    horizon: text('horizon'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    epistemicType: text('epistemic_type').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('outcomes_horizon_check', sql`horizon IS NULL OR horizon IN ('now','next','later','watch')`),
    check('outcomes_epistemic_type_check', sql`epistemic_type IN (${sql.raw(EPISTEMIC_TYPES)})`),
    check('outcomes_status_check', sql`status IN (${sql.raw(CORE_STATUS)})`),
    check('outcomes_version_check', sql`version > 0`),
    index('idx_outcomes_project_job_status').on(t.projectId, t.jobId, t.status),
  ],
);

// §6.1 capabilities
export const capabilities = sqliteTable(
  'capabilities',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    // Self-reference declared as a table-level FK below (avoids circular type inference).
    parentCapabilityId: text('parent_capability_id'),
    epistemicType: text('epistemic_type').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('capabilities_epistemic_type_check', sql`epistemic_type IN (${sql.raw(EPISTEMIC_TYPES)})`),
    check('capabilities_status_check', sql`status IN (${sql.raw(CORE_STATUS)})`),
    check('capabilities_version_check', sql`version > 0`),
    // Self-reference: parent_capability_id -> capabilities(id) ON DELETE RESTRICT
    foreignKey({
      columns: [t.parentCapabilityId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
  ],
);

// §6.1 interview_turns
export const interviewTurns = sqliteTable(
  'interview_turns',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    turnIndex: integer('turn_index').notNull(),
    role: text('role').notNull(),
    stakeholderId: text('stakeholder_id').references(() => stakeholders.id, { onDelete: 'restrict' }),
    speakerLabel: text('speaker_label').notNull(),
    content: text('content').notNull(),
    evidenceSpanId: text('evidence_span_id').references(() => evidenceSpans.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('interview_turns_turn_index_check', sql`turn_index >= 0`),
    check('interview_turns_role_check', sql`role IN ('interviewer','stakeholder','system')`),
    uniqueIndex('uq_interview_turns_project_index').on(t.projectId, t.turnIndex),
    index('idx_interview_turns_project_index').on(t.projectId, t.turnIndex),
    index('idx_interview_turns_project_role_created').on(t.projectId, t.role, t.createdAt),
  ],
);

// §6.2 requirements
export const requirements = sqliteTable(
  'requirements',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    requirementKey: text('requirement_key').notNull(),
    title: text('title'),
    statement: text('statement').notNull(),
    requirementType: text('requirement_type').notNull(),
    provenance: text('provenance').notNull(),
    horizon: text('horizon'),
    scopeDisposition: text('scope_disposition').notNull().default('included'),
    commitment: text('commitment').notNull(),
    stability: text('stability').notNull(),
    priority: text('priority'),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    activationTrigger: text('activation_trigger'),
    deactivationTrigger: text('deactivation_trigger'),
    volatilityDriversJson: text('volatility_drivers_json').notNull().default('[]'),
    migrationStrategy: text('migration_strategy'),
    reversibility: text('reversibility'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    // Self-reference declared as a table-level FK below.
    supersedesRequirementId: text('supersedes_requirement_id'),
    lifecycleStatus: text('lifecycle_status').notNull(),
    rationale: text('rationale'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'requirements_provenance_check',
      sql`provenance IN ('explicitly_stated','derived','assumed','proposed')`,
    ),
    check('requirements_horizon_check', sql`horizon IS NULL OR horizon IN ('now','next','later','watch')`),
    check('requirements_scope_disposition_check', sql`scope_disposition IN ('included','excluded')`),
    check(
      'requirements_commitment_check',
      sql`commitment IN ('committed','conditional','scenario','speculation')`,
    ),
    check('requirements_stability_check', sql`stability IN ('stable','policy-variable','experimental')`),
    check('requirements_volatility_drivers_json_check', sql`json_valid(volatility_drivers_json)`),
    check(
      'requirements_migration_strategy_check',
      sql`migration_strategy IS NULL OR migration_strategy IN ('coexist','transform','replace','retire')`,
    ),
    check(
      'requirements_reversibility_check',
      sql`reversibility IS NULL OR reversibility IN ('high','medium','low')`,
    ),
    check(
      'requirements_lifecycle_status_check',
      sql`lifecycle_status IN ('candidate','supported','reviewed','accepted','implemented','verified','superseded','retired')`,
    ),
    check('requirements_version_check', sql`version > 0`),
    check('requirements_valid_until_check', sql`valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from`),
    uniqueIndex('uq_requirements_project_key').on(t.projectId, t.requirementKey),
    index('idx_requirements_project_horizon_scope_lifecycle').on(
      t.projectId,
      t.horizon,
      t.scopeDisposition,
      t.lifecycleStatus,
    ),
    // Self-reference: supersedes_requirement_id -> requirements(id) ON DELETE RESTRICT
    foreignKey({
      columns: [t.supersedesRequirementId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
  ],
);

// §6.2 requirement_driver_links
export const requirementDriverLinks = sqliteTable(
  'requirement_driver_links',
  {
    requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'restrict' }),
    driverId: text('driver_id').notNull().references(() => drivers.id, { onDelete: 'restrict' }),
    relation: text('relation').notNull(),
    rationale: text('rationale'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.requirementId, t.driverId, t.relation] }),
    check(
      'requirement_driver_links_relation_check',
      sql`relation IN ('motivated_by','constrains','mitigates','realizes')`,
    ),
    index('idx_requirement_driver_links_driver_requirement').on(t.driverId, t.requirementId),
  ],
);

// §6.2 acceptance_criteria
export const acceptanceCriteria = sqliteTable(
  'acceptance_criteria',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'restrict' }),
    context: text('context'),
    actionOrCondition: text('action_or_condition').notNull(),
    expectedResult: text('expected_result').notNull(),
    measurementMethod: text('measurement_method'),
    evidenceType: text('evidence_type'),
    thresholdValue: text('threshold_value'),
    unit: text('unit'),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('acceptance_criteria_status_check', sql`status IN ('draft','reviewed','accepted','verified','superseded')`),
    check('acceptance_criteria_version_check', sql`version > 0`),
    index('idx_acceptance_criteria_requirement_status').on(t.requirementId, t.status),
  ],
);

// §6.2 verification_artifacts
export const verificationArtifacts = sqliteTable(
  'verification_artifacts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'restrict' }),
    acceptanceCriterionId: text('acceptance_criterion_id').references(() => acceptanceCriteria.id, { onDelete: 'restrict' }),
    artifactType: text('artifact_type').notNull(),
    description: text('description'),
    sourceId: text('source_id').references(() => sources.id, { onDelete: 'restrict' }),
    artifactPath: text('artifact_path'),
    result: text('result'),
    executedAt: text('executed_at'),
    verifiedBy: text('verified_by').references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('verification_artifacts_status_check', sql`status IN ('planned','available','passed','failed','invalidated')`),
    check(
      'verification_artifacts_evidence_xor',
      sql`source_id IS NOT NULL OR artifact_path IS NOT NULL OR result IS NOT NULL`,
    ),
    index('idx_verification_artifacts_requirement_acceptance_status').on(
      t.requirementId,
      t.acceptanceCriterionId,
      t.status,
    ),
  ],
);

// §6.2 operational_signals
export const operationalSignals = sqliteTable(
  'operational_signals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    measurement: text('measurement').notNull(),
    thresholdValue: text('threshold_value'),
    unit: text('unit'),
    observationWindow: text('observation_window'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    reviewCadence: text('review_cadence'),
    triggerCondition: text('trigger_condition'),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('operational_signals_status_check', sql`status IN ('draft','active','paused','retired')`),
    check('operational_signals_version_check', sql`version > 0`),
  ],
);

// §6.3 unknowns
export const unknowns = sqliteTable(
  'unknowns',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    question: text('question').notNull(),
    informationValue: text('information_value'),
    impact: text('impact'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    dueAt: text('due_at'),
    resolutionCondition: text('resolution_condition'),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('unknowns_status_check', sql`status IN ('open','investigating','resolved','closed')`),
    check('unknowns_version_check', sql`version > 0`),
  ],
);

// §6.3 assumptions
export const assumptions = sqliteTable(
  'assumptions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    statement: text('statement').notNull(),
    validationPlan: text('validation_plan'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    dueAt: text('due_at'),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('assumptions_status_check', sql`status IN ('open','testing','validated','invalidated','retired')`),
    check('assumptions_version_check', sql`version > 0`),
  ],
);

// §6.3 conflicts
export const conflicts = sqliteTable(
  'conflicts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    statement: text('statement').notNull(),
    severity: text('severity').notNull(),
    blocking: integer('blocking').notNull().default(0),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('conflicts_severity_check', sql`severity IN ('low','medium','high','critical')`),
    check('conflicts_blocking_check', sql`blocking IN (0,1)`),
    check('conflicts_status_check', sql`status IN ('open','deciding','resolved','accepted_risk')`),
    check('conflicts_version_check', sql`version > 0`),
    index('idx_conflicts_project_blocking_status').on(t.projectId, t.blocking, t.status),
  ],
);

// §6.3 conflict_sides
export const conflictSides = sqliteTable(
  'conflict_sides',
  {
    id: text('id').primaryKey(),
    conflictId: text('conflict_id').notNull().references(() => conflicts.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    statement: text('statement').notNull(),
    stance: text('stance').notNull(),
    evidenceLinkIdsJson: text('evidence_link_ids_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('conflict_sides_evidence_link_ids_json_check', sql`json_valid(evidence_link_ids_json)`),
    index('idx_conflict_sides_conflict').on(t.conflictId),
  ],
);

// §6.3 conflict_options
export const conflictOptions = sqliteTable(
  'conflict_options',
  {
    id: text('id').primaryKey(),
    conflictId: text('conflict_id').notNull().references(() => conflicts.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    benefits: text('benefits'),
    costs: text('costs'),
    risks: text('risks'),
    reversibility: text('reversibility'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('conflict_options_reversibility_check', sql`reversibility IS NULL OR reversibility IN ('high','medium','low')`),
    check('conflict_options_status_check', sql`status IN ('candidate','selected','rejected','withdrawn')`),
    index('idx_conflict_options_conflict_status').on(t.conflictId, t.status),
  ],
);

// §6.3 decisions
export const decisions = sqliteTable(
  'decisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    conflictId: text('conflict_id').references(() => conflicts.id, { onDelete: 'restrict' }),
    question: text('question').notNull(),
    // Deferred FK to conflict_options; app validates option belongs to same conflict.
    selectedOptionId: text('selected_option_id').references(() => conflictOptions.id, { onDelete: 'restrict' }),
    rationale: text('rationale'),
    decidedBy: text('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: text('decided_at'),
    reviewTrigger: text('review_trigger'),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('decisions_status_check', sql`status IN ('draft','decided','superseded','revoked')`),
    check('decisions_version_check', sql`version > 0`),
  ],
);

// §6.3 future_scenarios
export const futureScenarios = sqliteTable(
  'future_scenarios',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    probabilityClass: text('probability_class'),
    activationTrigger: text('activation_trigger').notNull(),
    leadingIndicatorsJson: text('leading_indicators_json').notNull().default('[]'),
    horizon: text('horizon').notNull(),
    architectureResponse: text('architecture_response'),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'future_scenarios_probability_class_check',
      sql`probability_class IS NULL OR probability_class IN ('low','medium','high','unknown')`,
    ),
    check('future_scenarios_leading_indicators_json_check', sql`json_valid(leading_indicators_json)`),
    check('future_scenarios_horizon_check', sql`horizon IN ('next','later','watch')`),
    check('future_scenarios_status_check', sql`status IN ('draft','active','triggered','retired')`),
    check('future_scenarios_version_check', sql`version > 0`),
    index('idx_future_scenarios_project_horizon_status').on(t.projectId, t.horizon, t.status),
  ],
);

// §6.4 evidence_links
export const evidenceLinks = sqliteTable(
  'evidence_links',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    evidenceSpanId: text('evidence_span_id').notNull().references(() => evidenceSpans.id, { onDelete: 'restrict' }),
    relation: text('relation').notNull(),
    createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('evidence_links_relation_check', sql`relation IN ('supports','contradicts','qualifies','originates')`),
    uniqueIndex('uq_evidence_links_entity_span_relation').on(
      t.entityType,
      t.entityId,
      t.evidenceSpanId,
      t.relation,
    ),
    index('idx_evidence_links_project_entity').on(t.projectId, t.entityType, t.entityId),
  ],
);

// §6.4 trace_links
export const traceLinks = sqliteTable(
  'trace_links',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    fromType: text('from_type').notNull(),
    fromId: text('from_id').notNull(),
    relation: text('relation').notNull(),
    toType: text('to_type').notNull(),
    toId: text('to_id').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('trace_links_status_check', sql`status IN ('active','superseded','invalidated')`),
    uniqueIndex('uq_trace_links_project_relation').on(
      t.projectId,
      t.fromType,
      t.fromId,
      t.relation,
      t.toType,
      t.toId,
    ),
    index('idx_trace_links_project_from').on(t.projectId, t.fromType, t.fromId),
    index('idx_trace_links_project_to').on(t.projectId, t.toType, t.toId),
  ],
);

export type Stakeholder = typeof stakeholders.$inferSelect;
export type NewStakeholder = typeof stakeholders.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
export type Outcome = typeof outcomes.$inferSelect;
export type NewOutcome = typeof outcomes.$inferInsert;
export type Capability = typeof capabilities.$inferSelect;
export type NewCapability = typeof capabilities.$inferInsert;
export type InterviewTurn = typeof interviewTurns.$inferSelect;
export type NewInterviewTurn = typeof interviewTurns.$inferInsert;
export type Requirement = typeof requirements.$inferSelect;
export type NewRequirement = typeof requirements.$inferInsert;
export type RequirementDriverLink = typeof requirementDriverLinks.$inferSelect;
export type NewRequirementDriverLink = typeof requirementDriverLinks.$inferInsert;
export type AcceptanceCriterion = typeof acceptanceCriteria.$inferSelect;
export type NewAcceptanceCriterion = typeof acceptanceCriteria.$inferInsert;
export type VerificationArtifact = typeof verificationArtifacts.$inferSelect;
export type NewVerificationArtifact = typeof verificationArtifacts.$inferInsert;
export type OperationalSignal = typeof operationalSignals.$inferSelect;
export type NewOperationalSignal = typeof operationalSignals.$inferInsert;
export type Unknown = typeof unknowns.$inferSelect;
export type NewUnknown = typeof unknowns.$inferInsert;
export type Assumption = typeof assumptions.$inferSelect;
export type NewAssumption = typeof assumptions.$inferInsert;
export type Conflict = typeof conflicts.$inferSelect;
export type NewConflict = typeof conflicts.$inferInsert;
export type ConflictSide = typeof conflictSides.$inferSelect;
export type NewConflictSide = typeof conflictSides.$inferInsert;
export type ConflictOption = typeof conflictOptions.$inferSelect;
export type NewConflictOption = typeof conflictOptions.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type FutureScenario = typeof futureScenarios.$inferSelect;
export type NewFutureScenario = typeof futureScenarios.$inferInsert;
export type EvidenceLink = typeof evidenceLinks.$inferSelect;
export type NewEvidenceLink = typeof evidenceLinks.$inferInsert;
export type TraceLink = typeof traceLinks.$inferSelect;
export type NewTraceLink = typeof traceLinks.$inferInsert;
