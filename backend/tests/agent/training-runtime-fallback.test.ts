import { describe, expect, it } from 'vitest';
import type { AiInvokeInput, AiInvokeResult, AiProvider } from '../../src/ai/provider';
import { validateOutput } from '../../src/ai/schema-gates';
import { TrainingPracticeRuntime } from '../../src/agent/training-runtime';
import type {
  TrainingFeedbackOutput,
  TrainingResponseOutput,
  TrainingRuntimeInput,
} from '../../src/agent/training-runtime';
import type {
  TrainingCasePrivateManifest,
  TrainingCasePublicBrief,
  TrainingRepo,
} from '../../src/repo/training-repo';

/**
 * Task 2.2 — Model failure fallback unit tests.
 *
 * Covers the three fallback scenarios required by Task 2.2:
 *   A) Provider throws (network timeout simulated) → Runtime returns
 *      deterministic fallback with output from buildDeterministic*.
 *   B) Provider returns structured but schema-invalid output → Runtime falls
 *      back deterministically. (Worker-level retry→failed is covered in
 *      training-job-executor.test.ts scenario 5.)
 *   C) Provider returns empty string → Runtime goes buildDeterministicResponse.
 *
 * Plus leakage assertions (SubTask 2.2.3): buildDeterministicResponse and
 * buildDeterministicFeedback outputs must not contain `answer_key`, `rubric`,
 * `disclosure_rule`, or `disclosure_rules` text.
 */

// ── shared fixtures (mirrors training-runtime.test.ts) ──────────────────────

const CASE_PRIVATE_MANIFEST: TrainingCasePrivateManifest = {
  persona: {
    role: '企业客户',
    communication_style: '务实、关注投入产出',
    knowledge_level: '熟悉自身业务，不熟悉技术实现',
  },
  hidden_facts: [
    {
      id: 'fact_budget',
      dimension: '边界',
      content: '本次预算上限 8 万元。',
      importance: 'high',
    },
    {
      id: 'fact_deadline',
      dimension: '边界',
      content: '希望 6 周内上线第一版。',
      importance: 'medium',
    },
  ],
  disclosure_rules: [
    {
      id: 'rule_budget',
      trigger_intent: '预算',
      allowed_answer: '本次预算上限 8 万元。',
      related_fact_ids: ['fact_budget'],
    },
  ],
  rubric: [
    { dimension: '目标', max_score: 20, evidence_rule: '是否问到可观察的结果' },
    { dimension: '对象', max_score: 20, evidence_rule: '是否问清主要使用对象' },
    { dimension: '场景', max_score: 20, evidence_rule: '是否问清使用场景' },
    { dimension: '边界', max_score: 20, evidence_rule: '是否问清范围与限制' },
    { dimension: '验收', max_score: 20, evidence_rule: '是否问清完成标准' },
  ],
};

const VISIBLE_CASE_BRIEF: TrainingCasePublicBrief = {
  case_id: 'case_website_redo',
  case_version: '1',
  title: '企业官网重做需求澄清练习',
  category: 'software',
  difficulty: 'medium',
  description: '练习者需要通过追问澄清客户重做官网的真实目标与边界。',
  role_label: '企业客户',
  practice_goal: '练习在限定时间内澄清目标、对象、场景、边界与验收五个维度。',
  visible_constraints: ['单次练习 15 分钟', '至少追问 5 个问题'],
  evaluation_dimensions_public: ['目标', '对象', '场景', '边界', '验收'],
};

const noopRepo = {} as unknown as TrainingRepo;

function buildInput(
  overrides: Partial<TrainingRuntimeInput>,
): TrainingRuntimeInput {
  return {
    attemptId: 'ta_fallback_1',
    caseSnapshot: CASE_PRIVATE_MANIFEST,
    visibleCaseBrief: VISIBLE_CASE_BRIEF,
    priorTurns: [],
    taskType: 'training_response',
    modelEnabled: false,
    ...overrides,
  };
}

// ── mock providers ───────────────────────────────────────────────────────────

/** Provider that throws on every invoke — simulates network timeout / connection failure. */
function throwingProvider(): AiProvider {
  return {
    async invoke(): Promise<AiInvokeResult> {
      throw new Error('simulated network timeout');
    },
  };
}

/** Provider that returns an empty string output — simulates a model returning no content. */
function emptyOutputProvider(): AiProvider {
  return {
    async invoke(): Promise<AiInvokeResult> {
      return {
        output: '',
        provider: 'mock-empty',
        model: 'mock-empty-v1',
        promptVersion: 'mock-empty-v1',
        inputTokens: 0,
        outputTokens: 0,
        thinkingMode: 'unset',
        usageEstimated: false,
      };
    },
  };
}

/** Provider that returns structured but schema-invalid output (missing required fields). */
function schemaInvalidProvider(): AiProvider {
  return {
    async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
      if (input.taskType === 'training_feedback') {
        // Missing score / dimensions / summary_review.
        return {
          output: { result_type: 'training_feedback' },
          provider: 'mock-invalid',
          model: 'mock-invalid-v1',
          promptVersion: 'mock-invalid-v1',
          inputTokens: 1,
          outputTokens: 1,
          thinkingMode: 'unset',
          usageEstimated: false,
        };
      }
      // Missing role_answer / coach_projection.
      return {
        output: { result_type: 'training_response' },
        provider: 'mock-invalid',
        model: 'mock-invalid-v1',
        promptVersion: 'mock-invalid-v1',
        inputTokens: 1,
        outputTokens: 1,
        thinkingMode: 'unset',
        usageEstimated: false,
      };
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('Task 2.2 — Model failure fallback', () => {
  // ── scenario A) Provider throws → deterministic fallback ──────────────────

  describe('scenario A) provider throws (network timeout simulated)', () => {
    it('response path: returns deterministic-fallback provider with role_answer from buildDeterministicResponse', async () => {
      const runtime = new TrainingPracticeRuntime(throwingProvider(), noopRepo);
      const result = await runtime.run(
        buildInput({
          currentQuestion: '你们这次重做官网，主要想达到什么目标？',
          modelEnabled: true,
        }),
      );

      expect(result.output.result_type).toBe('training_response');
      const output = result.output as TrainingResponseOutput;

      // Provider fields reflect deterministic fallback (not the throwing provider).
      expect(result.provider).toBe('deterministic-fallback');
      expect(result.model).toBe('rule-based-v1');

      // role_answer content comes from buildDeterministicResponse.
      expect(output.role_answer.content.length).toBeGreaterThan(0);
      expect(output.role_answer.safe_to_show).toBe(true);
      expect(output.role_answer.disclosed_rule_ids).toEqual([]);

      // Schema gate must still pass on the fallback output.
      const gate = validateOutput('training_response', output);
      expect(gate.ok).toBe(true);

      // skillAudits must record the failure (success=false).
      const failedAudits = result.skillAudits.filter((a) => !a.success);
      expect(failedAudits.length).toBeGreaterThan(0);
    });

    it('feedback path: returns deterministic-fallback provider with feedback from buildDeterministicFeedback', async () => {
      const runtime = new TrainingPracticeRuntime(throwingProvider(), noopRepo);
      const result = await runtime.run(
        buildInput({
          taskType: 'training_feedback',
          submittedSummary: '用户想做一个官网重做，主要面向潜在客户。',
          priorTurns: [
            { role: 'user', content: '你们这次重做官网主要想达到什么目标？' },
          ],
          modelEnabled: true,
        }),
      );

      expect(result.output.result_type).toBe('training_feedback');
      const output = result.output as TrainingFeedbackOutput;

      // Provider fields reflect deterministic fallback.
      expect(result.provider).toBe('deterministic-fallback');
      expect(result.model).toBe('rule-based-v1');

      // Feedback comes from buildDeterministicFeedback — 5 Chinese dimensions.
      const dimensionNames = output.dimensions.map((d) => d.dimension);
      expect(dimensionNames).toEqual(
        expect.arrayContaining(['目标', '对象', '场景', '边界', '验收']),
      );
      expect(output.dimensions.length).toBe(5);

      // Schema gate must pass.
      const gate = validateOutput('training_feedback', output);
      expect(gate.ok).toBe(true);

      // skillAudits must record the failure.
      const failedAudits = result.skillAudits.filter((a) => !a.success);
      expect(failedAudits.length).toBeGreaterThan(0);
    });
  });

  // ── scenario B) Provider returns schema-invalid output → Runtime fallback ─

  describe('scenario B) provider returns schema-invalid structured output', () => {
    it('Runtime catches schema failure and falls back deterministically (response path)', async () => {
      const runtime = new TrainingPracticeRuntime(schemaInvalidProvider(), noopRepo);
      const result = await runtime.run(
        buildInput({
          currentQuestion: '你们这次重做官网，主要想达到什么目标？',
          modelEnabled: true,
        }),
      );

      // Runtime falls back — does NOT propagate the schema failure to the caller.
      expect(result.output.result_type).toBe('training_response');
      const output = result.output as TrainingResponseOutput;

      // The fallback output is valid.
      expect(output.role_answer.content.length).toBeGreaterThan(0);
      const gate = validateOutput('training_response', output);
      expect(gate.ok).toBe(true);

      // skillAudits record failure (schema parse failed inside the runtime).
      const failedAudits = result.skillAudits.filter((a) => !a.success);
      expect(failedAudits.length).toBeGreaterThan(0);
    });
  });

  // ── scenario C) Provider returns empty/meaningless → buildDeterministicResponse

  describe('scenario C) provider returns empty string / meaningless content', () => {
    it('empty string output → Runtime falls back to buildDeterministicResponse', async () => {
      const runtime = new TrainingPracticeRuntime(emptyOutputProvider(), noopRepo);
      const result = await runtime.run(
        buildInput({
          currentQuestion: '你们这次重做官网，主要想达到什么目标？',
          modelEnabled: true,
        }),
      );

      expect(result.output.result_type).toBe('training_response');
      const output = result.output as TrainingResponseOutput;

      // The question is valid (not meaningless), so the default "too_broad"
      // fallback applies — not the meaningless-question branch.
      expect(output.role_answer.content).toContain('能补充一下背景');
      expect(output.coach_projection.question_quality_note).toBe('too_broad');

      // Schema gate passes on the fallback.
      const gate = validateOutput('training_response', output);
      expect(gate.ok).toBe(true);

      // skillAudits record failure (empty output failed schema parse).
      const failedAudits = result.skillAudits.filter((a) => !a.success);
      expect(failedAudits.length).toBeGreaterThan(0);
    });
  });

  // ── SubTask 2.2.3: leakage assertions ─────────────────────────────────────

  describe('leakage: deterministic fallback outputs do not leak private manifest', () => {
    it('buildDeterministicResponse output contains no answer_key/rubric/disclosure_rule/disclosure_rules', async () => {
      // Exercise both the meaningless-question branch and the too_broad
      // default branch of buildDeterministicResponse.
      const runtime = new TrainingPracticeRuntime(throwingProvider(), noopRepo);

      // Meaningless branch.
      const meaninglessResult = await runtime.run(
        buildInput({ currentQuestion: '123123', modelEnabled: true }),
      );
      const meaninglessOutput = meaninglessResult.output as TrainingResponseOutput;
      const meaninglessSerialized = JSON.stringify(meaninglessOutput);
      expect(meaninglessSerialized).not.toContain('answer_key');
      expect(meaninglessSerialized).not.toContain('rubric');
      expect(meaninglessSerialized).not.toContain('disclosure_rule');
      expect(meaninglessSerialized).not.toContain('disclosure_rules');

      // Too-broad default branch.
      const tooBroadResult = await runtime.run(
        buildInput({
          currentQuestion: '你们这次重做官网，主要想达到什么目标？',
          modelEnabled: true,
        }),
      );
      const tooBroadOutput = tooBroadResult.output as TrainingResponseOutput;
      const tooBroadSerialized = JSON.stringify(tooBroadOutput);
      expect(tooBroadSerialized).not.toContain('answer_key');
      expect(tooBroadSerialized).not.toContain('rubric');
      expect(tooBroadSerialized).not.toContain('disclosure_rule');
      expect(tooBroadSerialized).not.toContain('disclosure_rules');
    });

    it('buildDeterministicFeedback output contains no answer_key/rubric/disclosure_rule/disclosure_rules', async () => {
      const runtime = new TrainingPracticeRuntime(throwingProvider(), noopRepo);
      const result = await runtime.run(
        buildInput({
          taskType: 'training_feedback',
          submittedSummary: '用户想做一个官网重做，主要面向潜在客户。',
          priorTurns: [
            { role: 'user', content: '你们这次重做官网主要想达到什么目标？' },
            { role: 'user', content: '预算是多少？' },
          ],
          modelEnabled: true,
        }),
      );
      const output = result.output as TrainingFeedbackOutput;
      const serialized = JSON.stringify(output);

      expect(serialized).not.toContain('answer_key');
      expect(serialized).not.toContain('rubric');
      expect(serialized).not.toContain('disclosure_rule');
      expect(serialized).not.toContain('disclosure_rules');
      // Must not claim capability certification (§11.2).
      expect(serialized).not.toContain('能力认证');
      expect(serialized).not.toContain('证书');
    });
  });
});
