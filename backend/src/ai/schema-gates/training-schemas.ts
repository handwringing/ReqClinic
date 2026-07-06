import { z } from 'zod';

/**
 * Expression-training output schema gates (08 plan §5.3 / §6.2).
 *
 * These gates re-validate model output for the expression-training real chain
 * before results are persisted to domain tables. Two of them
 * (`trainingRoleAnswerOutputSchema`, `trainingFeedbackOutputSchema`) are
 * registered as taskType gates in `schema-gates.ts`; the other two
 * (`trainingCoverageUpdateSchema`, `trainingQuestionQualitySchema`) are
 * Skill-internal outputs validated by the Runtime but still exported here so
 * the same source of truth is reused.
 *
 * As with the existing gates, schemas are permissive about extra keys
 * (`.passthrough()`) so providers may attach debugging metadata; only the
 * load-bearing structural fields are asserted.
 */

// ----------------------------------------------- §5.3 TrainingResponseOutput ---

export const trainingRoleAnswerOutputSchema = z
  .object({
    result_type: z.literal('training_response'),
    role_answer: z
      .object({
        content: z.string(),
        tone: z.enum(['customer', 'teacher', 'colleague', 'business_owner']),
        disclosed_rule_ids: z.array(z.string()),
        safe_to_show: z.literal(true),
      })
      .passthrough(),
    coach_projection: z
      .object({
        next_hint: z.string(),
        question_quality_note: z.string(),
        visible_progress_label: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

// ------------------------------- §6.2 training.structuring.coverage_update ---

export const trainingCoverageUpdateSchema = z
  .object({
    hit_dimensions: z.array(z.string()),
    disclosed_rule_ids: z.array(z.string()),
    coverage_progress_label: z.string(),
  })
  .passthrough();

// ----------------------------- §6.2 training.validation.question_quality ---

export const trainingQuestionQualitySchema = z
  .object({
    quality_label: z.enum([
      'effective',
      'too_broad',
      'repeated',
      'meaningless',
      'leading',
    ]),
    reason: z.string(),
    suggestion: z.string().nullable(),
  })
  .passthrough();

// ------------------------------------------------- §5.3 TrainingFeedbackOutput ---

export const trainingFeedbackOutputSchema = z
  .object({
    result_type: z.literal('training_feedback'),
    score: z
      .object({
        total: z.number().min(0),
        max: z.number().min(0),
        label: z.string(),
      })
      .passthrough(),
    dimensions: z
      .array(
        z
          .object({
            dimension: z.string(),
            score: z.number().min(0),
            max: z.number().min(0),
            evidence: z.string(),
            improvement: z.string(),
          })
          .passthrough(),
      )
      .default([]),
    missed_high_value_questions: z.array(z.string()).default([]),
    improvement_examples: z.array(
      z
        .object({
          before: z.string(),
          after: z.string(),
          reason: z.string(),
        })
        .passthrough(),
    ),
    summary_review: z
      .object({
        accuracy: z.string(),
        missing_points: z.array(z.string()).default([]),
        unsupported_claims: z.array(z.string()).default([]),
        improved_summary: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
