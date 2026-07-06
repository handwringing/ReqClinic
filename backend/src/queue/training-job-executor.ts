import { eq, asc } from 'drizzle-orm';

import type { AppDb } from '../db/client';
import type { AiInvokeResult, AiProvider, SkillInvocationAudit } from '../ai/provider';
import type { AiJob } from '../db/schema/job';
import {
  trainingQuestions,
  type TrainingQuestion,
} from '../db/schema/training';
import { env } from '../config/env';
import { TrainingPracticeRuntime } from '../agent/training-runtime';
import type {
  TrainingFeedbackOutput,
  TrainingResponseOutput,
  TrainingRuntimeInput,
  TrainingRuntimeResult,
  TrainingTurn,
} from '../agent/training-runtime';
import { TrainingRepo } from '../repo/training-repo';
import {
  ALL_TRAINING_SKILLS,
  TRAINING_COMPOSITION_FEEDBACK_REPORT,
  TRAINING_ROLEPLAY_ANSWER,
} from '../agent/skills';
import type { SkillManifest } from '../agent/types';

/**
 * Expression-training job executor (08 plan §5.3, Task 1.3).
 *
 * Bridges {@link JobWorker} and {@link TrainingPracticeRuntime}: takes a
 * `scope_kind='training_attempt'` job, builds the runtime input from the
 * attempt's case manifest + prior turns, runs the runtime, persists the
 * results (disclosure-rule hit on training_questions, feedback row), and
 * returns an {@link AiInvokeResult} including per-skill audit projections.
 *
 * The executor never writes `agent_runs` / `skill_runs` directly — the
 * controlled orchestrator's `invocation.succeed()` does that based on the
 * returned `skillAudits`. This mirrors the Formal/Quick executors.
 *
 * Training data is strictly isolated: only `training_questions` and
 * `training_feedback` are touched; no quick / formal / project tables.
 */
export class TrainingJobExecutor {
  private readonly runtime: TrainingPracticeRuntime;
  private readonly trainingRepo: TrainingRepo;
  private readonly db: AppDb;

  constructor(
    db: AppDb,
    private readonly provider: AiProvider,
  ) {
    this.trainingRepo = new TrainingRepo(db.db);
    this.runtime = new TrainingPracticeRuntime(provider, this.trainingRepo);
    this.db = db;
  }

  async process(job: AiJob, payload: unknown): Promise<AiInvokeResult> {
    if (!job.trainingAttemptId) {
      throw new Error(`Training job ${job.id} has no training_attempt_id`);
    }
    const attempt = this.trainingRepo.findById(job.trainingAttemptId);
    if (!attempt) {
      throw new Error(`Training attempt not found for job ${job.id}`);
    }

    const caseSnapshot = this.trainingRepo.getCasePrivateManifest(
      attempt.caseId,
      attempt.caseVersion,
    );
    if (!caseSnapshot) {
      throw new Error(
        `Training case private manifest not found: ${attempt.caseId}@${attempt.caseVersion}`,
      );
    }
    const visibleCaseBrief = this.trainingRepo.getCaseVersionPublic(
      attempt.caseId,
      attempt.caseVersion,
    );
    if (!visibleCaseBrief) {
      throw new Error(
        `Training case public brief not found: ${attempt.caseId}@${attempt.caseVersion}`,
      );
    }

    const payloadObj =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};

    const priorTurns = this.loadPriorTurns(attempt.id, job.taskType, payloadObj);
    const modelEnabled = env.AI_PROVIDER !== 'stub';

    const input = this.buildRuntimeInput(
      job,
      attempt.id,
      caseSnapshot,
      visibleCaseBrief,
      priorTurns,
      payloadObj,
      modelEnabled,
    );

    const result = await this.runtime.run(input);

    // Persist runtime side-effects per task_type.
    this.persistResult(job, attempt.id, result);

    return {
      output: result.output,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      thinkingMode: result.thinkingMode,
      usageEstimated: result.usageEstimated,
      skillAudits: toSkillInvocationAudits(result),
    };
  }

  // ── runtime input construction ───────────────────────────────────────────

  private buildRuntimeInput(
    job: AiJob,
    attemptId: string,
    caseSnapshot: TrainingRuntimeInput['caseSnapshot'],
    visibleCaseBrief: TrainingRuntimeInput['visibleCaseBrief'],
    priorTurns: TrainingTurn[],
    payload: Record<string, unknown>,
    modelEnabled: boolean,
  ): TrainingRuntimeInput {
    if (job.taskType === 'training_response') {
      const currentQuestion =
        typeof payload.question === 'string' ? payload.question : '';
      return {
        attemptId,
        caseSnapshot,
        visibleCaseBrief,
        priorTurns,
        currentQuestion,
        taskType: 'training_response',
        modelEnabled,
      };
    }
    if (job.taskType === 'training_feedback') {
      const submittedSummary =
        typeof payload.summary === 'string' ? payload.summary : '';
      return {
        attemptId,
        caseSnapshot,
        visibleCaseBrief,
        priorTurns,
        submittedSummary,
        taskType: 'training_feedback',
        modelEnabled,
      };
    }
    throw new Error(
      `Training job ${job.id} has unsupported task_type: ${job.taskType}`,
    );
  }

  // ── prior-turns reconstruction ───────────────────────────────────────────

  /**
   * Reconstruct prior turns for the runtime prompt context.
   *
   * The training runtime now uses `training_turns` for safe recovery of this
   * practice conversation. It remains isolated from quick/formal/project data.
   *
   * For `training_feedback` jobs, all questions on the attempt are prior
   * turns (the summary covers the whole interview). For `training_response`
   * jobs, the latest question is the current question (passed separately
   * via `currentQuestion`), so we exclude it from prior turns.
   */
  private loadPriorTurns(
    attemptId: string,
    taskType: string,
    payload: Record<string, unknown>,
  ): TrainingTurn[] {
    const turns = this.trainingRepo.listTurns(attemptId).map((turn) => ({
      role: turn.role === 'user' ? 'user' as const : turn.role === 'coach' ? 'coach' as const : 'role' as const,
      content: turn.content,
    }));

    if (taskType !== 'training_response') return turns;

    const currentQuestion =
      typeof payload.question === 'string' ? payload.question.trim() : '';
    if (!currentQuestion) return turns;

    const currentIndex = findLastUserTurnIndex(turns, currentQuestion);
    if (currentIndex < 0) return turns;
    return turns.filter((_, index) => index !== currentIndex);
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private persistResult(
    job: AiJob,
    attemptId: string,
    result: TrainingRuntimeResult,
  ): void {
    if (result.output.result_type === 'training_response') {
      this.persistResponse(job, attemptId, result.output);
      return;
    }
    if (result.output.result_type === 'training_feedback') {
      this.persistFeedback(attemptId, result.output);
    }
  }

  /**
   * Update `training_questions.disclosure_rule_hit` on the latest question row
   * for this attempt. Skill `training.roleplay.answer` is whitelisted to
   * write this column (see `TRAINING_ALLOWED_WRITE_TARGETS`); the executor
   * performs the write on the runtime's behalf since the runtime stays
   * stateless.
   */
  private persistResponse(
    job: AiJob,
    attemptId: string,
    output: TrainingResponseOutput,
  ): void {
    const latestQuestion = this.findLatestQuestion(attemptId);
    if (!latestQuestion) return;

    // Persist the first disclosed rule id (the schema stores a single text
    // column, not an array). Empty list → null.
    const hit =
      output.role_answer.disclosed_rule_ids.length > 0
        ? output.role_answer.disclosed_rule_ids[0]
        : null;

    this.db.db
      .update(trainingQuestions)
      .set({ disclosureRuleHit: hit })
      .where(eq(trainingQuestions.id, latestQuestion.id))
      .run();

    this.trainingRepo.recordTurn({
      attemptId,
      role: 'role',
      content: output.role_answer.content,
      coachProjection: output.coach_projection,
      aiJobId: job.id,
    });
  }

  /**
   * Persist feedback output to `training_feedback` via the repo (which also
   * transitions the attempt to `feedback_ready`). Skill
   * `training.composition.feedback_report` is whitelisted to write this table.
   */
  private persistFeedback(
    attemptId: string,
    output: TrainingFeedbackOutput,
  ): void {
    const max = output.score.max > 0 ? output.score.max : 100;
    const coverageScoreBp = Math.min(
      10000,
      Math.max(0, Math.round((output.score.total / max) * 10000)),
    );
    const missingDimensionCount = output.dimensions.filter(
      (d) => d.score === 0,
    ).length;

    this.trainingRepo.recordFeedback({
      attemptId,
      coverageScoreBp,
      missingDimensionCount,
      feedbackJson: JSON.stringify(output),
      dimensionBreakdownJson: JSON.stringify(output.dimensions),
      improvementExamplesJson: JSON.stringify(output.improvement_examples),
    });
  }

  private findLatestQuestion(attemptId: string): TrainingQuestion | null {
    const row = this.db.db
      .select()
      .from(trainingQuestions)
      .where(eq(trainingQuestions.attemptId, attemptId))
      .orderBy(asc(trainingQuestions.questionIndex))
      .all()
      .at(-1);
    return row ?? null;
  }
}

function findLastUserTurnIndex(turns: TrainingTurn[], content: string): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'user' && turn.content.trim() === content) return index;
  }
  return -1;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const TRAINING_SKILL_MANIFESTS_BY_ID: Map<string, SkillManifest> = new Map(
  ALL_TRAINING_SKILLS.map((m) => [m.skillId, m]),
);

/**
 * Convert the runtime's compact {@link TrainingRuntimeResult.skillAudits}
 * shape to the full {@link SkillInvocationAudit} the orchestrator expects.
 *
 * The runtime returns `{ skillId, skillVersion, durationMs, success }` per
 * skill; the orchestrator's `succeed()` only consumes `provider / model /
 * thinkingMode / inputTokens / outputTokens / usageEstimated` from each
 * audit (falling back to `null` / the run-level model). We project the
 * run-level provider/model/tokens into each skill audit so the `skill_runs`
 * rows record the same provider and model as the parent `ai_run`, and pull
 * the schema / prompt versions from the skill manifest registry.
 */
function toSkillInvocationAudits(
  result: TrainingRuntimeResult,
): SkillInvocationAudit[] {
  const tokenOwnerSkillId =
    result.output.result_type === 'training_response'
      ? TRAINING_ROLEPLAY_ANSWER.skillId
      : TRAINING_COMPOSITION_FEEDBACK_REPORT.skillId;
  return result.skillAudits.map((audit) => {
    const manifest = TRAINING_SKILL_MANIFESTS_BY_ID.get(audit.skillId);
    const ownsModelCall = audit.skillId === tokenOwnerSkillId;
    return {
      skillId: audit.skillId,
      skillVersion: audit.skillVersion,
      inputSchemaVersion: manifest?.inputSchemaVersion ?? '1.0.0',
      outputSchemaVersion: manifest?.outputSchemaVersion ?? '1.0.0',
      promptVersion: manifest?.promptVersion ?? result.promptVersion,
      provider: result.provider,
      model: result.model,
      thinkingMode: result.thinkingMode,
      inputTokens: ownsModelCall ? result.inputTokens : 0,
      outputTokens: ownsModelCall ? result.outputTokens : 0,
      usageEstimated: result.usageEstimated,
    };
  });
}
