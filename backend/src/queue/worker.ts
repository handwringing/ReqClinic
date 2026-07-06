import { randomUUID } from 'node:crypto';
import type { AppDb } from '../db/client';
import type { AiProvider } from '../ai/provider';
import { validateOutput, SCHEMA_GATE_ERROR_CODE } from '../ai/schema-gates';
import { ControlledAgentOrchestrator } from '../agent/orchestrator';
import { AgentRunRepo } from '../repo/agent-run-repo';
import type { AiRunRepo } from '../repo/ai-run-repo';
import type { JobRepo } from '../repo/job-repo';
import type { AiJob } from '../db/schema/job';
import { now } from '../shared/time';
import { QuickJobExecutor } from './quick-job-executor';
import { FormalJobExecutor } from './formal-job-executor';
import { TrainingJobExecutor } from './training-job-executor';

/**
 * Persistent AI job worker (§9 / Task 20).
 *
 * Polls `ai_jobs` for queued work via `JobRepo.claimNext`, invokes the AI
 * provider, validates the output against the task's schema gate, and drives the
 * job state machine to a terminal status. Failures are retried with exponential
 * backoff up to `max_attempts` (default 3). Each attempt writes one `ai_runs`
 * audit row.
 *
 * The worker is environment-agnostic: production wires it in `server.ts`,
 * tests construct it directly and call `start()` / `stop()` or `processJob()`
 * synchronously. `start()` is idempotent; calling `stop()` clears the poll
 * interval so the event loop can drain.
 */

const SCHEMA_VERSION = '1.0.0';
const POLL_INTERVAL_MS = 500;
const INVOKE_TIMEOUT_MS = 90_000;

export interface WorkerOptions {
  pollIntervalMs?: number;
  invokeTimeoutMs?: number;
  agentRunRepo?: AgentRunRepo;
  orchestrator?: ControlledAgentOrchestrator;
  quickJobExecutor?: QuickJobExecutor;
  formalJobExecutor?: FormalJobExecutor;
  trainingJobExecutor?: TrainingJobExecutor;
}

export class JobWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly workerId = `worker-${randomUUID()}`;
  private readonly pollIntervalMs: number;
  private readonly invokeTimeoutMs: number;
  private readonly orchestrator: ControlledAgentOrchestrator;
  private readonly quickJobExecutor: QuickJobExecutor;
  private readonly formalJobExecutor: FormalJobExecutor;
  private readonly trainingJobExecutor: TrainingJobExecutor;
  private running = false;

  constructor(
    private readonly db: AppDb,
    private readonly provider: AiProvider,
    private readonly aiRunRepo: AiRunRepo,
    private readonly jobRepo: JobRepo,
    options: WorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.invokeTimeoutMs = options.invokeTimeoutMs ?? INVOKE_TIMEOUT_MS;
    this.orchestrator =
      options.orchestrator ??
      new ControlledAgentOrchestrator(
        provider,
        options.agentRunRepo ?? new AgentRunRepo(db.db),
      );
    this.quickJobExecutor =
      options.quickJobExecutor ?? new QuickJobExecutor(db, provider);
    this.formalJobExecutor =
      options.formalJobExecutor ?? new FormalJobExecutor(db, provider);
    this.trainingJobExecutor =
      options.trainingJobExecutor ?? new TrainingJobExecutor(db, provider);
  }

  /**
   * Start the polling loop. Idempotent: a second call while running is a no-op.
   */
  start(): void {
    if (this.timer) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        // Errors are swallowed so a single bad job never kills the loop; the
        // per-job error path already records last_error_code.
      });
    }, this.pollIntervalMs);
    // setInterval keeps the process alive; unref so tests can exit cleanly.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Stop the polling loop. Safe to call when not running. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** True when the poll loop is active. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Claim and process at most one queued job. Returns the processed job or null
   * when the queue was empty. Exposed so tests can drive a single iteration
   * without engaging the interval.
   */
  async tick(): Promise<AiJob | null> {
    const job = this.jobRepo.claimNext(this.workerId);
    if (!job) return null;
    await this.processJob(job);
    return job;
  }

  /**
   * Drive a single claimed job through the full state machine.
   *
   * `running → (invoke w/ timeout) → validating (schema gate) → succeeded |
   * retry_wait | failed`. Each attempt increments `attempts` and writes one
   * `ai_runs` row. When `attempts >= max_attempts` the job flips to `failed`
   * with `last_error_code` set.
   */
  async processJob(job: AiJob): Promise<void> {
    const updated = this.jobRepo.incrementAttempts(job.id);
    if (!updated) return;
    const attempt = updated.attempts;

    const payload = safeParseJson(updated.payloadJson, {});
    const domainPackVersions = extractDomainPackVersions(payload);

    const run = this.aiRunRepo.create({
      aiJobId: updated.id,
      attempt,
      provider: 'pending',
      model: 'pending',
      promptVersion: 'pending',
      schemaVersion: SCHEMA_VERSION,
      inputHash: updated.inputHash,
      status: 'running',
      domainPackVersionsJson: domainPackVersions
        ? JSON.stringify(domainPackVersions)
        : undefined,
    });

    this.jobRepo.updateStatus(updated.id, 'running');

    let invocation: ReturnType<ControlledAgentOrchestrator['start']> | null = null;
    try {
      invocation = this.orchestrator.start({
        job: updated,
        payload,
        domainPackVersions,
      });
      const result = await invokeWithTimeout(
        updated.scopeKind === 'quick_session'
          ? this.quickJobExecutor.process(updated, payload)
          : updated.scopeKind === 'formal_project' && updated.taskType === 'formal_guidance'
            ? this.formalJobExecutor.process(updated, payload)
            : updated.scopeKind === 'training_attempt' &&
                (updated.taskType === 'training_response' ||
                  updated.taskType === 'training_feedback')
              ? this.trainingJobExecutor.process(updated, payload)
              : invocation.invokeProvider(),
        this.invokeTimeoutMs,
      );

      // validating transition + schema gate
      this.jobRepo.updateStatus(updated.id, 'validating');
      const gate =
        updated.scopeKind === 'quick_session'
          ? { ok: true as const, data: result.output }
          : validateOutput(updated.taskType, result.output);

      if (!gate.ok) {
        this.aiRunRepo.updateResult(run.id, {
          status: 'failed',
          completedAt: now(),
        });
        invocation.fail(SCHEMA_GATE_ERROR_CODE);
        this.handleFailure(updated, SCHEMA_GATE_ERROR_CODE);
        return;
      }

      this.aiRunRepo.updateResult(run.id, {
        parsedOutputJson: JSON.stringify(gate.data ?? result.output),
        outputTokens: result.outputTokens,
        inputTokens: result.inputTokens,
        status: 'succeeded',
        completedAt: now(),
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        thinkingMode: result.thinkingMode ?? null,
      });

      invocation.succeed(result, gate.data ?? result.output);
      this.jobRepo.updateStatus(updated.id, 'succeeded');
    } catch (err) {
      this.aiRunRepo.updateResult(run.id, {
        status: 'failed',
        completedAt: now(),
      });
      const code = isTimeoutError(err) ? 'INVOKE_TIMEOUT' : 'INVOKE_FAILED';
      invocation?.fail(code);
      this.handleFailure(updated, code);
    }
  }

  /**
   * Apply retry/terminal semantics after a failed attempt.
   *
   * If `attempts < max_attempts`, flip to `retry_wait` (next_run_at scheduled
   * inside `updateStatus`); otherwise terminal `failed`.
   */
  private handleFailure(job: AiJob, errorCode: string): void {
    const fresh = this.jobRepo.findById(job.id);
    if (!fresh) return;
    if (fresh.attempts < fresh.maxAttempts) {
      this.jobRepo.updateStatus(job.id, 'retry_wait', errorCode);
    } else {
      this.jobRepo.updateStatus(job.id, 'failed', errorCode);
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safeParseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function extractDomainPackVersions(payload: unknown): Record<string, string> | undefined {
  if (payload && typeof payload === 'object') {
    const v = (payload as Record<string, unknown>).domain_pack_versions;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, string>;
    }
  }
  return undefined;
}

class TimeoutError extends Error {
  readonly isTimeout = true;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof TimeoutError || (err as { isTimeout?: boolean })?.isTimeout === true;
}

function invokeWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`invoke exceeded ${ms}ms`));
    }, ms);
    if (typeof (timer as NodeJS.Timeout).unref === 'function') {
      (timer as NodeJS.Timeout).unref();
    }
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
