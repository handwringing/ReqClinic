import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RouteRegistry, RouteContext, Actor } from '../../route-registry';
import { ApiError } from '../../errors';
import type { TrainingRepo } from '../../../repo/training-repo';
import type { JobRepo } from '../../../repo/job-repo';
import type {
  TrainingCase,
  TrainingAttempt,
  TrainingFeedback,
} from '../../../db/schema/training';
import type { AiJob } from '../../../db/schema/job';

/**
 * Expressive-training routes (Task 30, §12A).
 *
 * Registers 9 training operationIds onto the route registry. Training data is
 * strictly isolated from real project data: training attempts, questions and
 * summaries never write to project tables, and the training state machine is
 * independent of quick/formal modes.
 *
 * Async endpoints (202 + job_id) enqueue real `ai_jobs` rows via
 * `jobRepo.create`. `postTrainingQuestion` enqueues a `training_response`
 * job (one per question index); `postTrainingSummary` enqueues a single
 * `training_feedback` job per attempt (dedupe-enforced). Both return the
 * 202 + `{ job_id, status, status_url }` shape aligned with the OpenAPI
 * `AsyncAcceptedResponse` contract.
 */

export interface TrainingRouteDeps {
  trainingRepo: TrainingRepo;
  jobRepo: JobRepo;
}

// ── zod request schemas ─────────────────────────────────────────────────────

const createAttemptSchema = z.object({
  case_id: z.string().min(1),
  case_version: z.string().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(),
});

const postQuestionSchema = z.object({
  question: z.string().min(1).max(10000),
  bound_refs: z.array(z.unknown()).optional(),
});

const postSummarySchema = z.object({
  summary: z.string().min(1).max(50000),
});

// ── helpers ─────────────────────────────────────────────────────────────────

function toRepoActor(actor: Actor): { kind: 'user' | 'guest'; id: string } {
  if (actor.kind === 'user' && actor.userId) {
    return { kind: 'user', id: actor.userId };
  }
  if (actor.kind === 'guest' && actor.guestSessionId) {
    return { kind: 'guest', id: actor.guestSessionId };
  }
  throw ApiError.unauthenticated();
}

function validateBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.validationError(result.error.flatten().fieldErrors);
  }
  return result.data;
}

/**
 * Enqueue a real `ai_jobs` row for a training async endpoint.
 *
 * Both `postTrainingQuestion` (`task_type='training_response'`) and
 * `postTrainingSummary` (`task_type='training_feedback'`) share this helper so
 * their 202 + `{ job_id, status, status_url }` shape stays aligned with the
 * OpenAPI `AsyncAcceptedResponse` contract (08 §8.2). The payload carries
 * enough context for the {@link TrainingJobExecutor} to run the runtime without
 * re-reading the route layer: `attemptId`, `caseId`, `caseVersion` plus the
 * question text / summary text / ids the runtime needs.
 *
 * Dedupe is enforced by a partial unique index on `(scope, taskType,
 * dedupeKey)` (§9). A re-enqueue of the same tuple surfaces as a 409
 * `JOB_DEDUPE_CONFLICT`.
 */
function enqueueTrainingJob(input: {
  ctx: RouteContext;
  jobRepo: JobRepo;
  attemptId: string;
  actor: { kind: 'user' | 'guest'; id: string };
  taskType: 'training_response' | 'training_feedback';
  payload: Record<string, unknown>;
  dedupeKey: string;
}): {
  data: { job_id: string; status: string; status_url: string };
  meta: Record<string, unknown>;
  statusCode: number;
} {
  const payloadJson = JSON.stringify({
    ...input.payload,
    training_attempt_id: input.attemptId,
    request_id: input.ctx.requestId,
  });
  const inputHash = createHash('sha256').update(payloadJson, 'utf8').digest('hex');
  let job: AiJob;
  try {
    job = input.jobRepo.create({
      scopeKind: 'training_attempt',
      trainingAttemptId: input.attemptId,
      taskType: input.taskType,
      payloadJson,
      inputHash,
      dedupeKey: input.dedupeKey,
      createdByKind: input.actor.kind,
      createdByUserId: input.actor.kind === 'user' ? input.actor.id : undefined,
      createdByGuestSessionId:
        input.actor.kind === 'guest' ? input.actor.id : undefined,
    });
  } catch (err: unknown) {
    if (isUniqueConstraintError(err)) {
      throw ApiError.conflict(
        'JOB_DEDUPE_CONFLICT',
        'An equivalent training job is already queued or running.',
      );
    }
    throw err;
  }
  return {
    data: {
      job_id: job.id,
      status: job.status,
      status_url: `/api/v1/ai-jobs/${job.id}`,
    },
    meta: {},
    statusCode: 202,
  };
}

/** Detect a SQLite UNIQUE constraint violation from better-sqlite3 / drizzle. */
function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? '';
  return (
    msg.includes('UNIQUE') ||
    msg.includes('SQLITE_CONSTRAINT_UNIQUE') ||
    (msg.includes('constraint') && msg.includes('unique'))
  );
}

function parseJson<T = unknown>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Serialize a training_cases row to the list-item shape (§12A.1). */
function serializeCase(row: TrainingCase) {
  const scenario = parseJson<{ category?: string; description?: string }>(
    row.scenarioJson,
    {},
  );
  return {
    id: row.caseId,
    name: row.title,
    category: scenario.category ?? '通用练习',
    difficulty_levels: [row.difficulty],
    latest_version: row.version,
    description: scenario.description ?? '',
    status: row.status,
  };
}

/**
 * Serialize a training_cases row to the public version-detail shape
 * (§12A.2, 08 §7.2).
 *
 * Returns only public-facing fields: `public_brief` (role_label, practice_goal,
 * visible_constraints) and the `evaluation_dimensions` name list. The private
 * `disclosure_rules` trigger rules, `answer_key`, `hidden_facts` and `rubric`
 * scoring rules are intentionally omitted — the backend TrainingPracticeRuntime
 * reads them via `trainingRepo.getCasePrivateManifest()` (Task 1.2).
 */
function serializeCaseVersion(row: TrainingCase) {
  const scenario = parseJson<{
    category?: string;
    description?: string;
    role_label?: string;
    practice_goal?: string;
    visible_constraints?: unknown;
  }>(row.scenarioJson, {});
  const rubric = parseJson<{
    evaluation_dimensions?: unknown;
  }>(row.rubricJson, {});
  const visibleConstraints = Array.isArray(scenario.visible_constraints)
    ? (scenario.visible_constraints as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      )
    : [];
  const evaluationDimensions = Array.isArray(rubric.evaluation_dimensions)
    ? (rubric.evaluation_dimensions as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      )
    : [];
  return {
    id: row.caseId,
    version: row.version,
    name: row.title,
    category: scenario.category ?? '通用练习',
    difficulty: row.difficulty,
    description: scenario.description ?? '',
    public_brief: {
      description: scenario.description ?? '',
      role_label: scenario.role_label ?? '',
      practice_goal: scenario.practice_goal ?? '',
      visible_constraints: visibleConstraints,
    },
    evaluation_dimensions: evaluationDimensions,
    status: row.status,
  };
}

/** Serialize a training_attempts row to the TrainingAttempt schema (§12A.6). */
function serializeAttempt(row: TrainingAttempt, repo?: TrainingRepo) {
  const turns = repo?.listTurns(row.id) ?? [];
  return {
    attempt_id: row.id,
    status: row.status,
    case_id: row.caseId,
    case_version: row.caseVersion,
    question_count: repo?.countQuestions(row.id) ?? 0,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    messages: turns.map(serializeTrainingTurn),
    coach_projection: repo?.latestCoachProjection(row.id) ?? null,
  };
}

/** Serialize a training_feedback row to the TrainingFeedback schema (§12A.6). */
function serializeFeedback(row: TrainingFeedback) {
  const feedbackJson = parseJson<Record<string, any>>(row.feedbackJson, {});
  const dimensions = Array.isArray(feedbackJson.dimensions)
    ? feedbackJson.dimensions as Array<Record<string, any>>
    : [];
  const summaryReview =
    feedbackJson.summary_review && typeof feedbackJson.summary_review === 'object'
      ? feedbackJson.summary_review as Record<string, any>
      : {};
  const missingDimensions = Array.from(new Set([
    ...dimensions
      .filter((item) => Number(item.score ?? 0) <= 0)
      .map((item) => String(item.dimension ?? '').trim())
      .filter(Boolean),
    ...(Array.isArray(summaryReview.missing_points)
      ? summaryReview.missing_points
          .map((item) => String(item).trim())
          .filter((item) => item && !item.includes('具体遗漏的高价值问题'))
      : []),
  ]));
  const highValueQuestions = Array.isArray(feedbackJson.missed_high_value_questions)
    ? feedbackJson.missed_high_value_questions.map((item: unknown) => String(item).trim()).filter(Boolean)
    : [];
  const dimensionSuggestions = dimensions
    .map((item) => String(item.improvement ?? '').trim())
    .filter(Boolean);
  const compactSuggestions = [
    ...highValueQuestions.slice(0, 5).map((question) => `下次可以补问：${question}`),
    ...(highValueQuestions.length === 0 ? dimensionSuggestions.slice(0, 5) : []),
    typeof summaryReview.improved_summary === 'string'
      ? `总结可以这样补强：${summaryReview.improved_summary}`
      : '',
  ].filter(Boolean);
  return {
    coverage_score: row.coverageScoreBp / 10000,
    missing_dimensions: missingDimensions,
    improvement_suggestions: Array.from(new Set(compactSuggestions)).slice(0, 6),
    dimension_breakdown: dimensions.map((item) => {
      const score = Number(item.score ?? 0);
      const max = Number(item.max ?? 20);
      const ratio = max > 0 ? score / max : 0;
      return {
        dimension: String(item.dimension ?? '练习维度'),
        status: ratio >= 0.7 ? 'covered' : score > 0 ? 'partial' : 'missing',
        evidence: String(item.evidence ?? ''),
        comment: String(item.improvement ?? ''),
      };
    }),
    improvement_examples: parseJson<unknown[]>(row.improvementExamplesJson, []),
  };
}

function serializeTrainingTurn(row: ReturnType<TrainingRepo['listTurns']>[number]) {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    speaker: row.role,
    content: row.content,
    bindings: parseJson<unknown[]>(row.boundRefsJson, []),
    coach_projection: parseJson<Record<string, unknown>>(row.coachProjectionJson, {}),
    created_at: row.createdAt,
  };
}

// ── registration ────────────────────────────────────────────────────────────

export function registerTrainingRoutes(
  registry: RouteRegistry,
  deps: TrainingRouteDeps,
): void {
  const { trainingRepo, jobRepo } = deps;

  // 1. listTrainingCases — GET /training-cases (requireActor)
  registry.register('listTrainingCases', async (ctx: RouteContext) => {
    toRepoActor(ctx.actor);
    const { items, nextCursor } = trainingRepo.listCases({
      limit: ctx.query.limit,
      cursor: ctx.query.cursor,
    });
    return {
      data: items.map(serializeCase),
      meta: {
        cursor: nextCursor ?? null,
        has_more: nextCursor !== null,
      },
    };
  });

  // 2. getTrainingCaseVersion — GET /training-cases/:caseId/versions/:version
  registry.register('getTrainingCaseVersion', async (ctx: RouteContext) => {
    toRepoActor(ctx.actor);
    const { caseId, version } = ctx.params;
    const row = trainingRepo.getCaseVersion(caseId, version);
    if (!row) {
      throw new ApiError(
        404,
        'TRAINING_CASE_NOT_FOUND',
        'Training case or version not found',
        { details: { resource: 'training_case' } },
      );
    }
    return serializeCaseVersion(row);
  });

  // 3. createTrainingAttempt — POST /training-attempts (协议关口 + requireActor)
  registry.register(
    'createTrainingAttempt',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const body = validateBody(createAttemptSchema, ctx.body);
      const attempt = trainingRepo.createAttempt({
        caseId: body.case_id,
        caseVersion: body.case_version,
        actorKind: repoActor.kind,
        userId: repoActor.kind === 'user' ? repoActor.id : undefined,
        guestSessionId: repoActor.kind === 'guest' ? repoActor.id : undefined,
      });
      return serializeAttempt(attempt, trainingRepo);
    },
    { requireAgreement: true, idempotent: true },
  );

  // 4. postTrainingQuestion — POST /training-attempts/:id/questions (协议关口, 202+job)
  registry.register(
    'postTrainingQuestion',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const attempt = trainingRepo.findByIdForActor(ctx.params.id, repoActor);
      const body = validateBody(postQuestionSchema, ctx.body);
      // `training_questions` still stores only the index; the question text is
      // stored separately in training_turns so this practice can recover after
      // refresh without entering quick/formal/project assets.
      const question = trainingRepo.postQuestion({
        attemptId: attempt.id,
        question: body.question,
        boundRefs: body.bound_refs,
      });
      // Enqueue a real ai_jobs row (08 §8.1). The payload carries the question
      // text plus case context the TrainingJobExecutor needs to build the
      // runtime prompt.
      return enqueueTrainingJob({
        ctx,
        jobRepo,
        attemptId: attempt.id,
        actor: repoActor,
        taskType: 'training_response',
        payload: {
          attemptId: attempt.id,
          caseId: attempt.caseId,
          caseVersion: attempt.caseVersion,
          question: body.question,
          question_index: question.questionIndex,
          questionIndex: question.questionIndex,
        },
        dedupeKey: `training_response:${attempt.id}:${question.questionIndex}`,
      });
    },
    { requireAgreement: true, idempotent: true },
  );

  // 5. postTrainingSummary — POST /training-attempts/:id/summary (202+job)
  registry.register(
    'postTrainingSummary',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const attempt = trainingRepo.findByIdForActor(ctx.params.id, repoActor);
      const body = validateBody(postSummarySchema, ctx.body);
      // Stores only the summary hash; transitions to `summarizing` (§12A.5).
      const summary = trainingRepo.postSummary({
        attemptId: attempt.id,
        summary: body.summary,
      });
      // Enqueue a real ai_jobs row (08 §8.2). Each attempt only generates one
      // feedback job: a second submission collides on the dedupe key and
      // surfaces as 409 JOB_DEDUPE_CONFLICT.
      return enqueueTrainingJob({
        ctx,
        jobRepo,
        attemptId: attempt.id,
        actor: repoActor,
        taskType: 'training_feedback',
        payload: {
          attemptId: attempt.id,
          caseId: attempt.caseId,
          caseVersion: attempt.caseVersion,
          summary: body.summary,
          summaryId: summary.id,
        },
        dedupeKey: `training_feedback:${attempt.id}`,
      });
    },
    { idempotent: true },
  );

  // 6. getTrainingAttempt — GET /training-attempts/:id (§12A.6)
  registry.register('getTrainingAttempt', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const attempt = trainingRepo.findByIdForActor(ctx.params.id, repoActor);
    return serializeAttempt(attempt, trainingRepo);
  });

  // 7. getTrainingFeedback — GET /training-attempts/:id/feedback (§12A.6)
  registry.register('getTrainingFeedback', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    // Verify ownership first; non-owners get a 404 to avoid leaking existence.
    trainingRepo.findByIdForActor(ctx.params.id, repoActor);
    const { ready, feedback } = trainingRepo.getFeedback(ctx.params.id);
    if (!ready || !feedback) {
      throw ApiError.notFound('Training feedback not found', 'training_feedback');
    }
    return serializeFeedback(feedback);
  });

  // 8. retryTrainingAttempt — POST /training-attempts/:id/retry (§12A.7)
  // Creates a fresh attempt for the same case+version under the same actor;
  // prior feedback is preserved on the old attempt, never overwritten.
  registry.register(
    'retryTrainingAttempt',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const prior = trainingRepo.findByIdForActor(ctx.params.id, repoActor);
      const next = trainingRepo.createAttempt({
        caseId: prior.caseId,
        caseVersion: prior.caseVersion,
        actorKind: repoActor.kind,
        userId: repoActor.kind === 'user' ? repoActor.id : undefined,
        guestSessionId: repoActor.kind === 'guest' ? repoActor.id : undefined,
      });
      return {
        data: {
          new_attempt_id: next.id,
          status: next.status,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { idempotent: true },
  );

  // 9. completeTrainingAttempt — POST /training-attempts/:id/complete (§12A.8)
  // `completed` is terminal and is not an authoritative capability certification.
  registry.register(
    'completeTrainingAttempt',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const completed = trainingRepo.complete(ctx.params.id, repoActor);
      return {
        data: {
          attempt_id: completed.id,
          status: completed.status,
          completed_at: completed.completedAt,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { idempotent: true },
  );
}
