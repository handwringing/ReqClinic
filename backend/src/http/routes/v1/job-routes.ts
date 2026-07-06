import { createHash } from 'node:crypto';
import type { RouteRegistry, RouteContext, Actor } from '../../route-registry';
import { ApiError } from '../../errors';
import { requireUser, requireProjectCapability } from '../../middleware/auth';
import type { JobRepo, JobActor } from '../../../repo/job-repo';

/**
 * Analysis & async-job routes (Task 22, §8).
 *
 * Registers 3 operationIds:
 *  - `createAnalysisRun`: enqueues a formal-project AI job (202 + job_id).
 *  - `getJobStatus`: scope-safe polling of a job's status + progress.
 *  - `cancelJob`: identity-scoped cancellation.
 */

export interface JobRouteDeps {
  jobRepo: JobRepo;
}

/** Adapt the route-registry Actor to the JobRepo's actor shape. */
function asJobActor(actor: Actor): JobActor {
  return {
    kind: actor.kind,
    userId: actor.userId,
    guestSessionId: actor.guestSessionId,
  };
}

// ── registration ─────────────────────────────────────────────────────────────

export function registerJobRoutes(
  registry: RouteRegistry,
  deps: JobRouteDeps,
): void {
  // 1. createAnalysisRun ─ POST /api/v1/projects/:id/analysis-runs ────────────
  registry.register(
    'createAnalysisRun',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');

      const body = ctx.body ?? {};
      const task = typeof body.task === 'string' ? body.task : undefined;
      if (!task) {
        // 400 — missing required field (per OpenAPI response for createAnalysisRun).
        throw new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', {
          details: { task: 'required string' },
        });
      }

      // Map the wire `task` to the internal taskType. `domain_profile` and
      // `structured_extraction` are the two v1 analysis tasks.
      const taskType =
        task === 'domain_profile'
          ? 'domain_profile'
          : task === 'structured_extraction'
            ? 'analysis_extraction'
            : task;

      const payload = {
        project_id: ctx.params.id,
        task,
        source_ids: Array.isArray(body.source_ids) ? body.source_ids : [],
        domain_profile_id: body.domain_profile_id ?? null,
        domain_profile_version: body.domain_profile_version ?? null,
        domain_pack_versions: body.domain_pack_versions ?? null,
        expected_project_version: body.expected_project_version ?? null,
      };
      const payloadJson = JSON.stringify(payload);
      const inputHash = createHash('sha256').update(payloadJson, 'utf8').digest('hex');
      const dedupeKey = inputHash.slice(0, 16);

      const userId = ctx.actor.userId!;
      let job;
      try {
        job = deps.jobRepo.create({
          scopeKind: 'formal_project',
          projectId: ctx.params.id,
          taskType,
          payloadJson,
          inputHash,
          dedupeKey,
          createdByKind: 'user',
          createdByUserId: userId,
        });
      } catch (err: unknown) {
        // The dedupe partial unique index (§9) rejects a re-enqueue of the same
        // (project, taskType, dedupeKey) tuple; surface as a 409.
        if (isUniqueConstraintError(err)) {
          throw ApiError.conflict(
            'JOB_DEDUPE_CONFLICT',
            'An equivalent analysis job is already queued or running.',
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
    },
    { requireActor: 'user', requireAgreement: true },
  );

  // 2. getJobStatus ─ GET /api/v1/ai-jobs/:id ─────────────────────────────────
  registry.register(
    'getJobStatus',
    async (ctx: RouteContext) => {
      // Any guest or user may poll; scope authorisation happens inside
      // findByIdForActor (returns null → 404 for out-of-scope callers).
      if (ctx.actor.kind === 'unauthenticated') {
        throw ApiError.unauthenticated();
      }
      const job = deps.jobRepo.findByIdForActor(ctx.params.id, asJobActor(ctx.actor));
      if (!job) {
        throw ApiError.notFound('AI job not found', 'ai_job');
      }
      const progress = deps.jobRepo.getProgress(job.id);
      const latestRun = ctx.db.raw
        .prepare(
          `SELECT parsed_output_json, completed_at
           FROM ai_runs
           WHERE ai_job_id = ?
           ORDER BY attempt DESC
           LIMIT 1`,
        )
        .get(job.id) as { parsed_output_json: string | null; completed_at: string | null } | undefined;
      const result =
        job.status === 'succeeded' && latestRun?.parsed_output_json
          ? safeParseJson(latestRun.parsed_output_json)
          : null;

      return {
        job_id: job.id,
        task: job.taskType,
        status: job.status,
        progress: progress?.progress ?? 0,
        current_step: progress?.current_step ?? job.status,
        attempts: job.attempts,
        max_attempts: job.maxAttempts,
        result,
        last_error_code: job.lastErrorCode,
        completed_at: progress?.completed_at ?? latestRun?.completed_at ?? null,
        duration_ms: progress?.duration_ms ?? null,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
      };
    },
    { requireActor: 'any' },
  );

  // 3. cancelJob ─ POST /api/v1/ai-jobs/:id/cancel ───────────────────────────
  registry.register(
    'cancelJob',
    async (ctx: RouteContext) => {
      if (ctx.actor.kind === 'unauthenticated') {
        throw ApiError.unauthenticated();
      }
      const job = deps.jobRepo.findByIdForActor(ctx.params.id, asJobActor(ctx.actor));
      if (!job) {
        throw ApiError.notFound('AI job not found', 'ai_job');
      }

      const body = ctx.body ?? {};
      const reason =
        typeof body.reason === 'string' ? body.reason : 'cancelled by caller';

      // Actor kind is narrowed to 'user' | 'guest' by the unauthenticated guard above.
      const cancelled = deps.jobRepo.cancel(
        job.id,
        ctx.actor.kind as 'user' | 'guest',
        ctx.actor.userId,
        ctx.actor.guestSessionId,
        reason,
      );

      return {
        data: {
          job_id: cancelled.id,
          status: cancelled.status,
          cancellation_reason: cancelled.cancellationReason,
          cancelled_by_kind: cancelled.cancelledByKind,
          cancelled_by: cancelled.cancelledByUserId ?? cancelled.cancelledByGuestSessionId,
          cancelled_at: cancelled.cancelledAt,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { requireActor: 'any' },
  );
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
