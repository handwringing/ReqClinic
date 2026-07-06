import type { AiInvokeResult, AiProvider } from '../ai/provider';
import { estimateTokens } from '../ai/json-prompt';
import {
  trainingFeedbackOutputSchema,
  trainingRoleAnswerOutputSchema,
} from '../ai/schema-gates/training-schemas';
import type {
  TrainingCasePrivateManifest,
  TrainingCasePublicBrief,
  TrainingRepo,
} from '../repo/training-repo';
import {
  TRAINING_COACHING_NEXT_HINT,
  TRAINING_COMPOSITION_FEEDBACK_REPORT,
  TRAINING_ROLEPLAY_ANSWER,
  TRAINING_STRUCTURING_COVERAGE_UPDATE,
} from './skills';

/**
 * Expression-training practice runtime (08 plan §5.3 / §11.1 / §11.2).
 *
 * The runtime drives the real training chain end-to-end: it builds role-play
 * and coaching prompts from a case's private manifest + public brief, calls the
 * configured AI provider, re-validates the model output through the training
 * schema gates, and falls back to a deterministic rule-based output when the
 * model is disabled or returns a malformed/throwing response.
 *
 * The runtime never leaks `answer_key`, `rubric` or `disclosure_rule` trigger
 * rules to the user-visible output — those are only embedded in the system
 * prompt for the model to consult, and the deterministic fallback computes
 * scores purely from keyword coverage of the user's questions and summary.
 */

export interface TrainingTurn {
  role: 'user' | 'role' | 'coach';
  content: string;
}

export interface TrainingRuntimeInput {
  attemptId: string;
  /** Private manifest — only consumed by the runtime, never returned upstream. */
  caseSnapshot: TrainingCasePrivateManifest;
  /** Public brief — used for prompt context (user-visible fields only). */
  visibleCaseBrief: TrainingCasePublicBrief;
  priorTurns: TrainingTurn[];
  currentQuestion?: string;
  submittedSummary?: string;
  taskType: 'training_response' | 'training_feedback';
  /** When false (or when the model fails), the runtime uses deterministic fallback. */
  modelEnabled: boolean;
}

export interface TrainingRoleAnswer {
  content: string;
  tone: 'customer' | 'teacher' | 'colleague' | 'business_owner';
  disclosed_rule_ids: string[];
  safe_to_show: true;
}

export interface TrainingCoachProjection {
  next_hint: string;
  question_quality_note: string;
  visible_progress_label: string;
}

export interface TrainingResponseOutput {
  result_type: 'training_response';
  role_answer: TrainingRoleAnswer;
  coach_projection: TrainingCoachProjection;
}

export interface TrainingFeedbackDimension {
  dimension: string;
  score: number;
  max: number;
  evidence: string;
  improvement: string;
}

export interface TrainingImprovementExample {
  before: string;
  after: string;
  reason: string;
}

export interface TrainingSummaryReview {
  accuracy: string;
  missing_points: string[];
  unsupported_claims: string[];
  improved_summary: string;
}

export interface TrainingFeedbackOutput {
  result_type: 'training_feedback';
  score: {
    total: number;
    max: number;
    label: string;
  };
  dimensions: TrainingFeedbackDimension[];
  missed_high_value_questions: string[];
  improvement_examples: TrainingImprovementExample[];
  summary_review: TrainingSummaryReview;
}

export interface TrainingSkillAudit {
  skillId: string;
  skillVersion: string;
  durationMs: number;
  success: boolean;
}

export interface TrainingRuntimeResult {
  output: TrainingResponseOutput | TrainingFeedbackOutput;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  thinkingMode: 'unset' | 'enabled' | 'disabled';
  usageEstimated: boolean;
  skillAudits: TrainingSkillAudit[];
}

const DETERMINISTIC_PROVIDER = 'deterministic-fallback';
const DETERMINISTIC_MODEL = 'rule-based-v1';

/** Five evaluation dimensions used by the deterministic feedback fallback. */
const FEEDBACK_DIMENSIONS: Array<{
  dimension: string;
  keywords: string[];
  suggestion: string;
}> = [
  {
    dimension: '目标',
    keywords: ['目标', '想达到', '想要', '结果', '成功', '达成', '完成'],
    suggestion: '这次最想先达成哪个可观察的结果？',
  },
  {
    dimension: '对象',
    keywords: ['谁', '用户', '对象', '客户', '同事', '学生', '角色', '参与', '人群'],
    suggestion: '这件事主要给谁使用或谁会受影响？',
  },
  {
    dimension: '场景',
    keywords: ['场景', '流程', '使用', '怎么用', '何时', '哪里', '情况下'],
    suggestion: '用户会在什么具体场景下使用它？',
  },
  {
    dimension: '边界',
    keywords: ['范围', '边界', '不做', '排除', '限制', '约束', '不包含', '暂不'],
    suggestion: '第一版先做到哪里，哪些明确不做？',
  },
  {
    dimension: '验收',
    keywords: ['验收', '标准', '完成标准', '怎样算', '检查', '测试', '验证', '可观察'],
    suggestion: '怎样算这件事已经做好了？有没有能检查的标准？',
  },
];

export class TrainingPracticeRuntime {
  constructor(
    private readonly provider: AiProvider,
    private readonly trainingRepo: TrainingRepo,
    private readonly promptVersion: string = 'training-practice-v1',
  ) {}

  async run(input: TrainingRuntimeInput): Promise<TrainingRuntimeResult> {
    if (input.taskType === 'training_response') {
      return this.generateResponse(input);
    }
    if (input.taskType === 'training_feedback') {
      return this.generateFeedback(input);
    }
    throw new Error(`Unknown training taskType: ${input.taskType}`);
  }

  // ── training_response ────────────────────────────────────────────────────

  private async generateResponse(
    input: TrainingRuntimeInput,
  ): Promise<TrainingRuntimeResult> {
    const startedAt = Date.now();
    const fallback = this.buildDeterministicResponse(input);

    if (!input.modelEnabled) {
      return this.buildResponseResult(fallback, null, true, startedAt);
    }

    let providerResult: AiInvokeResult | null = null;
    try {
      providerResult = await this.provider.invoke({
        taskType: 'training_response',
        payload: {
          system_prompt: this.buildRoleplaySystemPrompt(input),
          user_prompt: this.buildRoleplayUserPrompt(input),
          messages: [
            ...input.priorTurns,
            ...(input.currentQuestion
              ? [{ role: 'user' as const, content: input.currentQuestion }]
              : []),
          ],
          case_snapshot: {
            persona: input.caseSnapshot.persona,
            hidden_facts: input.caseSnapshot.hidden_facts,
            disclosure_rules: input.caseSnapshot.disclosure_rules,
          },
          visible_case_brief: input.visibleCaseBrief,
        },
      });
      const parsed = trainingRoleAnswerOutputSchema.safeParse(providerResult.output);
      if (parsed.success) {
        return this.buildResponseResult(
          parsed.data as TrainingResponseOutput,
          providerResult,
          true,
          startedAt,
        );
      }
      // Schema gate failed — fall back deterministically.
      return this.buildResponseResult(fallback, providerResult, false, startedAt);
    } catch {
      // Provider threw — fall back deterministically.
      return this.buildResponseResult(fallback, null, false, startedAt);
    }
  }

  // ── training_feedback ────────────────────────────────────────────────────

  private async generateFeedback(
    input: TrainingRuntimeInput,
  ): Promise<TrainingRuntimeResult> {
    const startedAt = Date.now();
    const fallback = this.buildDeterministicFeedback(input);

    if (!input.modelEnabled) {
      return this.buildFeedbackResult(fallback, null, true, startedAt);
    }

    let providerResult: AiInvokeResult | null = null;
    try {
      providerResult = await this.provider.invoke({
        taskType: 'training_feedback',
        payload: {
          system_prompt: this.buildFeedbackSystemPrompt(input),
          user_prompt: this.buildFeedbackUserPrompt(input),
          rubric: input.caseSnapshot.rubric,
          prior_turns: input.priorTurns,
          submitted_summary: input.submittedSummary ?? '',
          visible_case_brief: input.visibleCaseBrief,
        },
      });
      const parsed = trainingFeedbackOutputSchema.safeParse(providerResult.output);
      if (parsed.success) {
        return this.buildFeedbackResult(
          parsed.data as TrainingFeedbackOutput,
          providerResult,
          true,
          startedAt,
        );
      }
      return this.buildFeedbackResult(fallback, providerResult, false, startedAt);
    } catch {
      return this.buildFeedbackResult(fallback, null, false, startedAt);
    }
  }

  // ── deterministic fallbacks ──────────────────────────────────────────────

  private buildDeterministicResponse(input: TrainingRuntimeInput): TrainingResponseOutput {
    const question = input.currentQuestion ?? '';
    const userTurnCount = input.priorTurns.filter((t) => t.role === 'user').length;
    const progressLabel = `已追问 ${userTurnCount} 次`;
    const tone = this.inferTone(input.caseSnapshot.persona.role);

    if (this.isMeaninglessQuestion(question)) {
      // §11.1 末尾示例：无意义追问时角色要求对方换一种问法。
      return {
        result_type: 'training_response',
        role_answer: {
          content:
            '我没太理解你想问什么。你可以具体问目标、使用场景、限制条件或完成标准中的一个。',
          tone,
          disclosed_rule_ids: [],
          safe_to_show: true,
        },
        coach_projection: {
          next_hint: '这条追问还不像一个问题。建议先问"这件事最想达到什么结果？"',
          question_quality_note: 'meaningless',
          visible_progress_label: progressLabel,
        },
      };
    }

    // 默认兜底：问题过于宽泛，引导用户聚焦。
    return {
      result_type: 'training_response',
      role_answer: {
        content: '这个问题我需要想一想。你能补充一下背景吗？',
        tone,
        disclosed_rule_ids: [],
        safe_to_show: true,
      },
      coach_projection: {
        next_hint:
          '可以试试问"这件事最想达到什么结果？"或"主要在什么场景下使用？"',
        question_quality_note: 'too_broad',
        visible_progress_label: progressLabel,
      },
    };
  }

  private buildDeterministicFeedback(
    input: TrainingRuntimeInput,
  ): TrainingFeedbackOutput {
    const userQuestions = input.priorTurns
      .filter((t) => t.role === 'user')
      .map((t) => t.content)
      .join('\n');
    const summary = input.submittedSummary ?? '';
    const combinedText = `${userQuestions}\n${summary}`;

    const dimensionResults: TrainingFeedbackDimension[] = FEEDBACK_DIMENSIONS.map(
      (d) => {
        const hitInQuestions = d.keywords.some((k) => userQuestions.includes(k));
        const hitInSummary = d.keywords.some((k) => summary.includes(k));
        const hit = hitInQuestions || hitInSummary;
        const score = hitInQuestions && hitInSummary ? 14 : hit ? 10 : 0;
        return {
          dimension: d.dimension,
          score,
          max: 20,
          evidence: hit
            ? hitInSummary
              ? `用户在追问与总结中均涉及了${d.dimension}相关内容。`
              : `用户在追问中涉及了${d.dimension}相关内容，但未在总结中体现。`
            : `用户未在追问或总结中涉及${d.dimension}相关内容。`,
          improvement: hit
            ? `建议进一步细化${d.dimension}维度，使其可观察、可检查。`
            : `建议下一次练习先围绕${d.dimension}维度提出更具体的追问，例如"${d.suggestion}"`,
        };
      },
    );

    const total = dimensionResults.reduce((sum, d) => sum + d.score, 0);
    const missedDimensions = dimensionResults
      .filter((d) => d.score === 0)
      .map((d) => d.dimension);
    const missedHighValueQuestions = dimensionResults
      .filter((d) => d.score === 0)
      .map((d) => FEEDBACK_DIMENSIONS.find((x) => x.dimension === d.dimension)!.suggestion);

    const label =
      total >= 70
        ? '已覆盖多数关键维度，仍有改进空间'
        : total >= 30
          ? '已覆盖部分关键维度，仍有较多遗漏'
          : '本轮覆盖较少，建议系统性补齐追问维度';

    return {
      result_type: 'training_feedback',
      score: {
        total,
        max: 100,
        label,
      },
      dimensions: dimensionResults,
      missed_high_value_questions: missedHighValueQuestions,
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
        accuracy: summary
          ? `当前总结基于本轮追问生成，${missedDimensions.length === 0 ? '各维度均有覆盖。' : `${missedDimensions.join('、')}维度仍需补充。`}`
          : '当前未提交总结，无法评估准确性。',
        missing_points: missedDimensions,
        unsupported_claims: [],
        improved_summary: summary
          ? `建议在现有总结基础上，补充以下维度的具体内容：${missedDimensions.length > 0 ? missedDimensions.join('、') : '暂无遗漏'}。`
          : '建议下次先围绕目标、对象、场景、边界、验收五个维度逐项追问，再形成总结。',
      },
    };
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private isMeaninglessQuestion(q: string): boolean {
    const trimmed = q.trim();
    if (trimmed.length < 5) return true;
    if (/^\d+$/.test(trimmed)) return true;
    if (/^(.)\1+$/.test(trimmed)) return true; // 重复字符
    return false;
  }

  private inferTone(
    role: string,
  ): 'customer' | 'teacher' | 'colleague' | 'business_owner' {
    const r = role.toLowerCase();
    if (r.includes('客户') || r.includes('customer')) return 'customer';
    if (r.includes('老师') || r.includes('teacher') || r.includes('教授')) {
      return 'teacher';
    }
    if (r.includes('同事') || r.includes('colleague')) return 'colleague';
    return 'business_owner';
  }

  // ── prompt builders ──────────────────────────────────────────────────────

  private buildRoleplaySystemPrompt(input: TrainingRuntimeInput): string {
    const persona = input.caseSnapshot.persona;
    const hiddenFacts = input.caseSnapshot.hidden_facts
      .slice()
      .sort((a, b) => {
        const order: Record<'high' | 'medium' | 'low', number> = {
          high: 0,
          medium: 1,
          low: 2,
        };
        return order[a.importance] - order[b.importance];
      });
    const disclosureRules = input.caseSnapshot.disclosure_rules;

    return [
      '你正在 ReqClinic 表达训练中扮演一个案例角色，请严格遵守以下原则（08 文档 §11.1）：',
      '1. 只回答用户问到的内容，不主动补全隐藏关键点。',
      '2. 不把评分维度透露给用户。',
      '3. 不使用"作为 AI"之类说法，保持案例角色的人设。',
      '4. 保持案例角色的人设和知识边界。',
      '5. 用户问题无意义时，用角色口吻要求对方换一种问法。',
      '6. 只输出一个 JSON 对象，不输出解释或代码块。',
      '',
      '## 案例角色人设',
      `- 角色：${persona.role || '未指定'}`,
      `- 沟通风格：${persona.communication_style || '自然口语'}`,
      `- 知识水平：${persona.knowledge_level || '一般'}`,
      '',
      '## 隐藏关键点（按重要性排序，仅在用户问到对应内容时披露）',
      hiddenFacts.length > 0
        ? hiddenFacts
            .map(
              (f) =>
                `- [${f.importance}] ${f.dimension}：${f.content}（id: ${f.id}）`,
            )
            .join('\n')
        : '- 暂无隐藏关键点。',
      '',
      '## 披露规则（触发条件命中时才允许回答对应内容）',
      disclosureRules.length > 0
        ? disclosureRules
            .map(
              (r) =>
                `- 触发条件：${r.trigger_intent}；允许回答：${r.allowed_answer}；规则 id：${r.id}`,
            )
            .join('\n')
        : '- 暂无披露规则。',
      '',
      '## 输出 JSON 结构',
      JSON.stringify(
        {
          result_type: 'training_response',
          role_answer: {
            content: '用案例角色口吻回答用户问题',
            tone: 'customer | teacher | colleague | business_owner',
            disclosed_rule_ids: ['命中的规则 id'],
            safe_to_show: true,
          },
          coach_projection: {
            next_hint: '给用户的下一步追问建议',
            question_quality_note:
              '当前问题的质量评估标签（effective/too_broad/repeated/meaningless/leading）',
            visible_progress_label: '可见进度标签',
          },
        },
        null,
        2,
      ),
    ].join('\n');
  }

  private buildRoleplayUserPrompt(input: TrainingRuntimeInput): string {
    const brief = input.visibleCaseBrief;
    const turns = input.priorTurns;
    return [
      '## 案例公开简报',
      `- 标题：${brief.title}`,
      `- 角色：${brief.role_label}`,
      `- 练习目标：${brief.practice_goal}`,
      `- 描述：${brief.description}`,
      '',
      '## 历史对话',
      turns.length > 0
        ? turns
            .map((t) => {
              const speaker =
                t.role === 'user' ? '用户' : t.role === 'role' ? '角色' : '教练';
              return `- ${speaker}：${t.content}`;
            })
            .join('\n')
        : '- 暂无历史对话。',
      '',
      '## 当前用户问题',
      input.currentQuestion ?? '（用户未提问）',
    ].join('\n');
  }

  private buildFeedbackSystemPrompt(input: TrainingRuntimeInput): string {
    const rubric = input.caseSnapshot.rubric;
    return [
      '你正在 ReqClinic 表达训练中生成教练反馈报告，请严格遵守以下原则（08 文档 §11.2）：',
      '1. 先肯定已覆盖内容，再指出遗漏。',
      '2. 每个遗漏都说明为什么影响需求质量。',
      '3. 改进示例必须具体可复用。',
      '4. 不把答案写成唯一标准答案。',
      '5. 不使用开发者术语。',
      '6. 不把本轮分数说成用户能力认证。',
      '7. 只输出一个 JSON 对象，不输出解释或代码块。',
      '',
      '## 评分维度与证据规则（仅供模型参考，不直接输出给用户）',
      rubric.length > 0
        ? rubric
            .map(
              (r) =>
                `- ${r.dimension}（max ${r.max_score}）：${r.evidence_rule}`,
            )
            .join('\n')
        : '- 暂无评分维度配置，请按目标、对象、场景、边界、验收五个维度评估。',
      '',
      '## 输出 JSON 结构',
      JSON.stringify(
        {
          result_type: 'training_feedback',
          score: { total: 0, max: 100, label: '标签' },
          dimensions: [
            {
              dimension: '维度名（建议使用：目标、对象、场景、边界、验收）',
              score: 0,
              max: 20,
              evidence: '证据',
              improvement: '改进建议',
            },
          ],
          missed_high_value_questions: ['遗漏的高价值问题'],
          improvement_examples: [
            { before: '原问题', after: '改进后', reason: '原因' },
          ],
          summary_review: {
            accuracy: '总结准确性评估',
            missing_points: ['遗漏点'],
            unsupported_claims: ['无证据的论断'],
            improved_summary: '改进后的总结',
          },
        },
        null,
        2,
      ),
    ].join('\n');
  }

  private buildFeedbackUserPrompt(input: TrainingRuntimeInput): string {
    const brief = input.visibleCaseBrief;
    const turns = input.priorTurns;
    const userText = turns
      .filter((t) => t.role === 'user')
      .map((t) => t.content)
      .join('\n');
    const hitRuleIds = input.caseSnapshot.disclosure_rules
      .filter((r) => r.trigger_intent && userText.includes(r.trigger_intent))
      .map((r) => r.id);
    return [
      '## 案例公开简报',
      `- 标题：${brief.title}`,
      `- 练习目标：${brief.practice_goal}`,
      '',
      '## 历史追问',
      turns.length > 0
        ? turns
            .map((t) => {
              const speaker =
                t.role === 'user' ? '用户' : t.role === 'role' ? '角色' : '教练';
              return `- ${speaker}：${t.content}`;
            })
            .join('\n')
        : '- 暂无追问记录。',
      '',
      '## 命中的披露规则',
      hitRuleIds.length > 0
        ? hitRuleIds.map((id) => `- ${id}`).join('\n')
        : '- 暂无命中的披露规则。',
      '',
      '## 用户提交的总结',
      input.submittedSummary ?? '（用户未提交总结）',
    ].join('\n');
  }

  // ── result builders ─────────────────────────────────────────────────────

  private buildResponseResult(
    output: TrainingResponseOutput,
    providerResult: AiInvokeResult | null,
    success: boolean,
    startedAt: number,
  ): TrainingRuntimeResult {
    const durationMs = Date.now() - startedAt;
    const usedModel = providerResult !== null;
    return {
      output,
      provider: usedModel ? providerResult.provider : DETERMINISTIC_PROVIDER,
      model: usedModel ? providerResult.model : DETERMINISTIC_MODEL,
      promptVersion: usedModel ? providerResult.promptVersion : this.promptVersion,
      inputTokens: usedModel ? providerResult.inputTokens : 0,
      outputTokens: usedModel
        ? providerResult.outputTokens
        : estimateTokens(JSON.stringify(output)),
      thinkingMode: usedModel ? (providerResult.thinkingMode ?? 'unset') : 'unset',
      usageEstimated: usedModel ? providerResult.usageEstimated === true : false,
      skillAudits: [
        {
          skillId: TRAINING_ROLEPLAY_ANSWER.skillId,
          skillVersion: TRAINING_ROLEPLAY_ANSWER.skillVersion,
          durationMs,
          success,
        },
        {
          skillId: TRAINING_COACHING_NEXT_HINT.skillId,
          skillVersion: TRAINING_COACHING_NEXT_HINT.skillVersion,
          durationMs,
          success,
        },
      ],
    };
  }

  private buildFeedbackResult(
    output: TrainingFeedbackOutput,
    providerResult: AiInvokeResult | null,
    success: boolean,
    startedAt: number,
  ): TrainingRuntimeResult {
    const durationMs = Date.now() - startedAt;
    const usedModel = providerResult !== null;
    return {
      output,
      provider: usedModel ? providerResult.provider : DETERMINISTIC_PROVIDER,
      model: usedModel ? providerResult.model : DETERMINISTIC_MODEL,
      promptVersion: usedModel ? providerResult.promptVersion : this.promptVersion,
      inputTokens: usedModel ? providerResult.inputTokens : 0,
      outputTokens: usedModel
        ? providerResult.outputTokens
        : estimateTokens(JSON.stringify(output)),
      thinkingMode: usedModel ? (providerResult.thinkingMode ?? 'unset') : 'unset',
      usageEstimated: usedModel ? providerResult.usageEstimated === true : false,
      skillAudits: [
        {
          skillId: TRAINING_STRUCTURING_COVERAGE_UPDATE.skillId,
          skillVersion: TRAINING_STRUCTURING_COVERAGE_UPDATE.skillVersion,
          durationMs,
          success,
        },
        {
          skillId: TRAINING_COMPOSITION_FEEDBACK_REPORT.skillId,
          skillVersion: TRAINING_COMPOSITION_FEEDBACK_REPORT.skillVersion,
          durationMs,
          success,
        },
      ],
    };
  }
}
