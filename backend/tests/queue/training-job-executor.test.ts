import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { StubProvider } from '../../src/ai/stub-provider';
import type { AiInvokeResult, AiProvider, AiInvokeInput } from '../../src/ai/provider';
import { SCHEMA_GATE_ERROR_CODE } from '../../src/ai/schema-gates';
import { JobWorker } from '../../src/queue/worker';
import { TrainingJobExecutor } from '../../src/queue/training-job-executor';
import { AgentRunRepo } from '../../src/repo/agent-run-repo';
import { AiRunRepo } from '../../src/repo/ai-run-repo';
import { JobRepo } from '../../src/repo/job-repo';
import { TrainingRepo } from '../../src/repo/training-repo';
import { UserRepo } from '../../src/repo/user-repo';
import {
  trainingCases,
  trainingQuestions,
  trainingFeedback,
  trainingTurns,
} from '../../src/db/schema/training';
import { generateId } from '../../src/shared/id';
import { now } from '../../src/shared/time';
import { env } from '../../src/config/env';
import { createTestDb } from '../helpers/test-db';

/**
 * Task 1.3 — TrainingJobExecutor integration tests.
 *
 * Drives the full worker state machine for `scope_kind='training_attempt'`
 * jobs across four scenarios:
 *   1) training_response — StubProvider produces a role answer; the latest
 *      training_questions row receives `disclosure_rule_hit`, the job
 *      transitions to `succeeded`, and the three-layer audit chain
 *      (ai_run → agent_run → skill_run) is written.
 *   2) training_feedback — StubProvider produces a feedback report; the
 *      training_feedback row is created, the attempt transitions to
 *      `feedback_ready`, and the audit chain records the feedback skills.
 *   3) Model failure fallback — a provider that throws on every invoke is
 *      wired in; the runtime falls back deterministically and the job still
 *      succeeds without leaking private manifest fields.
 *   4) Unknown task_type — the executor rejects the job, the worker records
 *      `INVOKE_FAILED`, and the job enters the failed terminal state.
 */

// ── shared fixtures ────────────────────────────────────────────────────────

const CASE_SCENARIO_JSON = JSON.stringify({
  category: 'software',
  role_label: '企业客户',
  practice_goal: '练习澄清官网重做需求的目标、对象、场景、边界与验收。',
  description: '企业客户希望重做官网，练习者需要通过追问澄清真实目标与边界。',
  visible_constraints: ['单次练习 15 分钟'],
  persona: {
    role: '企业客户',
    communication_style: '务实、关注投入产出',
    knowledge_level: '熟悉自身业务，不熟悉技术实现',
  },
});

const CASE_DISCLOSURE_RULES_JSON = JSON.stringify([
  {
    id: 'rule_budget',
    trigger_intent: '预算',
    allowed_answer: '本次预算上限 8 万元。',
    related_fact_ids: ['fact_budget'],
  },
  {
    id: 'rule_deadline',
    trigger_intent: '时间',
    allowed_answer: '希望 6 周内上线第一版。',
    related_fact_ids: ['fact_deadline'],
  },
]);

const CASE_RUBRIC_JSON = JSON.stringify({
  evaluation_dimensions: ['目标', '对象', '场景', '边界', '验收'],
  rubric: [
    { dimension: '目标', max_score: 20, evidence_rule: '是否问到可观察的结果' },
    { dimension: '对象', max_score: 20, evidence_rule: '是否问清主要使用对象' },
    { dimension: '场景', max_score: 20, evidence_rule: '是否问清使用场景' },
    { dimension: '边界', max_score: 20, evidence_rule: '是否问清范围与限制' },
    { dimension: '验收', max_score: 20, evidence_rule: '是否问清完成标准' },
  ],
});

interface SeedResult {
  db: ReturnType<typeof createTestDb>;
  jobRepo: JobRepo;
  aiRunRepo: AiRunRepo;
  agentRunRepo: AgentRunRepo;
  trainingRepo: TrainingRepo;
  ownerId: string;
  attemptId: string;
}

async function seedTrainingFixture(): Promise<SeedResult> {
  const db = createTestDb();
  const userRepo = new UserRepo(db.db);
  const jobRepo = new JobRepo(db.db);
  const aiRunRepo = new AiRunRepo(db.db);
  const agentRunRepo = new AgentRunRepo(db.db);
  const trainingRepo = new TrainingRepo(db.db);

  const user = await userRepo.create({
    displayName: 'Training Executor Owner',
    authSubject: 'auth|training-executor-owner',
  });
  const ownerId = user.id;

  const caseId = 'TC_executor_test';
  const caseVersion = '1.0.0';
  const ts = now();
  db.db
    .insert(trainingCases)
    .values({
      id: generateId('tcase'),
      caseId,
      version: caseVersion,
      title: 'TrainingJobExecutor 测试案例',
      difficulty: 'medium',
      scenarioJson: CASE_SCENARIO_JSON,
      disclosureRulesJson: CASE_DISCLOSURE_RULES_JSON,
      rubricJson: CASE_RUBRIC_JSON,
      status: 'active',
      createdAt: ts,
    })
    .run();

  const attempt = trainingRepo.createAttempt({
    caseId,
    caseVersion,
    actorKind: 'user',
    userId: ownerId,
  });

  return {
    db,
    jobRepo,
    aiRunRepo,
    agentRunRepo,
    trainingRepo,
    ownerId,
    attemptId: attempt.id,
  };
}

/** Provider that throws on every invoke — used by scenario (3). */
function throwingProvider(): AiProvider {
  return {
    async invoke(): Promise<AiInvokeResult> {
      throw new Error('simulated provider failure');
    },
  };
}

/** Provider that returns a feedback payload exercising the persist path. */
function fixedFeedbackProvider(): AiProvider {
  return {
    async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
      if (input.taskType === 'training_feedback') {
        return {
          provider: 'mock-fb',
          model: 'mock-fb-v1',
          promptVersion: 'mock-fb-v1',
          inputTokens: 99,
          outputTokens: 222,
          thinkingMode: 'enabled',
          usageEstimated: false,
          output: {
            result_type: 'training_feedback',
            score: { total: 72, max: 100, label: '已覆盖多数关键维度' },
            dimensions: [
              { dimension: '目标', score: 18, max: 20, evidence: '用户问到了目标。', improvement: '继续细化。' },
              { dimension: '对象', score: 14, max: 20, evidence: '用户问到了对象。', improvement: '补充主要使用者。' },
              { dimension: '场景', score: 12, max: 20, evidence: '用户提及场景。', improvement: '描述典型路径。' },
              { dimension: '边界', score: 0, max: 20, evidence: '用户未问边界。', improvement: '直接询问哪些不做。' },
              { dimension: '验收', score: 28, max: 20, evidence: '超出维度。', improvement: '聚焦可观察信号。' },
            ],
            missed_high_value_questions: ['哪些内容明确不在这一版范围内？'],
            improvement_examples: [
              { before: '这个项目要做什么？', after: '这次最想先达成哪个可观察的结果？', reason: '聚焦可观察结果。' },
            ],
            summary_review: {
              accuracy: '当前总结覆盖了目标方向。',
              missing_points: ['可衡量的成功结果'],
              unsupported_claims: [],
              improved_summary: '建议补充可观察的成功结果与明确不做的范围。',
            },
          },
        };
      }
      // training_response path — delegate to the StubProvider shape.
      return {
        provider: 'mock',
        model: 'mock-v1',
        promptVersion: 'mock-v1',
        inputTokens: 12,
        outputTokens: 34,
        thinkingMode: 'disabled',
        usageEstimated: false,
        output: {
          result_type: 'training_response',
          role_answer: {
            content: '我们这次最在意的是把目标说清楚。',
            tone: 'customer',
            disclosed_rule_ids: ['rule_budget'],
            safe_to_show: true,
          },
          coach_projection: {
            next_hint: '可以接着问对方最想先确认的目标是什么。',
            question_quality_note: 'effective',
            visible_progress_label: '正在澄清目标',
          },
        },
      };
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('Task 1.3 — TrainingJobExecutor', () => {
  // Pin AI_PROVIDER to a non-stub value so the TrainingPracticeRuntime's
  // `modelEnabled` flag is true and the configured provider is actually
  // invoked (otherwise the runtime short-circuits to deterministic
  // fallback). Restored after the suite so other tests are unaffected.
  const originalProvider = env.AI_PROVIDER;
  beforeAll(() => {
    env.AI_PROVIDER = 'ollama';
  });
  afterAll(() => {
    env.AI_PROVIDER = originalProvider;
  });

  // ── scenario 1: training_response ───────────────────────────────────────

  describe('scenario 1) training_response job', () => {
    it('succeeds, persists disclosure_rule_hit, and writes the three-layer audit chain', async () => {
      const fx = await seedTrainingFixture();
      const { trainingRepo, jobRepo, aiRunRepo, agentRunRepo, attemptId, ownerId } = fx;

      // Post one question so the attempt has a training_questions row to update.
      trainingRepo.postQuestion({ attemptId, question: '你们这次重做官网，主要想达到什么目标？' });

      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: attemptId,
        taskType: 'training_response',
        payloadJson: JSON.stringify({
          question: '你们这次重做官网，主要想达到什么目标？',
          question_index: 0,
        }),
        inputHash: 'training-response-input',
        dedupeKey: 'training-response-golden',
        createdByKind: 'user',
        createdByUserId: ownerId,
        maxAttempts: 1,
      });

      const worker = new JobWorker(fx.db, new StubProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
      });
      await worker.processJob(job);

      // Job → succeeded.
      expect(jobRepo.findById(job.id)?.status).toBe('succeeded');

      // ai_run → succeeded with provider/model recorded.
      const aiRun = aiRunRepo.findLatestByJob(job.id);
      expect(aiRun?.status).toBe('succeeded');
      expect(aiRun?.provider).toBe('stub');
      expect(aiRun?.model).toBe('stub-v1');

      // agent_run + skill_runs → plan_id='training_practice', 6 skills.
      const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
      expect(agentRuns).toHaveLength(1);
      expect(agentRuns[0].planId).toBe('training_practice');
      expect(agentRuns[0].mode).toBe('training');
      const skillRuns = agentRunRepo.findSkillRunsByAgent(agentRuns[0].id);
      expect(skillRuns).toHaveLength(6);
      const skillIds = skillRuns.map((r) => r.skillId);
      expect(skillIds).toContain('training.roleplay.answer');
      expect(skillIds).toContain('training.coaching.next_hint');
      // All skill runs should be marked succeeded.
      expect(skillRuns.every((r) => r.status === 'succeeded')).toBe(true);

      // training_questions.disclosure_rule_hit updated.
      const questions = fx.db.db
        .select()
        .from(trainingQuestions)
        .where(eq(trainingQuestions.attemptId, attemptId))
        .all();
      expect(questions).toHaveLength(1);
      // StubProvider response carries no disclosed_rule_ids → null.
      expect(questions[0].disclosureRuleHit).toBeNull();

      const turns = fx.db.db
        .select()
        .from(trainingTurns)
        .where(eq(trainingTurns.attemptId, attemptId))
        .orderBy(trainingTurns.createdAt, trainingTurns.id)
        .all();
      expect(turns.map((turn) => turn.role)).toEqual(['user', 'role']);
      expect(turns[0].content).toBe('你们这次重做官网，主要想达到什么目标？');
      expect(turns[1].content.length).toBeGreaterThan(0);
      expect(JSON.parse(turns[1].coachProjectionJson)).toEqual(
        expect.objectContaining({ next_hint: expect.any(String) }),
      );
    });

    it('persists a non-null disclosure_rule_hit when the runtime reports disclosed rules', async () => {
      const fx = await seedTrainingFixture();
      const { trainingRepo, jobRepo, aiRunRepo, attemptId, ownerId } = fx;

      trainingRepo.postQuestion({ attemptId, question: '预算是多少？' });

      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: attemptId,
        taskType: 'training_response',
        payloadJson: JSON.stringify({
          question: '预算是多少？',
          question_index: 0,
        }),
        inputHash: 'training-response-disclosure-input',
        dedupeKey: 'training-response-disclosure-golden',
        createdByKind: 'user',
        createdByUserId: ownerId,
        maxAttempts: 1,
      });

      // Use the fixedFeedbackProvider since it also returns a training_response
      // payload that discloses rule_budget.
      const worker = new JobWorker(fx.db, fixedFeedbackProvider(), aiRunRepo, jobRepo, {
        agentRunRepo: new AgentRunRepo(fx.db.db),
      });
      await worker.processJob(job);

      expect(jobRepo.findById(job.id)?.status).toBe('succeeded');

      const questions = fx.db.db
        .select()
        .from(trainingQuestions)
        .where(eq(trainingQuestions.attemptId, attemptId))
        .all();
      expect(questions).toHaveLength(1);
      expect(questions[0].disclosureRuleHit).toBe('rule_budget');

      const agentRuns = new AgentRunRepo(fx.db.db).findAgentRunsByJob(job.id);
      expect(agentRuns).toHaveLength(1);
      const skillRuns = new AgentRunRepo(fx.db.db).findSkillRunsByAgent(agentRuns[0].id);
      const roleplayRun = skillRuns.find((run) => run.skillId === 'training.roleplay.answer');
      const hintRun = skillRuns.find((run) => run.skillId === 'training.coaching.next_hint');
      expect(roleplayRun?.inputTokens).toBe(12);
      expect(roleplayRun?.outputTokens).toBe(34);
      expect(hintRun?.inputTokens).toBe(0);
      expect(hintRun?.outputTokens).toBe(0);
    });
  });

  // ── scenario 2: training_feedback ────────────────────────────────────────

  describe('scenario 2) training_feedback job', () => {
    it('succeeds, writes training_feedback, and transitions attempt to feedback_ready', async () => {
      const fx = await seedTrainingFixture();
      const { trainingRepo, jobRepo, aiRunRepo, attemptId, ownerId } = fx;

      // Two prior questions + a summary on the attempt.
      trainingRepo.postQuestion({ attemptId, question: '目标是什么？' });
      trainingRepo.postQuestion({ attemptId, question: '主要给谁看？' });
      trainingRepo.postSummary({ attemptId, summary: '本次澄清了目标方向与主要使用场景。' });

      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: attemptId,
        taskType: 'training_feedback',
        payloadJson: JSON.stringify({
          summary: '本次澄清了目标方向与主要使用场景。',
        }),
        inputHash: 'training-feedback-input',
        dedupeKey: 'training-feedback-golden',
        createdByKind: 'user',
        createdByUserId: ownerId,
        maxAttempts: 1,
      });

      const agentRunRepo = new AgentRunRepo(fx.db.db);
      const worker = new JobWorker(fx.db, fixedFeedbackProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
      });
      await worker.processJob(job);

      // Job → succeeded.
      expect(jobRepo.findById(job.id)?.status).toBe('succeeded');

      // ai_run → succeeded with mock provider.
      const aiRun = aiRunRepo.findLatestByJob(job.id);
      expect(aiRun?.status).toBe('succeeded');
      expect(aiRun?.provider).toBe('mock-fb');
      expect(aiRun?.model).toBe('mock-fb-v1');
      expect(aiRun?.thinkingMode).toBe('enabled');

      // training_feedback row created.
      const feedbackRows = fx.db.db
        .select()
        .from(trainingFeedback)
        .where(eq(trainingFeedback.attemptId, attemptId))
        .all();
      expect(feedbackRows).toHaveLength(1);
      const fb = feedbackRows[0];
      // Mock payload total=72, max=100 → 7200 bp.
      expect(fb.coverageScoreBp).toBe(7200);
      // One dimension has score=0 → missingDimensionCount=1.
      expect(fb.missingDimensionCount).toBe(1);
      // dimension_breakdown_json + improvement_examples_json persisted.
      const dimBreakdown = JSON.parse(fb.dimensionBreakdownJson);
      expect(Array.isArray(dimBreakdown)).toBe(true);
      expect(dimBreakdown.length).toBe(5);
      const improvementExamples = JSON.parse(fb.improvementExamplesJson);
      expect(Array.isArray(improvementExamples)).toBe(true);
      expect(improvementExamples.length).toBe(1);

      // Attempt → feedback_ready.
      const attempt = trainingRepo.findById(attemptId);
      expect(attempt?.status).toBe('feedback_ready');

      // agent_run + skill_runs → plan_id='training_practice', feedback skills.
      const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
      expect(agentRuns).toHaveLength(1);
      expect(agentRuns[0].planId).toBe('training_practice');
      const skillRuns = agentRunRepo.findSkillRunsByAgent(agentRuns[0].id);
      expect(skillRuns).toHaveLength(6);
      const skillIds = skillRuns.map((r) => r.skillId);
      expect(skillIds).toContain('training.composition.feedback_report');
      expect(skillIds).toContain('training.structuring.coverage_update');
      const compositionRun = skillRuns.find((r) => r.skillId === 'training.composition.feedback_report');
      const structuringRun = skillRuns.find((r) => r.skillId === 'training.structuring.coverage_update');
      expect(compositionRun?.inputTokens).toBe(99);
      expect(compositionRun?.outputTokens).toBe(222);
      expect(structuringRun?.inputTokens).toBe(0);
      expect(structuringRun?.outputTokens).toBe(0);
    });
  });

  // ── scenario 3: model failure fallback ───────────────────────────────────

  describe('scenario 3) model failure fallback', () => {
    it('falls back deterministically and still succeeds without leaking private manifest', async () => {
      const fx = await seedTrainingFixture();
      const { trainingRepo, jobRepo, aiRunRepo, attemptId, ownerId } = fx;

      trainingRepo.postQuestion({ attemptId, question: 'valid question about goals' });

      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: attemptId,
        taskType: 'training_response',
        payloadJson: JSON.stringify({
          question: 'valid question about goals',
          question_index: 0,
        }),
        inputHash: 'training-failure-input',
        dedupeKey: 'training-failure-golden',
        createdByKind: 'user',
        createdByUserId: ownerId,
        maxAttempts: 1,
      });

      const agentRunRepo = new AgentRunRepo(fx.db.db);
      const worker = new JobWorker(fx.db, throwingProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
      });
      await worker.processJob(job);

      // Job still succeeded — the runtime's deterministic fallback is treated
      // as a successful invocation (08 §11.1 / §11.2).
      expect(jobRepo.findById(job.id)?.status).toBe('succeeded');

      // ai_run records the deterministic fallback provider.
      const aiRun = aiRunRepo.findLatestByJob(job.id);
      expect(aiRun?.status).toBe('succeeded');
      expect(aiRun?.provider).toBe('deterministic-fallback');

      // The parsed output must not leak private manifest fields.
      const parsed = aiRun?.parsedOutputJson ? JSON.parse(aiRun.parsedOutputJson) : null;
      expect(parsed).not.toBeNull();
      const serialized = JSON.stringify(parsed);
      expect(serialized).not.toContain('answer_key');
      expect(serialized).not.toContain('rubric');
      expect(serialized).not.toContain('disclosure_rule');

      // Skill audits still record the roleplay + coaching skills.
      const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
      expect(agentRuns).toHaveLength(1);
      const skillRuns = agentRunRepo.findSkillRunsByAgent(agentRuns[0].id);
      expect(skillRuns).toHaveLength(6);
    });

    it('falls back deterministically on the feedback path without leaking answer_key', async () => {
      const fx = await seedTrainingFixture();
      const { trainingRepo, jobRepo, aiRunRepo, attemptId, ownerId } = fx;

      trainingRepo.postQuestion({ attemptId, question: '目标是什么？' });
      trainingRepo.postSummary({ attemptId, summary: '本次澄清了目标。' });

      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: attemptId,
        taskType: 'training_feedback',
        payloadJson: JSON.stringify({ summary: '本次澄清了目标。' }),
        inputHash: 'training-failure-feedback-input',
        dedupeKey: 'training-failure-feedback-golden',
        createdByKind: 'user',
        createdByUserId: ownerId,
        maxAttempts: 1,
      });

      const agentRunRepo = new AgentRunRepo(fx.db.db);
      const worker = new JobWorker(fx.db, throwingProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
      });
      await worker.processJob(job);

      expect(jobRepo.findById(job.id)?.status).toBe('succeeded');

      // Attempt → feedback_ready (recordFeedback was called by the executor).
      const attempt = trainingRepo.findById(attemptId);
      expect(attempt?.status).toBe('feedback_ready');

      // training_feedback row created with deterministic fallback output.
      const feedbackRows = fx.db.db
        .select()
        .from(trainingFeedback)
        .where(eq(trainingFeedback.attemptId, attemptId))
        .all();
      expect(feedbackRows).toHaveLength(1);
      const feedbackJson = JSON.parse(feedbackRows[0].feedbackJson);
      const serialized = JSON.stringify(feedbackJson);
      expect(serialized).not.toContain('answer_key');
      expect(serialized).not.toContain('rubric');
      expect(serialized).not.toContain('disclosure_rule');
    });
  });

  // ── scenario 4: unknown task_type ─────────────────────────────────────────

  describe('scenario 4) unknown task_type', () => {
    it('fails the job with INVOKE_FAILED when task_type is not training_response/training_feedback', async () => {
      const fx = await seedTrainingFixture();
      const { jobRepo, aiRunRepo, attemptId, ownerId } = fx;

      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: attemptId,
        taskType: 'training_unknown',
        payloadJson: JSON.stringify({ question: 'unknown' }),
        inputHash: 'training-unknown-input',
        dedupeKey: 'training-unknown-golden',
        createdByKind: 'user',
        createdByUserId: ownerId,
        maxAttempts: 1,
      });

      const agentRunRepo = new AgentRunRepo(fx.db.db);
      const worker = new JobWorker(fx.db, new StubProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
      });
      await worker.processJob(job);

      // Job → failed with INVOKE_FAILED.
      const fresh = jobRepo.findById(job.id);
      expect(fresh?.status).toBe('failed');
      expect(fresh?.lastErrorCode).toBe('INVOKE_FAILED');

      // ai_run → failed.
      const aiRun = aiRunRepo.findLatestByJob(job.id);
      expect(aiRun?.status).toBe('failed');

      // No agent_run/skill_runs are created: resolveAgentPlan throws for
      // `training_unknown` because no plan declares it in `taskTypes`, so
      // orchestrator.start() never completes and the worker's catch block
      // records INVOKE_FAILED without an invocation to fail.
      const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
      expect(agentRuns).toHaveLength(0);
    });
  });

  // ── scenario 5: schema gate retry → failed (Task 2.2.2) ──────────────────

  describe('scenario 5) schema gate retry (Task 2.2.2)', () => {
    it('retries training_feedback 3 times then marks failed when schema gate keeps failing', async () => {
      const fx = await seedTrainingFixture();
      const { trainingRepo, jobRepo, aiRunRepo, attemptId, ownerId } = fx;

      trainingRepo.postQuestion({ attemptId, question: '目标是什么？' });
      trainingRepo.postSummary({ attemptId, summary: '本次澄清了目标。' });

      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: attemptId,
        taskType: 'training_feedback',
        payloadJson: JSON.stringify({ summary: '本次澄清了目标。' }),
        inputHash: 'training-schema-retry-input',
        dedupeKey: 'training-schema-retry-golden',
        createdByKind: 'user',
        createdByUserId: ownerId,
        maxAttempts: 3,
      });

      // Inject a custom TrainingJobExecutor that returns schema-invalid output
      // (missing required fields like score/dimensions/summary_review). This
      // bypasses the runtime's internal fallback to directly exercise the
      // worker's schema-gate retry path for training taskTypes.
      const invalidExecutor = {
        async process(): Promise<AiInvokeResult> {
          return {
            output: { result_type: 'training_feedback' },
            provider: 'mock-invalid',
            model: 'mock-invalid-v1',
            promptVersion: 'mock-invalid-v1',
            inputTokens: 1,
            outputTokens: 1,
            thinkingMode: 'unset',
            usageEstimated: false,
            skillAudits: [],
          };
        },
      } as unknown as TrainingJobExecutor;

      const agentRunRepo = new AgentRunRepo(fx.db.db);
      const worker = new JobWorker(fx.db, new StubProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
        trainingJobExecutor: invalidExecutor,
      });

      // Attempt 1 → retry_wait (attempts=1 < maxAttempts=3).
      await worker.processJob(job);
      let fresh = jobRepo.findById(job.id);
      expect(fresh?.status).toBe('retry_wait');
      expect(fresh?.lastErrorCode).toBe(SCHEMA_GATE_ERROR_CODE);
      expect(fresh?.attempts).toBe(1);

      // Attempt 2 → retry_wait (attempts=2 < maxAttempts=3).
      await worker.processJob(job);
      fresh = jobRepo.findById(job.id);
      expect(fresh?.status).toBe('retry_wait');
      expect(fresh?.lastErrorCode).toBe(SCHEMA_GATE_ERROR_CODE);
      expect(fresh?.attempts).toBe(2);

      // Attempt 3 → failed (attempts=3, NOT < maxAttempts=3).
      await worker.processJob(job);
      fresh = jobRepo.findById(job.id);
      expect(fresh?.status).toBe('failed');
      expect(fresh?.lastErrorCode).toBe(SCHEMA_GATE_ERROR_CODE);
      expect(fresh?.attempts).toBe(3);

      // ai_run for the final attempt → failed.
      const aiRun = aiRunRepo.findLatestByJob(job.id);
      expect(aiRun?.status).toBe('failed');
    });
  });
});
