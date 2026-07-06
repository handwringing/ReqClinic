import { sqliteTable, text, integer, check, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users, guestSessions } from './identity';
import { projects } from './project';
import { quickSessions } from './quick';
import { trainingAttempts } from './training';
import { domainProfiles } from './domain';
import { blobs } from './source';

/**
 * AI jobs & invocations (§9) plus HTTP idempotency records (§11).
 *
 * AI jobs have three mutually exclusive scopes (formal_project / quick_session
 * / training_attempt) and may be created or cancelled by either a user or a
 * guest (formal-project jobs can only be created by a user). Job dedupe uses
 * three partial unique indexes so SQLite NULL semantics cannot bypass it.
 *
 * HTTP idempotency is managed solely by `idempotency_records`; a job's
 * `dedupe_key` only prevents duplicate payment for the same fixed task.
 */

// §9 ai_jobs
export const aiJobs = sqliteTable(
  'ai_jobs',
  {
    id: text('id').primaryKey(),
    scopeKind: text('scope_kind').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    quickSessionId: text('quick_session_id').references(() => quickSessions.id, { onDelete: 'cascade' }),
    trainingAttemptId: text('training_attempt_id').references(() => trainingAttempts.id, { onDelete: 'cascade' }),
    taskType: text('task_type').notNull(),
    payloadJson: text('payload_json').notNull(),
    inputHash: text('input_hash').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    nextRunAt: text('next_run_at'),
    lockedBy: text('locked_by'),
    lockedAt: text('locked_at'),
    lastErrorCode: text('last_error_code'),
    cancellationReason: text('cancellation_reason'),
    cancelledByKind: text('cancelled_by_kind'),
    cancelledByUserId: text('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    cancelledByGuestSessionId: text('cancelled_by_guest_session_id').references(() => guestSessions.id, { onDelete: 'restrict' }),
    cancelledAt: text('cancelled_at'),
    idempotencyRecordId: text('idempotency_record_id').references(() => idempotencyRecords.id, { onDelete: 'restrict' }),
    dedupeKey: text('dedupe_key').notNull(),
    createdByKind: text('created_by_kind').notNull(),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    createdByGuestSessionId: text('created_by_guest_session_id').references(() => guestSessions.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('ai_jobs_scope_kind_check', sql`scope_kind IN ('formal_project','quick_session','training_attempt')`),
    check('ai_jobs_payload_json_check', sql`json_valid(payload_json)`),
    check(
      'ai_jobs_status_check',
      sql`status IN ('queued','running','validating','retry_wait','succeeded','failed','manual_review','cancelled')`,
    ),
    check('ai_jobs_attempts_check', sql`attempts >= 0`),
    check('ai_jobs_max_attempts_check', sql`max_attempts > 0`),
    check(
      'ai_jobs_cancelled_by_kind_check',
      sql`cancelled_by_kind IS NULL OR cancelled_by_kind IN ('user','guest','system')`,
    ),
    check('ai_jobs_created_by_kind_check', sql`created_by_kind IN ('user','guest')`),
    // Scope XOR: exactly one scope target matches scope_kind.
    check(
      'ai_jobs_scope_xor',
      sql`(scope_kind='formal_project' AND project_id IS NOT NULL AND quick_session_id IS NULL AND training_attempt_id IS NULL)
        OR (scope_kind='quick_session' AND project_id IS NULL AND quick_session_id IS NOT NULL AND training_attempt_id IS NULL)
        OR (scope_kind='training_attempt' AND project_id IS NULL AND quick_session_id IS NULL AND training_attempt_id IS NOT NULL)`,
    ),
    // Created-by XOR.
    check(
      'ai_jobs_created_by_xor',
      sql`(created_by_kind='user' AND created_by_user_id IS NOT NULL AND created_by_guest_session_id IS NULL)
        OR (created_by_kind='guest' AND created_by_user_id IS NULL AND created_by_guest_session_id IS NOT NULL)`,
    ),
    // Formal-project jobs can only be created by a user.
    check('ai_jobs_formal_user_creator', sql`scope_kind <> 'formal_project' OR created_by_kind='user'`),
    // Cancelled-by XOR: either nothing, or a user/guest/system with cancelled_at set.
    check(
      'ai_jobs_cancelled_by_xor',
      sql`(cancelled_by_kind IS NULL AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NULL)
        OR (cancelled_by_kind='user' AND cancelled_by_user_id IS NOT NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NOT NULL)
        OR (cancelled_by_kind='guest' AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NOT NULL AND cancelled_at IS NOT NULL)
        OR (cancelled_by_kind='system' AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NOT NULL)`,
    ),
    index('idx_ai_jobs_status_next_run_created').on(t.status, t.nextRunAt, t.createdAt),
    // Three dedupe partial unique indexes (§9; required by spec).
    uniqueIndex('uq_ai_job_formal_dedupe').on(t.projectId, t.taskType, t.dedupeKey).where(sql`scope_kind='formal_project'`),
    uniqueIndex('uq_ai_job_quick_dedupe').on(t.quickSessionId, t.taskType, t.dedupeKey).where(sql`scope_kind='quick_session'`),
    uniqueIndex('uq_ai_job_training_dedupe').on(t.trainingAttemptId, t.taskType, t.dedupeKey).where(sql`scope_kind='training_attempt'`),
  ],
);

// §9 ai_runs
export const aiRuns = sqliteTable(
  'ai_runs',
  {
    id: text('id').primaryKey(),
    aiJobId: text('ai_job_id').notNull().references(() => aiJobs.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    provider: text('provider'),
    model: text('model'),
    modelRevision: text('model_revision'),
    thinkingMode: text('thinking_mode'),
    reasoningEffort: text('reasoning_effort'),
    promptVersion: text('prompt_version'),
    schemaVersion: text('schema_version'),
    domainProfileId: text('domain_profile_id').references(() => domainProfiles.id, { onDelete: 'restrict' }),
    domainProfileVersion: integer('domain_profile_version'),
    domainPackVersionsJson: text('domain_pack_versions_json'),
    datasetVersion: text('dataset_version'),
    inputHash: text('input_hash'),
    outboundPayloadHash: text('outbound_payload_hash'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    rawAuditBlobId: text('raw_audit_blob_id').references(() => blobs.id, { onDelete: 'restrict' }),
    rawAuditClass: text('raw_audit_class').notNull().default('final_output'),
    rawAuditExpiresAt: text('raw_audit_expires_at'),
    parsedOutputJson: text('parsed_output_json'),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (t) => [
    check('ai_runs_attempt_check', sql`attempt > 0`),
    check('ai_runs_raw_audit_class_check', sql`raw_audit_class IN ('none','final_output','debug_with_reasoning')`),
    check('ai_runs_parsed_output_json_check', sql`parsed_output_json IS NULL OR json_valid(parsed_output_json)`),
    check(
      'ai_runs_status_check',
      sql`status IN ('running','validating','succeeded','failed','cancelled')`,
    ),
    // domain_profile_id and domain_profile_version both NULL or both NOT NULL.
    check(
      'ai_runs_domain_profile_xor',
      sql`(domain_profile_id IS NULL AND domain_profile_version IS NULL)
        OR (domain_profile_id IS NOT NULL AND domain_profile_version IS NOT NULL)`,
    ),
    uniqueIndex('uq_ai_runs_job_attempt').on(t.aiJobId, t.attempt),
  ],
);

// §9B agent_runs — controlled Orchestrator audit rows.
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    aiJobId: text('ai_job_id').notNull().references(() => aiJobs.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    planId: text('plan_id').notNull(),
    planVersion: text('plan_version').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    inputHash: text('input_hash').notNull(),
    outputHash: text('output_hash'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (t) => [
    check('agent_runs_mode_check', sql`mode IN ('quick','formal','training')`),
    check('agent_runs_status_check', sql`status IN ('running','succeeded','failed','cancelled')`),
    index('idx_agent_runs_job').on(t.aiJobId),
    index('idx_agent_runs_plan').on(t.planId, t.planVersion),
  ],
);

// §9B skill_runs — versioned Skill execution audit rows.
export const skillRuns = sqliteTable(
  'skill_runs',
  {
    id: text('id').primaryKey(),
    agentRunId: text('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    skillId: text('skill_id').notNull(),
    skillVersion: text('skill_version').notNull(),
    category: text('category').notNull(),
    status: text('status').notNull(),
    inputHash: text('input_hash').notNull(),
    outputHash: text('output_hash'),
    inputSchemaVersion: text('input_schema_version').notNull(),
    outputSchemaVersion: text('output_schema_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    provider: text('provider'),
    model: text('model'),
    thinkingMode: text('thinking_mode'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    usageEstimated: integer('usage_estimated'),
    errorCode: text('error_code'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (t) => [
    check('skill_runs_step_index_check', sql`step_index >= 0`),
    check(
      'skill_runs_category_check',
      sql`category IN ('routing','elicitation','structuring','validation','decisioning','composition')`,
    ),
    check('skill_runs_status_check', sql`status IN ('running','succeeded','failed','skipped','cancelled')`),
    uniqueIndex('uq_skill_runs_agent_step').on(t.agentRunId, t.stepIndex),
    index('idx_skill_runs_agent').on(t.agentRunId),
    index('idx_skill_runs_skill').on(t.skillId, t.skillVersion),
  ],
);

// §11 idempotency_records
export const idempotencyRecords = sqliteTable(
  'idempotency_records',
  {
    id: text('id').primaryKey(),
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    endpoint: text('endpoint').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseJson: text('response_json'),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [
    check('idempotency_records_actor_kind_check', sql`actor_kind IN ('user','guest')`),
    check('idempotency_records_response_json_check', sql`response_json IS NULL OR json_valid(response_json)`),
    uniqueIndex('uq_idempotency_records_actor_endpoint_key').on(
      t.actorKind,
      t.actorId,
      t.endpoint,
      t.idempotencyKey,
    ),
  ],
);

export type AiJob = typeof aiJobs.$inferSelect;
export type NewAiJob = typeof aiJobs.$inferInsert;
export type AiRun = typeof aiRuns.$inferSelect;
export type NewAiRun = typeof aiRuns.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type SkillRun = typeof skillRuns.$inferSelect;
export type NewSkillRun = typeof skillRuns.$inferInsert;
export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;
export type NewIdempotencyRecord = typeof idempotencyRecords.$inferInsert;
