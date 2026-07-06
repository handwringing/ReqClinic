import { z } from 'zod';
import { formalMapSnapshotSchema } from '../agent/formal-schemas';
import {
  trainingRoleAnswerOutputSchema,
  trainingFeedbackOutputSchema,
} from './schema-gates/training-schemas';

/**
 * Per-taskType output schema gates (§9).
 *
 * Every AI run output is re-validated against its task's Zod schema before the
 * job transitions `running → validating → succeeded`. A failing gate flips the
 * job to `failed` with `last_error_code = SCHEMA_GATE_FAILED`, preventing
 * malformed model output from poisoning downstream domain tables.
 *
 * Schemas are intentionally permissive about extra keys (`.passthrough()`) so a
 * provider may attach debugging metadata without breaking the gate; only the
 * load-bearing structural fields are asserted.
 */

const unknownItemSchema = z
  .object({
    question: z.string(),
    status: z.string().optional(),
  })
  .passthrough();

const evidenceLinkSchema = z.string();

export const domainProfileOutputSchema = z
  .object({
    work_type: z.string(),
    domain_labels: z.array(z.string()),
    risk_flags: z.array(z.string()),
    terminology_map: z.record(z.string(), z.string()),
    suggested_pack_ids: z.array(z.string()),
    required_human_roles: z.array(z.string()),
    routing_risk: z.enum(['low', 'medium', 'high', 'unknown']),
    routing_basis: z.record(z.string(), z.unknown()),
    rationale_evidence_links: z.array(evidenceLinkSchema),
    unknowns: z.array(unknownItemSchema),
  })
  .passthrough();

export const projectCandidatesOutputSchema = z
  .object({
    candidates: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const analysisExtractionOutputSchema = z
  .object({
    result_type: z.literal('analysis_result'),
    outcomes: z.array(z.record(z.string(), z.unknown())).default([]),
    requirements: z.array(z.record(z.string(), z.unknown())).default([]),
    drivers: z.array(z.record(z.string(), z.unknown())).default([]),
    conflicts: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough();

export const briefGenerationOutputSchema = z
  .object({
    result_type: z.literal('brief'),
    brief: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const understandingReviewOutputSchema = z
  .object({
    result_type: z.literal('understanding_review'),
    coverage: z.record(z.string(), z.unknown()),
    gaps: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough();

export const trainingQuestionOutputSchema = z
  .object({
    result_type: z.literal('training_question'),
    question: z.string(),
    options: z.array(z.string()),
  })
  .passthrough();

/** Map taskType → output Zod schema. Unknown taskTypes fall back to any-object. */
export const SCHEMA_GATES: Readonly<Record<string, z.ZodTypeAny>> = {
  domain_profile: domainProfileOutputSchema,
  project_candidates: projectCandidatesOutputSchema,
  analysis_extraction: analysisExtractionOutputSchema,
  brief_generation: briefGenerationOutputSchema,
  formal_guidance: formalMapSnapshotSchema,
  understanding_review: understandingReviewOutputSchema,
  training_question: trainingQuestionOutputSchema,
  training_response: trainingRoleAnswerOutputSchema,
  training_feedback: trainingFeedbackOutputSchema,
};

export interface SchemaGateResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Validate `output` against the gate for `taskType`.
 *
 * Returns `{ ok, data }` on success (with the parsed, defaulted value) or
 * `{ ok: false, error }` on failure. Unknown taskTypes pass through unchanged
 * so the worker does not block on tasks added before their gate lands.
 */
export function validateOutput(taskType: string, output: unknown): SchemaGateResult {
  const schema = SCHEMA_GATES[taskType];
  if (!schema) {
    return { ok: true, data: output };
  }
  const parsed = schema.safeParse(output);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return { ok: false, error: parsed.error.message };
}

/** Stable error code recorded on ai_jobs.last_error_code when a gate fails. */
export const SCHEMA_GATE_ERROR_CODE = 'SCHEMA_GATE_FAILED';
