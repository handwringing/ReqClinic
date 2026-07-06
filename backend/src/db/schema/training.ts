import { sqliteTable, text, integer, check, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { guestSessions } from './identity';

/**
 * Expressive training domain (§12A) — experimental mode (P2).
 *
 * Training data is strictly isolated from real project data: training outputs
 * never produce formal Fact/Requirement/Decision/ReviewAction. The training
 * state machine `not_started → interviewing → summarizing → feedback_ready →
 * retrying/completed` is independent of other modes.
 */

// §12A.1 training_cases
export const trainingCases = sqliteTable(
  'training_cases',
  {
    id: text('id').primaryKey(),
    // Logical case id; same case may have multiple versions.
    caseId: text('case_id').notNull(),
    version: text('version').notNull(),
    title: text('title').notNull(),
    difficulty: text('difficulty').notNull(),
    // scenario_json holds the case scene and disclosable information;
    // disclosure_rules_json defines progressive disclosure rules;
    // rubric_json is the transparent scoring rubric.
    scenarioJson: text('scenario_json').notNull(),
    disclosureRulesJson: text('disclosure_rules_json').notNull(),
    rubricJson: text('rubric_json').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('training_cases_difficulty_check', sql`difficulty IN ('easy','medium','hard')`),
    check('training_cases_status_check', sql`status IN ('draft','active','deprecated')`),
    check('training_cases_scenario_json_check', sql`json_valid(scenario_json)`),
    check('training_cases_disclosure_rules_json_check', sql`json_valid(disclosure_rules_json)`),
    check('training_cases_rubric_json_check', sql`json_valid(rubric_json)`),
    // UNIQUE(case_id, version)
    uniqueIndex('uq_training_cases_case_version').on(t.caseId, t.version),
  ],
);

// §12A.2 training_attempts
export const trainingAttempts = sqliteTable(
  'training_attempts',
  {
    id: text('id').primaryKey(),
    // case_id + case_version reference training_cases(case_id, version) at the
    // application layer. The doc DDL does not declare a composite FK (the
    // target is a UNIQUE constraint, not a PK), so these are plain text columns
    // validated by the repository to keep training data isolated from real
    // project evidence.
    caseId: text('case_id').notNull(),
    caseVersion: text('case_version').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'restrict' }),
    guestSessionId: text('guest_session_id').references(() => guestSessions.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    attemptNumber: integer('attempt_number').notNull(),
    createdAt: text('created_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    check(
      'training_attempts_status_check',
      sql`status IN ('not_started','interviewing','summarizing','feedback_ready','retrying','completed')`,
    ),
    check('training_attempts_attempt_number_check', sql`attempt_number > 0`),
    check('training_attempts_version_check', sql`version > 0`),
    // user_id / guest_session_id XOR
    check(
      'training_attempts_owner_xor',
      sql`(user_id IS NOT NULL AND guest_session_id IS NULL)
        OR (user_id IS NULL AND guest_session_id IS NOT NULL)`,
    ),
    index('idx_training_attempts_user_id').on(t.userId).where(sql`user_id IS NOT NULL`),
    index('idx_training_attempts_guest_session_id').on(t.guestSessionId).where(sql`guest_session_id IS NOT NULL`),
    index('idx_training_attempts_case_id').on(t.caseId),
  ],
);

// §12A.3 training_questions
export const trainingQuestions = sqliteTable(
  'training_questions',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id').notNull().references(() => trainingAttempts.id, { onDelete: 'restrict' }),
    questionIndex: integer('question_index').notNull(),
    askedAt: text('asked_at').notNull(),
    // disclosure_rule_hit is the id of the disclosure rule triggered by this
    // question, used to decide progressive disclosure. NULL when no rule hit.
    disclosureRuleHit: text('disclosure_rule_hit'),
  },
  (t) => [
    check('training_questions_question_index_check', sql`question_index >= 0`),
  ],
);

// §12A.4 training_summaries
export const trainingSummaries = sqliteTable(
  'training_summaries',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id').notNull().references(() => trainingAttempts.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    // Only the hash is stored, never the summary body (PRD §12.5).
    summaryHash: text('summary_hash').notNull(),
    submittedAt: text('submitted_at').notNull(),
  },
  (t) => [
    check('training_summaries_version_check', sql`version > 0`),
    // UNIQUE(attempt_id, version)
    uniqueIndex('uq_training_summaries_attempt_version').on(t.attemptId, t.version),
  ],
);

// §12A.5 training_feedback
export const trainingFeedback = sqliteTable(
  'training_feedback',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id').notNull().references(() => trainingAttempts.id, { onDelete: 'restrict' }),
    // coverage_score_bp is a 0–10000 integer basis point; projected to 0–1
    // decimal or 0–100% for display. Score is for this attempt only and is not
    // an authoritative capability certification.
    coverageScoreBp: integer('coverage_score_bp').notNull(),
    missingDimensionCount: integer('missing_dimension_count').notNull(),
    feedbackJson: text('feedback_json').notNull(),
    dimensionBreakdownJson: text('dimension_breakdown_json').notNull().default('[]'),
    improvementExamplesJson: text('improvement_examples_json').notNull().default('[]'),
    generatedAt: text('generated_at').notNull(),
  },
  (t) => [
    check('training_feedback_coverage_score_bp_check', sql`coverage_score_bp >= 0 AND coverage_score_bp <= 10000`),
    check('training_feedback_feedback_json_check', sql`json_valid(feedback_json)`),
    check('training_feedback_dimension_breakdown_json_check', sql`json_valid(dimension_breakdown_json)`),
    check('training_feedback_improvement_examples_json_check', sql`json_valid(improvement_examples_json)`),
  ],
);

// §12A.6 training_turns — safe conversation recovery for expression training.
export const trainingTurns = sqliteTable(
  'training_turns',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id').notNull().references(() => trainingAttempts.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    boundRefsJson: text('bound_refs_json').notNull().default('[]'),
    coachProjectionJson: text('coach_projection_json').notNull().default('{}'),
    aiJobId: text('ai_job_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('training_turns_role_check', sql`role IN ('user','role','coach')`),
    check('training_turns_bound_refs_json_check', sql`json_valid(bound_refs_json)`),
    check('training_turns_coach_projection_json_check', sql`json_valid(coach_projection_json)`),
    index('idx_training_turns_attempt_id').on(t.attemptId),
    uniqueIndex('uq_training_turns_job_role')
      .on(t.aiJobId, t.role)
      .where(sql`ai_job_id IS NOT NULL`),
  ],
);

export type TrainingCase = typeof trainingCases.$inferSelect;
export type NewTrainingCase = typeof trainingCases.$inferInsert;
export type TrainingAttempt = typeof trainingAttempts.$inferSelect;
export type NewTrainingAttempt = typeof trainingAttempts.$inferInsert;
export type TrainingQuestion = typeof trainingQuestions.$inferSelect;
export type NewTrainingQuestion = typeof trainingQuestions.$inferInsert;
export type TrainingSummary = typeof trainingSummaries.$inferSelect;
export type NewTrainingSummary = typeof trainingSummaries.$inferInsert;
export type TrainingFeedback = typeof trainingFeedback.$inferSelect;
export type NewTrainingFeedback = typeof trainingFeedback.$inferInsert;
export type TrainingTurn = typeof trainingTurns.$inferSelect;
export type NewTrainingTurn = typeof trainingTurns.$inferInsert;
