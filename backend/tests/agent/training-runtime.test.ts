import { describe, expect, it } from 'vitest';
import type { AiInvokeInput, AiInvokeResult, AiProvider } from '../../src/ai/provider';
import { StubProvider } from '../../src/ai/stub-provider';
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
 * Task 1.2 — TrainingPracticeRuntime unit tests.
 *
 * Covers the six scenarios required by the task spec:
 *   a) 正常追问场景（StubProvider）
 *   b) 无意义追问场景（确定性兜底，modelEnabled=false）
 *   c) 模型失败兜底（provider.invoke 抛错）
 *   d) 反馈生成场景（mock provider 返回合规 JSON）
 *   e) 反馈兜底场景（modelEnabled=false，不泄露 answer_key/rubric/disclosure_rule）
 *   f) token 审计字段（含 skillAudits）
 */

// ── shared fixtures ────────────────────────────────────────────────────────

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

/** Cast an empty object as TrainingRepo — the runtime does not call repo methods
 *  during `run()`; the manifests are passed in via TrainingRuntimeInput. */
const noopRepo = {} as unknown as TrainingRepo;

function buildInput(
  overrides: Partial<TrainingRuntimeInput>,
): TrainingRuntimeInput {
  return {
    attemptId: 'ta_test_1',
    caseSnapshot: CASE_PRIVATE_MANIFEST,
    visibleCaseBrief: VISIBLE_CASE_BRIEF,
    priorTurns: [],
    taskType: 'training_response',
    modelEnabled: false,
    ...overrides,
  };
}

/** Mock provider that throws on every invoke — used by scenario (c). */
function throwingProvider(): AiProvider {
  return {
    async invoke(): Promise<AiInvokeResult> {
      throw new Error('simulated provider failure');
    },
  };
}

/** Mock provider that returns a fixed feedback payload — used by scenario (d). */
const MOCK_FEEDBACK_OUTPUT: TrainingFeedbackOutput = {
  result_type: 'training_feedback',
  score: { total: 56, max: 100, label: '已覆盖部分关键点，仍有改进空间' },
  dimensions: [
    {
      dimension: '目标',
      score: 14,
      max: 20,
      evidence: '用户问到了重做官网的目标，但未细化可观察结果。',
      improvement: '建议追问对方最想先看到的可观察结果。',
    },
    {
      dimension: '对象',
      score: 12,
      max: 20,
      evidence: '用户提到主要面向潜在客户，但未细化分级。',
      improvement: '建议追问哪些对象最优先。',
    },
    {
      dimension: '场景',
      score: 10,
      max: 20,
      evidence: '用户提到官网访问场景，但未描述具体路径。',
      improvement: '建议请对方描述一两个典型使用路径。',
    },
    {
      dimension: '边界',
      score: 8,
      max: 20,
      evidence: '用户尝试确认范围，但没有明确哪些不做。',
      improvement: '直接询问哪些内容明确不在这一版范围内。',
    },
    {
      dimension: '验收',
      score: 12,
      max: 20,
      evidence: '用户问到上线时间，但缺少可观察的完成信号。',
      improvement: '确认什么情况下认为本次练习已经达成目标。',
    },
  ],
  missed_high_value_questions: [
    '本次最希望先看到什么结果？',
    '哪些内容明确不在这一版范围内？',
  ],
  improvement_examples: [
    {
      before: '这个项目要做什么？',
      after: '这次最想先达成哪个可观察的结果？',
      reason: '聚焦到一个可观察的结果，更利于后续追问范围和验收。',
    },
    {
      before: '有什么风险？',
      after: '在时间、合规和资源这几方面，目前最不确定的是哪一项？',
      reason: '把风险拆成具体维度，对方更容易给出有用回答。',
    },
  ],
  summary_review: {
    accuracy: '当前总结覆盖了目标方向和使用场景的大意，但范围、约束与验收仍偏笼统。',
    missing_points: ['可衡量的成功结果', '明确不做的范围'],
    unsupported_claims: [],
    improved_summary:
      '本次练习澄清了目标方向与主要使用场景；建议下一步把可观察的成功结果、明确不做的范围逐项确认。',
  },
};

function mockFeedbackProvider(): AiProvider {
  return {
    async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
      if (input.taskType === 'training_feedback') {
        return {
          provider: 'mock',
          model: 'mock-feedback-v1',
          promptVersion: 'mock-fb-v1',
          inputTokens: 42,
          outputTokens: 88,
          thinkingMode: 'enabled',
          usageEstimated: false,
          output: MOCK_FEEDBACK_OUTPUT,
        };
      }
      return {
        provider: 'mock',
        model: 'mock-v1',
        promptVersion: 'mock-v1',
        inputTokens: 1,
        outputTokens: 1,
        output: {},
      };
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('Task 1.2 — TrainingPracticeRuntime', () => {
  // ── a) 正常追问场景 ──────────────────────────────────────────────────────

  describe('scenario a) normal follow-up question', () => {
    it('returns a TrainingResponseOutput with non-empty content and next_hint via StubProvider', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({
          currentQuestion: '你们这次重做官网，主要想达到什么目标？',
          modelEnabled: true,
        }),
      );

      expect(result.output.result_type).toBe('training_response');
      const output = result.output as TrainingResponseOutput;
      expect(output.role_answer.content.length).toBeGreaterThan(0);
      expect(output.coach_projection.next_hint.length).toBeGreaterThan(0);

      // Schema gate must pass.
      const gate = validateOutput('training_response', output);
      expect(gate.ok).toBe(true);

      // Provider fields should reflect the StubProvider.
      expect(result.provider).toBe('stub');
      expect(result.model).toBe('stub-v1');
    });
  });

  // ── b) 无意义追问场景（确定性兜底） ─────────────────────────────────────

  describe('scenario b) meaningless question deterministic fallback', () => {
    it('returns the meaningless-question fallback when modelEnabled=false and question is digits', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({
          currentQuestion: '123123',
          modelEnabled: false,
        }),
      );

      expect(result.output.result_type).toBe('training_response');
      const output = result.output as TrainingResponseOutput;
      expect(output.role_answer.content).toContain('我没太理解你想问什么');
      expect(output.coach_projection.next_hint).toContain('建议先问');
      expect(output.role_answer.disclosed_rule_ids).toEqual([]);

      // Schema gate must still pass.
      const gate = validateOutput('training_response', output);
      expect(gate.ok).toBe(true);

      // Provider fields should reflect deterministic fallback.
      expect(result.provider).toBe('deterministic-fallback');
    });
  });

  // ── c) 模型失败兜底 ─────────────────────────────────────────────────────

  describe('scenario c) model failure fallback', () => {
    it('falls back deterministically when provider.invoke throws', async () => {
      const runtime = new TrainingPracticeRuntime(throwingProvider(), noopRepo);
      const result = await runtime.run(
        buildInput({
          currentQuestion: 'valid question about goals',
          modelEnabled: true,
        }),
      );

      expect(result.output.result_type).toBe('training_response');
      const output = result.output as TrainingResponseOutput;
      // "valid question" is not meaningless, so the default fallback applies.
      expect(output.role_answer.content).toContain('能补充一下背景');
      expect(output.coach_projection.question_quality_note).toBe('too_broad');

      // skillAudits must record the failure.
      const failedAudits = result.skillAudits.filter((a) => !a.success);
      expect(failedAudits.length).toBeGreaterThan(0);
      expect(result.skillAudits.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── d) 反馈生成场景 ─────────────────────────────────────────────────────

  describe('scenario d) feedback generation', () => {
    it('returns a TrainingFeedbackOutput with 5 dimensions and improvement examples', async () => {
      const runtime = new TrainingPracticeRuntime(mockFeedbackProvider(), noopRepo);
      const result = await runtime.run(
        buildInput({
          taskType: 'training_feedback',
          submittedSummary:
            '用户想做一个官网重做，主要面向潜在客户，希望 6 周内上线，预算 8 万元。',
          priorTurns: [
            { role: 'user', content: '你们这次重做官网主要想达到什么目标？' },
            { role: 'role', content: '我们希望提升品牌可信度。' },
            { role: 'user', content: '主要给谁看？' },
            { role: 'role', content: '潜在客户和合作伙伴。' },
            { role: 'user', content: '有什么范围限制？' },
          ],
          modelEnabled: true,
        }),
      );

      expect(result.output.result_type).toBe('training_feedback');
      const output = result.output as TrainingFeedbackOutput;

      // Schema gate must pass.
      const gate = validateOutput('training_feedback', output);
      expect(gate.ok).toBe(true);

      // Dimensions must contain the 5 expected Chinese labels.
      const dimensionNames = output.dimensions.map((d) => d.dimension);
      expect(dimensionNames).toEqual(
        expect.arrayContaining(['目标', '对象', '场景', '边界', '验收']),
      );
      expect(output.dimensions.length).toBeGreaterThanOrEqual(5);

      // improvement_examples each contain before/after/reason.
      expect(output.improvement_examples.length).toBeGreaterThan(0);
      for (const example of output.improvement_examples) {
        expect(typeof example.before).toBe('string');
        expect(example.before.length).toBeGreaterThan(0);
        expect(typeof example.after).toBe('string');
        expect(example.after.length).toBeGreaterThan(0);
        expect(typeof example.reason).toBe('string');
        expect(example.reason.length).toBeGreaterThan(0);
      }

      // Provider fields should reflect the mock provider.
      expect(result.provider).toBe('mock');
      expect(result.model).toBe('mock-feedback-v1');
    });
  });

  // ── e) 反馈兜底场景 ─────────────────────────────────────────────────────

  describe('scenario e) feedback deterministic fallback', () => {
    it('returns deterministic feedback when modelEnabled=false without leaking private manifest', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({
          taskType: 'training_feedback',
          submittedSummary:
            '用户想做一个官网重做，主要面向潜在客户。',
          priorTurns: [
            { role: 'user', content: '你们这次重做官网主要想达到什么目标？' },
          ],
          modelEnabled: false,
        }),
      );

      expect(result.output.result_type).toBe('training_feedback');
      const output = result.output as TrainingFeedbackOutput;

      // Schema gate must pass.
      const gate = validateOutput('training_feedback', output);
      expect(gate.ok).toBe(true);

      // Deterministic feedback should also have the 5 dimensions.
      const dimensionNames = output.dimensions.map((d) => d.dimension);
      expect(dimensionNames).toEqual(
        expect.arrayContaining(['目标', '对象', '场景', '边界', '验收']),
      );

      // Must NOT leak answer_key / rubric / disclosure_rule text.
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain('answer_key');
      expect(serialized).not.toContain('rubric');
      expect(serialized).not.toContain('disclosure_rule');
      // Must NOT claim capability certification (§11.2).
      expect(serialized).not.toContain('能力认证');
      expect(serialized).not.toContain('证书');

      // Provider fields should reflect deterministic fallback.
      expect(result.provider).toBe('deterministic-fallback');
    });
  });

  // ── f) token 审计字段 ────────────────────────────────────────────────────

  describe('scenario f) token audit fields', () => {
    it('exposes provider/model/promptVersion/token fields and skillAudits on response path', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({
          currentQuestion: '你们这次重做官网主要想达到什么目标？',
          modelEnabled: true,
        }),
      );

      expect(typeof result.provider).toBe('string');
      expect(result.provider.length).toBeGreaterThan(0);
      expect(typeof result.model).toBe('string');
      expect(result.model.length).toBeGreaterThan(0);
      expect(typeof result.promptVersion).toBe('string');
      expect(result.promptVersion.length).toBeGreaterThan(0);
      expect(typeof result.inputTokens).toBe('number');
      expect(typeof result.outputTokens).toBe('number');
      expect(['unset', 'enabled', 'disabled']).toContain(result.thinkingMode);
      expect(typeof result.usageEstimated).toBe('boolean');
      expect(Array.isArray(result.skillAudits)).toBe(true);

      // skillAudits must contain training.roleplay.answer and training.coaching.next_hint.
      const skillIds = result.skillAudits.map((a) => a.skillId);
      expect(skillIds).toContain('training.roleplay.answer');
      expect(skillIds).toContain('training.coaching.next_hint');

      // Each audit entry must have skillId / skillVersion / durationMs / success.
      for (const audit of result.skillAudits) {
        expect(typeof audit.skillId).toBe('string');
        expect(typeof audit.skillVersion).toBe('string');
        expect(typeof audit.durationMs).toBe('number');
        expect(typeof audit.success).toBe('boolean');
      }
    });

    it('exposes skillAudits on feedback path containing composition.feedback_report', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({
          taskType: 'training_feedback',
          submittedSummary: '本次澄清了目标与对象。',
          modelEnabled: false,
        }),
      );

      const skillIds = result.skillAudits.map((a) => a.skillId);
      expect(skillIds).toContain('training.composition.feedback_report');
      expect(skillIds).toContain('training.structuring.coverage_update');
    });
  });

  // ── additional edge cases ───────────────────────────────────────────────

  describe('unknown taskType', () => {
    it('throws for an unsupported taskType', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      await expect(
        runtime.run(
          buildInput({
            // @ts-expect-error — intentionally invalid taskType
            taskType: 'training_unknown',
          }),
        ),
      ).rejects.toThrow(/Unknown training taskType/);
    });
  });

  describe('meaningless question detection', () => {
    it('detects short questions', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({ currentQuestion: '啊', modelEnabled: false }),
      );
      const output = result.output as TrainingResponseOutput;
      expect(output.role_answer.content).toContain('我没太理解');
    });

    it('detects pure-digit questions', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({ currentQuestion: '1234567890', modelEnabled: false }),
      );
      const output = result.output as TrainingResponseOutput;
      expect(output.role_answer.content).toContain('我没太理解');
    });

    it('detects repeated-character questions', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({ currentQuestion: '哈哈哈哈哈哈哈', modelEnabled: false }),
      );
      const output = result.output as TrainingResponseOutput;
      expect(output.role_answer.content).toContain('我没太理解');
    });
  });

  describe('tone inference', () => {
    it('infers customer tone for 客户 role', async () => {
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({ currentQuestion: '123456', modelEnabled: false }),
      );
      const output = result.output as TrainingResponseOutput;
      expect(output.role_answer.tone).toBe('customer');
    });

    it('infers teacher tone for 老师 role', async () => {
      const manifest: TrainingCasePrivateManifest = {
        ...CASE_PRIVATE_MANIFEST,
        persona: {
          ...CASE_PRIVATE_MANIFEST.persona,
          role: '课程老师',
        },
      };
      const runtime = new TrainingPracticeRuntime(
        new StubProvider(),
        noopRepo,
      );
      const result = await runtime.run(
        buildInput({
          currentQuestion: '123456',
          modelEnabled: false,
          caseSnapshot: manifest,
        }),
      );
      const output = result.output as TrainingResponseOutput;
      expect(output.role_answer.tone).toBe('teacher');
    });
  });
});
