import { eq, and, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  aiJobs,
  aiRuns,
  type AiJob,
} from '../db/schema/job';
import { projectMembers } from '../db/schema/project';
import { quickSessions } from '../db/schema/quick';
import { trainingAttempts } from '../db/schema/training';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now, addSeconds } from '../shared/time';

/**
 * Repository for the `ai_jobs` table (§9).
 *
 * Jobs have three mutually exclusive scopes (formal_project / quick_session /
 * training_attempt) and may be created or cancelled by either a user or a
 * guest. Atomic claiming uses a single `UPDATE ... WHERE id=(SELECT ...)` so
 * concurrent workers cannot double-claim the same queued job.
 */

export type JobScopeKind = 'formal_project' | 'quick_session' | 'training_attempt';
export type JobCreatorKind = 'user' | 'guest';

/** Actor shape used for scope-based access checks (mirrors RouteRegistry.Actor). */
export interface JobActor {
  kind: 'guest' | 'user' | 'unauthenticated';
  userId?: string;
  guestSessionId?: string;
}

export interface CreateJobInput {
  scopeKind: JobScopeKind;
  projectId?: string;
  quickSessionId?: string;
  trainingAttemptId?: string;
  taskType: string;
  payloadJson: string;
  inputHash: string;
  dedupeKey: string;
  createdByKind: JobCreatorKind;
  createdByUserId?: string;
  createdByGuestSessionId?: string;
  idempotencyRecordId?: string;
  maxAttempts?: number;
}

/** Terminal statuses that a job cannot leave once entered. */
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'manual_review']);

export class JobRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Insert a new AI job in `queued` status.
   *
   * The three dedupe partial unique indexes (§9) enforce that the same
   * (scope, taskType, dedupeKey) tuple cannot be re-enqueued; a collision
   * throws a SQLITE_CONSTRAINT_UNIQUE error the caller maps to a 409.
   */
  create(input: CreateJobInput): AiJob {
    const id = generateId('job');
    const ts = now();
    const row = this.db
      .insert(aiJobs)
      .values({
        id,
        scopeKind: input.scopeKind,
        projectId: input.projectId ?? null,
        quickSessionId: input.quickSessionId ?? null,
        trainingAttemptId: input.trainingAttemptId ?? null,
        taskType: input.taskType,
        payloadJson: input.payloadJson,
        inputHash: input.inputHash,
        status: 'queued',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 3,
        nextRunAt: ts,
        dedupeKey: input.dedupeKey,
        createdByKind: input.createdByKind,
        createdByUserId: input.createdByUserId ?? null,
        createdByGuestSessionId: input.createdByGuestSessionId ?? null,
        idempotencyRecordId: input.idempotencyRecordId ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .get();
    return row;
  }

  /**
   * Atomically claim the next queued job for a worker.
   *
   * Uses a single `UPDATE ... WHERE id=(SELECT ...)` statement so concurrent
   * workers cannot race on the same row. Returns the claimed job or null when
   * the queue is empty.
   */
  claimNext(workerId: string): AiJob | null {
    const ts = now();
    const staleBefore = new Date(Date.now() - 120_000).toISOString();
    const rows = this.db
      .update(aiJobs)
      .set({
        status: 'running',
        lockedBy: workerId,
        lockedAt: ts,
        updatedAt: ts,
      })
      .where(
        eq(
          aiJobs.id,
          sql`(
            SELECT id FROM ai_jobs
            WHERE status='queued'
              OR (status='retry_wait' AND (next_run_at IS NULL OR next_run_at <= ${ts}))
              OR (status IN ('running','validating') AND locked_at IS NOT NULL AND locked_at <= ${staleBefore})
            ORDER BY created_at
            LIMIT 1
          )`,
        ),
      )
      .returning()
      .all();
    return rows[0] ?? null;
  }

  /** Find a job by id, or null. */
  findById(id: string): AiJob | null {
    const row = this.db.select().from(aiJobs).where(eq(aiJobs.id, id)).get();
    return row ?? null;
  }

  /** Latest non-terminal quick-session job, used so clients can resume polling after navigation. */
  findLatestActiveForQuickSession(quickSessionId: string): AiJob | null {
    const row = this.db
      .select()
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.quickSessionId, quickSessionId),
          sql`${aiJobs.status} IN ('queued','running','validating','retry_wait')`,
        ),
      )
      .orderBy(sql`${aiJobs.createdAt} DESC`)
      .limit(1)
      .get();
    return row ?? null;
  }

  /** Latest non-terminal formal-project job, used by the formal map workbench. */
  findLatestActiveForProject(projectId: string): AiJob | null {
    const row = this.db
      .select()
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.projectId, projectId),
          sql`${aiJobs.status} IN ('queued','running','validating','retry_wait')`,
        ),
      )
      .orderBy(sql`${aiJobs.createdAt} DESC`)
      .limit(1)
      .get();
    return row ?? null;
  }

  /**
   * Find a job by id only if `actor` is authorised for its scope.
   *
   * - formal_project: actor must be a user with an active membership on the
   *   job's project (any capability). The route layer enforces the specific
   *   `read` / `edit` capability; here we only assert membership so that an
   *   out-of-scope actor receives a uniform 404 (no info leak).
   * - quick_session: the actor's guest/user id must own the linked session.
   * - training_attempt: the actor's guest/user id must own the linked attempt.
   *
   * Returns null for missing jobs and for scope mismatches alike.
   */
  findByIdForActor(id: string, actor: JobActor): AiJob | null {
    const job = this.findById(id);
    if (!job) return null;

    if (job.scopeKind === 'formal_project') {
      if (actor.kind !== 'user' || !actor.userId || !job.projectId) return null;
      const member = this.db
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, job.projectId),
            eq(projectMembers.userId, actor.userId),
            eq(projectMembers.status, 'active'),
          ),
        )
        .limit(1)
        .get();
      return member ? job : null;
    }

    if (job.scopeKind === 'quick_session') {
      if (!job.quickSessionId) return null;
      const session = this.db
        .select()
        .from(quickSessions)
        .where(eq(quickSessions.id, job.quickSessionId))
        .limit(1)
        .get();
      if (!session) return null;
      if (actor.kind === 'user' && actor.userId && session.userId === actor.userId) return job;
      if (
        actor.kind === 'guest' &&
        actor.guestSessionId &&
        session.guestSessionId === actor.guestSessionId
      )
        return job;
      return null;
    }

    // training_attempt
    if (!job.trainingAttemptId) return null;
    const attempt = this.db
      .select()
      .from(trainingAttempts)
      .where(eq(trainingAttempts.id, job.trainingAttemptId))
      .limit(1)
      .get();
    if (!attempt) return null;
    if (actor.kind === 'user' && actor.userId && attempt.userId === actor.userId) return job;
    if (
      actor.kind === 'guest' &&
      actor.guestSessionId &&
      attempt.guestSessionId === actor.guestSessionId
    )
      return job;
    return null;
  }

  /**
   * Update a job's status. Stamps `updated_at` and, when transitioning into
   * `retry_wait`, schedules `next_run_at` with exponential backoff.
   */
  updateStatus(id: string, status: string, lastErrorCode?: string): AiJob | null {
    const current = this.findById(id);
    if (!current) return null;
    const ts = now();
    const patch: Partial<typeof aiJobs.$inferInsert> = {
      status,
      updatedAt: ts,
    };
    if (lastErrorCode !== undefined) patch.lastErrorCode = lastErrorCode;
    else if (!TERMINAL_STATUSES.has(status)) {
      // keep last_error_code only meaningful on terminal failure; clear on retry
    }

    if (status === 'retry_wait') {
      const attempt = current.attempts;
      const backoffSeconds = Math.min(30, 2 ** attempt);
      patch.nextRunAt = addSeconds(ts, backoffSeconds);
    }

    return this.db
      .update(aiJobs)
      .set(patch)
      .where(eq(aiJobs.id, id))
      .returning()
      .get();
  }

  /**
   * Increment the attempt counter (called by the worker before invoking).
   */
  incrementAttempts(id: string): AiJob | null {
    const current = this.findById(id);
    if (!current) return null;
    return this.db
      .update(aiJobs)
      .set({
        attempts: current.attempts + 1,
        updatedAt: now(),
      })
      .where(eq(aiJobs.id, id))
      .returning()
      .get();
  }

  /**
   * Cancel a job. Only queued / running / retry_wait jobs may be cancelled;
   * cancelling an already-terminal job throws 409. Stamps `cancelled_*`
   * columns atomically.
   */
  cancel(
    id: string,
    cancelledByKind: 'user' | 'guest' | 'system',
    cancelledByUserId?: string,
    cancelledByGuestSessionId?: string,
    reason?: string,
  ): AiJob {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('AI job not found', 'ai_job');
    }
    if (TERMINAL_STATUSES.has(current.status)) {
      throw ApiError.conflict(
        'JOB_NOT_CANCELLABLE',
        `Job in terminal status '${current.status}' cannot be cancelled`,
      );
    }
    const ts = now();
    return this.db
      .update(aiJobs)
      .set({
        status: 'cancelled',
        cancelledByKind,
        cancelledByUserId: cancelledByUserId ?? null,
        cancelledByGuestSessionId: cancelledByGuestSessionId ?? null,
        cancelledAt: ts,
        cancellationReason: reason ?? null,
        updatedAt: ts,
      })
      .where(eq(aiJobs.id, id))
      .returning()
      .get();
  }

  /**
   * Cancel all queued jobs created by the given actor.
   *
   * Used by the agreement-withdrawal hook (§3B.4): withdrawing consent blocks
   * new model calls and must cancel already-queued (unsent) jobs for that
   * actor. Jobs in `running`/`validating` are left alone (they are already
   * in flight and will complete normally); only `queued` jobs are cancelled
   * because they have not been dispatched yet.
   *
   * Returns the number of jobs cancelled.
   */
  cancelQueuedByActor(
    actorKind: 'user' | 'guest',
    actorId: string,
    reason: string = 'agreement_withdrawn',
  ): number {
    const ts = now();
    const actorCol =
      actorKind === 'user' ? aiJobs.createdByUserId : aiJobs.createdByGuestSessionId;
    const result = this.db
      .update(aiJobs)
      .set({
        status: 'cancelled',
        cancelledByKind: 'system',
        cancelledAt: ts,
        cancellationReason: reason,
        updatedAt: ts,
      })
      .where(
        and(
          eq(actorCol, actorId),
          eq(aiJobs.status, 'queued'),
        ),
      )
      .returning()
      .all();
    return result.length;
  }

  /**
   * Project a job's runtime state into a poll-friendly progress view.
   *
   * `progress` is a coarse 0-100 bucketing by status; `current_step` is a
   * human-readable label; `duration_ms` measures wall-clock since creation
   * (or until completion for terminal jobs).
   */
  getProgress(id: string): {
    progress: number;
    current_step: string;
    completed_at: string | null;
    duration_ms: number | null;
  } | null {
    const job = this.findById(id);
    if (!job) return null;

    let progress: number;
    let currentStep: string;
    switch (job.status) {
      case 'queued':
        progress = 0;
        currentStep = '排队中';
        break;
      case 'running':
        progress = 50;
        currentStep = '模型推理中';
        break;
      case 'validating':
        progress = 90;
        currentStep = '校验输出结构';
        break;
      case 'succeeded':
        progress = 100;
        currentStep = '分析完成';
        break;
      case 'failed':
        progress = 100;
        currentStep = '任务失败';
        break;
      case 'retry_wait':
        progress = 30;
        currentStep = '等待重试';
        break;
      case 'cancelled':
        progress = 100;
        currentStep = '已取消';
        break;
      case 'manual_review':
        progress = 100;
        currentStep = '待人工审核';
        break;
      default:
        progress = 0;
        currentStep = job.status;
    }

    let completedAt: string | null = null;
    if (['succeeded', 'failed', 'cancelled', 'manual_review'].includes(job.status)) {
      const run = this.db
        .select()
        .from(aiRuns)
        .where(eq(aiRuns.aiJobId, id))
        .orderBy(sql`${aiRuns.attempt} DESC`)
        .limit(1)
        .get();
      completedAt = run?.completedAt ?? job.updatedAt;
    }

    const endMs = completedAt
      ? new Date(completedAt).getTime()
      : Date.now();
    const durationMs = endMs - new Date(job.createdAt).getTime();

    return {
      progress,
      current_step: currentStep,
      completed_at: completedAt,
      duration_ms: durationMs,
    };
  }
}
