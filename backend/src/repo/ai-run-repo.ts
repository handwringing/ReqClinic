import { eq, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { aiRuns, type AiRun } from '../db/schema/job';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

/**
 * Repository for the `ai_runs` table (§9).
 *
 * Each AI job attempt writes exactly one ai_run row: created when the worker
 * claims the job, then updated with the parsed output, token usage and final
 * status once invoke + schema-gate complete. `(ai_job_id, attempt)` is unique.
 */

export interface CreateAiRunInput {
  aiJobId: string;
  attempt: number;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  inputHash: string;
  status: string;
  domainPackVersionsJson?: string;
}

export interface UpdateAiRunResultInput {
  parsedOutputJson?: string;
  outputTokens?: number;
  inputTokens?: number;
  status: string;
  completedAt?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  thinkingMode?: string | null;
}

export class AiRunRepo {
  constructor(private db: DrizzleDB) {}

  /** Insert a fresh ai_run row for a job attempt. */
  create(input: CreateAiRunInput): AiRun {
    const ts = now();
    const row = this.db
      .insert(aiRuns)
      .values({
        id: generateId('run'),
        aiJobId: input.aiJobId,
        attempt: input.attempt,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        inputHash: input.inputHash,
        status: input.status,
        startedAt: ts,
        domainPackVersionsJson: input.domainPackVersionsJson ?? null,
        rawAuditClass: 'final_output',
      })
      .returning()
      .get();
    return row;
  }

  /** Stamp the result side of an ai_run after invoke + gate complete. */
  updateResult(id: string, input: UpdateAiRunResultInput): AiRun {
    const patch: Partial<typeof aiRuns.$inferInsert> = {
      status: input.status,
    };
    if (input.parsedOutputJson !== undefined) patch.parsedOutputJson = input.parsedOutputJson;
    if (input.outputTokens !== undefined) patch.outputTokens = input.outputTokens;
    if (input.inputTokens !== undefined) patch.inputTokens = input.inputTokens;
    if (input.completedAt !== undefined) patch.completedAt = input.completedAt;
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.model !== undefined) patch.model = input.model;
    if (input.promptVersion !== undefined) patch.promptVersion = input.promptVersion;
    if (input.thinkingMode !== undefined) patch.thinkingMode = input.thinkingMode;

    return this.db
      .update(aiRuns)
      .set(patch)
      .where(eq(aiRuns.id, id))
      .returning()
      .get();
  }

  /** Find a run by id, or null. */
  findById(id: string): AiRun | null {
    const row = this.db
      .select()
      .from(aiRuns)
      .where(eq(aiRuns.id, id))
      .get();
    return row ?? null;
  }

  /** Return the latest ai_run for a job (highest attempt), or null. */
  findLatestByJob(aiJobId: string): AiRun | null {
    const row = this.db
      .select()
      .from(aiRuns)
      .where(eq(aiRuns.aiJobId, aiJobId))
      .orderBy(desc(aiRuns.attempt))
      .limit(1)
      .get();
    return row ?? null;
  }
}
