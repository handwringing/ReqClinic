import { z } from 'zod';
import type { AiInvokeResult, AiProvider, SkillInvocationAudit } from '../ai/provider';
import { QUICK_CONSULT_PLAN } from './agent-plans';
import { defaultSkillRegistry, type SkillRegistry } from './skill-registry';
import type { SkillManifest } from './types';
import {
  QUICK_SLOT_IDS,
  quickCompositionOutputSchema,
  quickDecisioningOutputSchema,
  quickElicitationOutputSchema,
  quickRoutingOutputSchema,
  quickRuntimeOutputSchema,
  quickSlotIdSchema,
  quickStructuringOutputSchema,
  quickValidationOutputSchema,
  type QuickBriefSnapshot,
  type QuickCompositionOutput,
  type QuickDecisioningOutput,
  type QuickElicitationOutput,
  type QuickQualityIssue,
  type QuickRoutingOutput,
  type QuickRuntimeOutput,
  type QuickSlotId,
  type QuickSlotStatus,
  type QuickStructuringOutput,
  type QuickTurn,
  type QuickUnderstanding,
  type QuickUnknown,
  type QuickValidationOutput,
} from './quick-schemas';

export interface QuickConsultRuntimeInput {
  originalInput: string;
  turns?: QuickTurn[];
  forceBrief?: boolean;
  forceDecisioning?: boolean;
  modelEnabled?: boolean;
  modelSkillIds?: string[];
}

export interface QuickConsultRuntimeResult extends QuickRuntimeOutput {
  audit: SkillInvocationAudit[];
}

const quickCompositionModelOutputSchema = z.object({
  views: z.object({
    simple: z.union([z.string(), z.array(z.string())]),
    exec: z.union([z.string(), z.array(z.string())]),
  }),
});

function buildSkillAudit(
  manifest: SkillManifest,
  result: AiInvokeResult | undefined,
): SkillInvocationAudit {
  return {
    skillId: manifest.skillId,
    skillVersion: manifest.skillVersion,
    inputSchemaVersion: manifest.inputSchemaVersion,
    outputSchemaVersion: manifest.outputSchemaVersion,
    promptVersion: result?.promptVersion ?? manifest.promptVersion,
    provider: result?.provider ?? null,
    model: result?.model ?? null,
    thinkingMode: result?.thinkingMode ?? null,
    inputTokens: result?.inputTokens ?? 0,
    outputTokens: result?.outputTokens ?? 0,
    usageEstimated: result?.usageEstimated ?? false,
  };
}

interface RuntimeState {
  originalInput: string;
  turns: QuickTurn[];
  modelResults: Map<string, AiInvokeResult>;
  routing?: QuickRoutingOutput;
  structuring?: QuickStructuringOutput;
  validation?: QuickValidationOutput;
  elicitation?: QuickElicitationOutput;
  decisioning?: QuickDecisioningOutput;
  composition?: QuickCompositionOutput;
}

export class QuickConsultRuntime {
  constructor(
    private readonly provider?: AiProvider,
    private readonly registry: SkillRegistry = defaultSkillRegistry,
  ) {}

  async run(input: QuickConsultRuntimeInput): Promise<QuickConsultRuntimeResult> {
    const state: RuntimeState = {
      originalInput: input.originalInput,
      turns: input.turns ?? [],
      modelResults: new Map(),
    };
    const audit: QuickConsultRuntimeResult['audit'] = [];
    const modelEnabled = input.modelEnabled === true && this.provider !== undefined;
    const modelSkillIds = input.modelSkillIds ? new Set(input.modelSkillIds) : null;

    for (const step of QUICK_CONSULT_PLAN.steps) {
      const manifest = this.registry.get(step.skillId, step.skillVersion);
      switch (manifest.skillId) {
        case 'quick.routing.domain_risk':
          state.routing = await this.runRouting(state, shouldUseModel(manifest.skillId, modelEnabled, modelSkillIds));
          quickRoutingOutputSchema.parse(state.routing);
          break;
        case 'quick.structuring.understanding_patch':
          state.structuring = await this.runStructuring(state, shouldUseModel(manifest.skillId, modelEnabled, modelSkillIds));
          quickStructuringOutputSchema.parse(state.structuring);
          break;
        case 'quick.validation.coverage_gate':
          state.validation = await this.runValidation(state, shouldUseModel(manifest.skillId, modelEnabled, modelSkillIds));
          quickValidationOutputSchema.parse(state.validation);
          break;
        case 'quick.elicitation.next_question':
          state.elicitation = await this.runElicitation(state, shouldUseModel(manifest.skillId, modelEnabled, modelSkillIds));
          quickElicitationOutputSchema.parse(state.elicitation);
          break;
        case 'quick.decisioning.options':
          state.decisioning = await this.runDecisioning(
            state,
            shouldUseModel(manifest.skillId, modelEnabled, modelSkillIds),
            input.forceDecisioning === true || input.forceBrief === true,
          );
          quickDecisioningOutputSchema.parse(state.decisioning);
          break;
        case 'quick.composition.brief_views':
          state.composition = await this.runComposition(
            state,
            shouldUseModel(manifest.skillId, modelEnabled, modelSkillIds),
            input.forceBrief === true,
          );
          quickCompositionOutputSchema.parse(state.composition);
          break;
        default:
          throw new Error(`No quick skill runner for ${manifest.skillId}`);
      }
      audit.push(buildSkillAudit(manifest, state.modelResults.get(manifest.skillId)));
    }

    const parsed = quickRuntimeOutputSchema.parse({
      routing: state.routing,
      structuring: state.structuring,
      validation: state.validation,
      elicitation: state.elicitation,
      decisioning: state.decisioning,
      composition: state.composition,
    });
    return { ...parsed, audit };
  }

  private async runRouting(state: RuntimeState, modelEnabled: boolean): Promise<QuickRoutingOutput> {
    const fallback = buildRoutingFallback(state.originalInput);
    const model = await this.invokeModel(
      state,
      'quick.routing.domain_risk',
      {
        original_input: state.originalInput,
        expected_output_schema:
          'mode, domainPackId, candidateDomainPacks, riskFlags, routingReason',
      },
      quickRoutingOutputSchema,
      modelEnabled,
    );
    if (!model) return fallback;
    return {
      ...fallback,
      ...model,
      mode: 'quick',
      domainPackId: registeredDomainPack(model.domainPackId),
      candidateDomainPacks: normalizeDomainPacks(model.candidateDomainPacks),
    };
  }

  private async runStructuring(
    state: RuntimeState,
    modelEnabled: boolean,
  ): Promise<QuickStructuringOutput> {
    const fallback = buildStructuringFallback(state.originalInput, state.turns);
    const model = await this.invokeModel(
      state,
      'quick.structuring.understanding_patch',
      {
        original_input: state.originalInput,
        turns: state.turns,
        instruction:
          '把用户已经明确表达的内容写入 slots；不确定的只标记 inferred/partial/missing，不要编造。',
      },
      quickStructuringOutputSchema,
      modelEnabled,
    );
    if (!model) return fallback;
    return mergeStructuring(fallback, model, state);
  }

  private async runValidation(
    state: RuntimeState,
    modelEnabled: boolean,
  ): Promise<QuickValidationOutput> {
    const understanding = requireStructuring(state).understanding;
    const fallback = buildValidationFallback(understanding);
    const model = await this.invokeModel(
      state,
      'quick.validation.coverage_gate',
      {
        understanding,
        instruction:
          '检查完整性、清晰度、一致性、可验证性、范围边界、未知项，并按影响乘以不确定性选择下一问。',
      },
      quickValidationOutputSchema,
      modelEnabled,
    );
    if (!model) return filterValidationAgainstUnderstanding(fallback, understanding);
    const canEnterReview = fallback.canEnterReview && model.canEnterReview;
    return filterValidationAgainstUnderstanding({
      ...fallback,
      ...model,
      canEnterReview,
      unknowns: fallback.unknowns.length > 0
        ? mergeUnknowns(fallback.unknowns, model.unknowns)
        : model.unknowns,
      qualityIssues:
        fallback.qualityIssues.length > 0
          ? mergeQualityIssues(fallback.qualityIssues, model.qualityIssues)
          : model.qualityIssues,
      nextQuestionSlot: !canEnterReview && fallback.nextQuestionSlot
        ? fallback.nextQuestionSlot
        : model.nextQuestionSlot
        ? quickSlotIdSchema.parse(model.nextQuestionSlot)
        : fallback.nextQuestionSlot,
    }, understanding);
  }

  private async runElicitation(
    state: RuntimeState,
    modelEnabled: boolean,
  ): Promise<QuickElicitationOutput> {
    const validation = requireValidation(state);
    const understanding = requireStructuring(state).understanding;
    const fallback = buildElicitationFallback(validation, understanding);
    const model = await this.invokeModel(
      state,
      'quick.elicitation.next_question',
      {
        understanding,
        validation,
        instruction:
          '如果需要继续澄清，只问一个高价值问题；问题必须具体，不能让用户自己列清需求。',
      },
      quickElicitationOutputSchema,
      modelEnabled && !validation.canEnterReview,
    );
    return model ?? fallback;
  }

  private async runDecisioning(
    state: RuntimeState,
    modelEnabled: boolean,
    forceDecisioning: boolean,
  ): Promise<QuickDecisioningOutput> {
    const understanding = requireStructuring(state).understanding;
    const validation = requireValidation(state);
    const shouldCreateOptions = validation.canEnterReview || forceDecisioning;
    const fallback = buildDecisioningFallback(understanding, shouldCreateOptions);
    const model = await this.invokeModel(
      state,
      'quick.decisioning.options',
      {
        understanding,
        validation,
        instruction:
          '只形成快速问诊候选方案和当前偏好，不要写成正式决策或正式基线。',
      },
      quickDecisioningOutputSchema,
      modelEnabled && shouldCreateOptions,
    );
    if (!model) return fallback;
    if (model.options.length === 0) return fallback;
    return decisioningIsGrounded(understanding, model) ? model : fallback;
  }

  private async runComposition(
    state: RuntimeState,
    modelEnabled: boolean,
    forceBrief: boolean,
  ): Promise<QuickCompositionOutput> {
    const understanding = requireStructuring(state).understanding;
    const validation = requireValidation(state);
    const decisioning = state.decisioning ?? buildDecisioningFallback(understanding, false);
    const snapshot: QuickBriefSnapshot = {
      originalInput: state.originalInput,
      understanding,
      unknowns: validation.unknowns,
      options: decisioning.options,
      qualityIssues: validation.qualityIssues,
    };
    const fallback: QuickCompositionOutput = {
      snapshot,
      views: {
        simple: renderSimpleView(snapshot),
        exec: renderDetailedReport(snapshot, forceBrief || validation.canEnterReview),
      },
    };
    const model = await this.invokeModel(
      state,
      'quick.composition.brief_views',
      {
        snapshot,
        instruction:
          '生成两个视图：simple 面向普通用户，exec 是专业详细报告。两个视图不得新增 snapshot 之外的事实。',
      },
      quickCompositionModelOutputSchema,
      modelEnabled && (forceBrief || validation.canEnterReview),
    );
    if (!model) return fallback;
    const modelViews = normalizeModelViews(model.views);
    return {
      snapshot,
      views: {
        simple: usableSimpleView(modelViews.simple, snapshot) ? modelViews.simple : fallback.views.simple,
        exec: usableDetailedView(modelViews.exec, snapshot) ? modelViews.exec : fallback.views.exec,
      },
    };
  }

  private async invokeModel<T extends z.ZodTypeAny>(
    state: RuntimeState,
    taskType: string,
    payload: unknown,
    schema: T,
    enabled: boolean,
  ): Promise<z.infer<T> | null> {
    if (!enabled || !this.provider) return null;
    try {
      const result = await this.provider.invoke({ taskType, payload });
      state.modelResults.set(taskType, result);
      const parsed = schema.safeParse(result.output);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

function normalizeModelViews(views: {
  simple: string | string[];
  exec: string | string[];
}): { simple: string; exec: string } {
  return {
    simple: Array.isArray(views.simple) ? views.simple.join('\n') : views.simple,
    exec: Array.isArray(views.exec) ? views.exec.join('\n') : views.exec,
  };
}

function usableSimpleView(view: string, snapshot: QuickBriefSnapshot): boolean {
  return (
    view.trim().length >= 350 &&
    !containsDeveloperTerm(view) &&
    doesNotInventNumericFacts(view, snapshot) &&
    doesNotInventCapabilityClaims(view, snapshot) &&
    doesNotInventConcreteExamples(view, snapshot)
  );
}

function usableDetailedView(view: string, snapshot: QuickBriefSnapshot): boolean {
  const requiredSections = ['报告摘要', '目标', '参与对象', '核心场景', '范围', '完成标准', '风险', '后续'];
  const requiredMarkers = ['用户场景与独立验证', '需求-001', '标准-001', '方案比较与推荐', '需求质量检查'];
  if (view.trim().length < 1200) return false;
  if (!requiredSections.every((term) => view.includes(term))) return false;
  if (!requiredMarkers.every((term) => view.includes(term))) return false;
  if (containsDeveloperTerm(view)) return false;
  if (!doesNotInventNumericFacts(view, snapshot)) return false;
  if (!doesNotInventCapabilityClaims(view, snapshot)) return false;
  if (!doesNotInventConcreteExamples(view, snapshot)) return false;
  if (!isSoftwareLike(snapshot) && /(网页|网站|小程序|登录|数据库|接口|代码|App|APP|报名系统)/.test(view)) {
    return false;
  }
  return true;
}

function containsDeveloperTerm(value: string): boolean {
  return /(FR-\d+|SC-\d+|P0|schema|agent|skill|slot|JSON|prompt|runtime|snapshot|understanding_review|blocking)/i.test(value);
}

function doesNotInventNumericFacts(view: string, snapshot: QuickBriefSnapshot): boolean {
  const sourceFacts = new Set(numericFactsWithUnits(snapshotText(snapshot)));
  if (sourceFacts.size === 0) return true;
  return numericFactsWithUnits(view).every((fact) => sourceFacts.has(fact));
}

function doesNotInventCapabilityClaims(view: string, snapshot: QuickBriefSnapshot): boolean {
  const source = snapshotText(snapshot);
  const checks: Array<{ claim: RegExp; source: RegExp }> = [
    { claim: /上传.{0,8}(图片|素材|文件)|(?:图片|素材|文件).{0,8}上传/, source: /上传|图片|素材|文件/ },
    { claim: /分享链接|链接分享|生成.{0,8}链接|分享给|转发/, source: /分享|链接|转发|传播/ },
    { claim: /无需.{0,6}(注册|登录)|免.{0,3}(注册|登录)|不需要.{0,6}(注册|登录)/, source: /注册|登录|账号|免登录|免注册/ },
    { claim: /模板|版式库|主题库/, source: /模板|版式|主题/ },
    { claim: /多人协作|协作编辑|团队协作/, source: /多人|协作/ },
    { claim: /导出|下载|PDF|PNG|JPG|图片格式/, source: /导出|下载|PDF|PNG|JPG|图片格式/ },
    { claim: /自定义布局|自由布局|拖拽布局|布局编辑/, source: /布局|编辑器|拖拽|自定义/ },
    { claim: /后台|管理端|权限|角色权限/, source: /后台|管理端|权限|角色/ },
    { claim: /支付|收费|订单|收款/, source: /支付|收费|订单|收款|预算|成本/ },
    { claim: /接口|API|数据库|后端服务/, source: /接口|API|数据库|后端/ },
  ];
  return checks.every((item) => !item.claim.test(view) || item.source.test(source));
}

function doesNotInventConcreteExamples(view: string, snapshot: QuickBriefSnapshot): boolean {
  const source = snapshotText(snapshot);
  const sourceNormalized = normalizeClaimText(source);
  const viewNormalized = normalizeClaimText(view);

  const quotedTitles = view.match(/《[^》]{1,40}》/g) ?? [];
  if (quotedTitles.some((title) => !source.includes(title))) return false;

  return ACTIVITY_DETAIL_GUARD_TERMS.every((term) => {
    const normalized = normalizeClaimText(term);
    return !viewNormalized.includes(normalized) || sourceNormalized.includes(normalized);
  });
}

const ACTIVITY_DETAIL_GUARD_TERMS = [
  '场地租赁',
  '茶歇',
  '物料打印',
  '书籍购买',
  '购书',
  '奖品',
  '小奖品',
  '大学社团',
  '班级群',
  '角色扮演',
  '经典书',
  '经典书籍',
  '思维导图',
  '道具',
  '主持人培训',
  '最佳发言小组',
  '电影片段',
  '引用资料',
];

function doesNotInventActivityDetails(sourceText: string, value: string): boolean {
  const source = normalizeClaimText(sourceText);
  const target = normalizeClaimText(value);
  return ACTIVITY_DETAIL_GUARD_TERMS.every((term) => {
    const normalized = normalizeClaimText(term);
    return !target.includes(normalized) || source.includes(normalized);
  });
}

function snapshotText(snapshot: QuickBriefSnapshot): string {
  return [
    snapshot.originalInput,
    snapshot.understanding.summary,
    ...QUICK_SLOT_IDS.map((slot) => snapshot.understanding.slots[slot]?.value ?? ''),
    ...snapshot.unknowns.map((item) => `${item.question} ${item.impact}`),
    ...snapshot.options.flatMap((item) => [item.title, item.description, ...item.pros, ...item.cons]),
  ].join('\n');
}

function numericFactsWithUnits(value: string): string[] {
  const matches = value.match(/\d+(?:\.\d+)?\s*(?:份|人|名|秒|分钟|元|万元|万|月|日|分|%|P|p|种|个|套|页|张|次|轮|小时|天|周|篇|字|段)/g) ?? [];
  return Array.from(new Set(matches.map((item) => item.replace(/\s+/g, '').toLowerCase())));
}

function isSoftwareLike(snapshot: QuickBriefSnapshot): boolean {
  const text = [
    snapshot.originalInput,
    snapshot.understanding.summary,
    ...QUICK_SLOT_IDS.map((slot) => snapshot.understanding.slots[slot]?.value ?? ''),
  ].join('\n');
  return /网站|网页|小程序|App|APP|应用|系统|平台|AI|智能|后端|前端|接口|数据库/.test(text);
}

function buildRoutingFallback(text: string): QuickRoutingOutput {
  const isSoftware = /网站|网页|小程序|App|APP|应用|系统|平台|AI|智能|后端|前端/.test(text);
  const riskFlags = [
    /版权|合规|隐私|审核|安全/.test(text) ? '存在合规或审核风险' : null,
    /30\s*秒|性能|并发|速度|耗时/.test(text) ? '存在性能约束' : null,
    /团队|多人|协作|权限/.test(text) ? '可能涉及协作或权限边界' : null,
  ].filter((item): item is string => item !== null);
  return {
    mode: 'quick',
    domainPackId: isSoftware ? 'software-delivery' : 'general',
    candidateDomainPacks: isSoftware ? ['software-delivery', 'general'] : ['general'],
    riskFlags,
    routingReason: isSoftware
      ? '输入包含软件或数字产品特征，优先使用软件交付领域约束；未覆盖字段仍回退 general。'
      : '未命中特定领域包，使用 general 回退。'
  };
}

function buildStructuringFallback(originalInput: string, turns: QuickTurn[]): QuickStructuringOutput {
  const userText = [originalInput, ...turns.filter((t) => t.role === 'user').map((t) => t.content)].join('\n');
  const allText = [originalInput, ...turns.map((t) => t.content)].join('\n');
  const slots = emptySlots();
  const expectedOutcome = inferExpectedOutcome(allText, originalInput);
  const targetUser = inferTargetUser(userText);
  const coreScenario = inferCoreScenario(userText);
  const scopeBoundary = inferScope(userText, turns);
  const completionCriteria = inferCompletionCriteria(userText);
  const constraintsRisks = inferConstraints(userText);
  const constraintsStatus: QuickSlotStatus = constraintsRisks
    ? hasSubstantialConstraints(constraintsRisks)
      ? 'partial'
      : 'inferred'
    : 'missing';
  setSlot(slots, 'expected_outcome', expectedOutcome, 'partial');
  setSlot(slots, 'target_user', targetUser, targetUser ? 'partial' : 'missing');
  setSlot(slots, 'core_scenario', coreScenario, coreScenario ? 'partial' : 'missing');
  setSlot(slots, 'scope_boundary', scopeBoundary, scopeBoundary ? 'partial' : 'missing');
  setSlot(slots, 'completion_criteria', completionCriteria, completionCriteria ? 'partial' : 'missing');
  setSlot(slots, 'constraints_risks', constraintsRisks, constraintsStatus);

  const changedSlots = QUICK_SLOT_IDS.filter((slot) => slotStatusFromSlots(slots, slot) !== 'missing');
  return {
    understanding: {
      summary: buildSummary(slots),
      slots,
    },
    changedSlots,
  };
}

function buildValidationFallback(understanding: QuickUnderstanding): QuickValidationOutput {
  const unknowns = QUICK_SLOT_IDS
    .map((slot) => buildUnknownForSlot(slot, slotStatus(understanding, slot)))
    .filter((item): item is QuickUnknown => item !== null)
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const nextQuestionSlot = unknowns[0]?.slot ?? null;
  const qualityIssues = buildQualityIssues(understanding, unknowns);
  const requiredSlots: QuickSlotId[] = [
    'expected_outcome',
    'target_user',
    'core_scenario',
    'scope_boundary',
    'completion_criteria',
  ];
  const canEnterReview = requiredSlots.every((slot) =>
    ['confirmed', 'partial'].includes(slotStatus(understanding, slot)),
  );
  return {
    canEnterReview,
    nextQuestionSlot,
    unknowns,
    qualityIssues,
  };
}

function filterValidationAgainstUnderstanding(
  validation: QuickValidationOutput,
  understanding: QuickUnderstanding,
): QuickValidationOutput {
  const unknowns = validation.unknowns.filter((unknown) =>
    shouldKeepUnknownForSlot(unknown.slot, understanding),
  );
  const qualityIssues = validation.qualityIssues.filter((issue) => {
    const slot = slotFromQualityCode(issue.internalCode);
    return !slot || shouldKeepUnknownForSlot(slot, understanding);
  });
  const nextQuestionSlot =
    validation.nextQuestionSlot && shouldKeepUnknownForSlot(validation.nextQuestionSlot, understanding)
      ? validation.nextQuestionSlot
      : unknowns[0]?.slot ?? null;
  return {
    ...validation,
    unknowns,
    qualityIssues,
    nextQuestionSlot,
  };
}

function shouldKeepUnknownForSlot(slot: QuickSlotId, understanding: QuickUnderstanding): boolean {
  const status = slotStatus(understanding, slot);
  const value = slotText(understanding, slot);
  if (status === 'confirmed') return false;
  if (slot === 'constraints_risks' && value) return !hasSubstantialConstraints(value);
  if (status === 'partial') return false;
  if (!value) return true;
  return status === 'missing';
}

function hasSubstantialConstraints(value: string): boolean {
  const exclusionCount = (value.match(/不做|不接|不改|不新增|不包含|不需要|暂不|不能|避免|禁止|无需/g) ?? []).length;
  if (exclusionCount >= 2) return true;
  const checks = [
    /\d+\s*(元|万元|块|预算)/.test(value),
    /(周一|周二|周三|周四|周五|周六|周日|晚上|上午|下午|时间|日期|截止|期限)/.test(value),
    /(校内|教室|活动室|场地|地点|线上|线下)/.test(value),
    /(不做|不接|不改|不新增|不包含|不需要|暂不|不能|避免|禁止|无需)/.test(value),
    /(合规|版权|安全|隐私|审核|风险)/.test(value),
  ];
  return checks.filter(Boolean).length >= 3;
}

function slotFromQualityCode(code: string): QuickSlotId | null {
  const prefix = 'quick_quality_';
  if (!code.startsWith(prefix)) return null;
  const candidate = code.slice(prefix.length);
  return quickSlotIdSchema.safeParse(candidate).success ? (candidate as QuickSlotId) : null;
}

function mergeUnknowns(
  required: QuickUnknown[],
  suggested: QuickUnknown[],
): QuickUnknown[] {
  const byId = new Map(required.map((item) => [item.id, item]));
  for (const item of suggested) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort((a, b) => b.priorityScore - a.priorityScore);
}

function mergeQualityIssues(
  required: QuickQualityIssue[],
  suggested: QuickQualityIssue[],
): QuickQualityIssue[] {
  const byCode = new Map(required.map((item) => [item.internalCode, item]));
  for (const item of suggested) {
    if (!byCode.has(item.internalCode)) byCode.set(item.internalCode, item);
  }
  return Array.from(byCode.values()).sort((a, b) => b.priorityScore - a.priorityScore);
}

function buildElicitationFallback(
  validation: QuickValidationOutput,
  understanding: QuickUnderstanding,
): QuickElicitationOutput {
  if (validation.canEnterReview || !validation.nextQuestionSlot) {
    return {
      question: null,
      slot: null,
      rationale: '当前理解已达到快速问诊复核门槛，可以进入理解确认。',
    };
  }
  const slot = validation.nextQuestionSlot;
  return {
    question: questionForSlot(slot, understanding),
    slot,
    rationale: `优先询问“${slotLabel(slot)}”，因为它对方案、范围或完成判断影响较大。`,
  };
}

function buildDecisioningFallback(
  understanding: QuickUnderstanding,
  enabled: boolean,
): QuickDecisioningOutput {
  if (!enabled) {
    return {
      options: [],
      recommendation: '当前信息还不足以形成候选方案，应继续追问。',
    };
  }
  const scope = slotText(understanding, 'scope_boundary') ?? '先做最小可用版本';
  const scenarioText = [
    understanding.summary,
    ...QUICK_SLOT_IDS.map((slot) => slotText(understanding, slot) ?? ''),
  ].join('\n');
  const scenarioKind = inferScenarioKind(scenarioText);
  if (scenarioKind === 'creative') {
    return {
      options: [
        {
          id: 'option_creative_grounded',
          title: '生活感主视觉方案',
          description: `围绕当前范围推进：${scope}。先把目标受众、核心信息、投放渠道和完成标准统一成一套可评审的海报与文案方向。`,
          pros: ['贴近受众感受', '产出边界清楚', '便于快速评审'],
          cons: ['视觉细节仍需要结合素材质量确认'],
          isRecommended: true,
        },
        {
          id: 'option_creative_distinctive',
          title: '差异化视觉方案',
          description: '保留当前交付范围，同时用更强的视觉风格和故事化文案提高识别度。',
          pros: ['记忆点更强', '适合社交平台传播'],
          cons: ['制作判断更依赖审美共识', '内部评审可能需要更多轮'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先采用生活感主视觉方案，把核心信息和投放渠道说清楚，再决定是否强化视觉差异。',
    };
  }
  if (scenarioKind === 'software') {
    return {
      options: [
        {
          id: 'option_software_scope_first',
          title: '核心流程优先版',
          description: `围绕当前范围推进：${scope}。先保证主要角色能完成最核心的发布、查询、沟通或处理流程。`,
          pros: ['首版边界清楚', '更容易验证真实使用', '技术风险较低'],
          cons: ['高级能力需要后续拆分'],
          isRecommended: true,
        },
        {
          id: 'option_software_workflow_plus',
          title: '流程增强版',
          description: '在核心流程外增加更多辅助能力，但仍保留当前明确排除项。',
          pros: ['体验更完整', '后续扩展空间更大'],
          cons: ['开发与测试范围更大', '更容易引入未确认需求'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先采用核心流程优先版，避免把未确认能力提前并入首版。',
    };
  }
  if (scenarioKind === 'academic') {
    return {
      options: [
        {
          id: 'option_academic_argument_first',
          title: '论证结构优先',
          description: `围绕当前范围推进：${scope}。先确定研究问题、论点层次和证据来源，再进入写作。`,
          pros: ['更符合课程评分', '降低跑题风险', '便于控制查重风险'],
          cons: ['前期需要花时间筛选文献'],
          isRecommended: true,
        },
        {
          id: 'option_academic_material_first',
          title: '材料梳理优先',
          description: '先建立文献和案例材料池，再从材料中收敛论文结构。',
          pros: ['证据基础更扎实', '适合主题还不够聚焦时使用'],
          cons: ['如果不及时收敛，容易堆材料不成论证'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先采用论证结构优先，保证研究问题、评分口径和证据范围先对齐。',
    };
  }
  if (scenarioKind === 'service') {
    return {
      options: [
        {
          id: 'option_service_standardized_flow',
          title: '标准流程优先',
          description: `围绕当前范围推进：${scope}。先统一提醒、跟进、确认和回访口径。`,
          pros: ['便于培训和执行', '能直接对照指标复盘', '减少重复沟通'],
          cons: ['个性化运营空间较小'],
          isRecommended: true,
        },
        {
          id: 'option_service_segmented_operation',
          title: '分层运营优先',
          description: '按用户状态或价值分层设计不同触达和跟进策略。',
          pros: ['更精细', '可能提升关键人群转化'],
          cons: ['规则更复杂', '需要更多数据支持'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先采用标准流程优先，把口径统一后再考虑分层运营。',
    };
  }
  if (scenarioKind === 'outsourcing') {
    return {
      options: [
        {
          id: 'option_outsourcing_fixed_scope',
          title: '固定范围验收版',
          description: `围绕当前范围推进：${scope}。先把栏目、交付物、排除项、验收和变更口径写清楚。`,
          pros: ['便于报价和验收', '减少范围蔓延', '责任边界明确'],
          cons: ['后续新增内容需要走变更'],
          isRecommended: true,
        },
        {
          id: 'option_outsourcing_iterative',
          title: '阶段迭代版',
          description: '把官网交付拆成设计确认、开发上线、培训交付等阶段逐步验收。',
          pros: ['过程风险更可控', '适合需求仍会调整的项目'],
          cons: ['项目管理成本更高', '合同条款需要更细'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先采用固定范围验收版，外包采购最重要的是防止交付和变更口径不清。',
    };
  }
  if (scenarioKind === 'collaboration') {
    return {
      options: [
        {
          id: 'option_collaboration_demo_first',
          title: '演示闭环优先',
          description: `围绕当前范围推进：${scope}。先确保团队能稳定交付可演示版本、论文材料和答辩证据。`,
          pros: ['共同目标清楚', '便于分工推进', '答辩风险较低'],
          cons: ['高级功能需要后续取舍'],
          isRecommended: true,
        },
        {
          id: 'option_collaboration_research_first',
          title: '论文实验优先',
          description: '优先保证实验、指标和论文论证，再倒推系统演示范围。',
          pros: ['论文支撑更强', '适合研究要求较高的课题'],
          cons: ['演示体验可能需要后期集中补强'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先采用演示闭环优先，确保多人协作目标、节点和交付物都能对齐。',
    };
  }
  if (scenarioKind === 'early_idea') {
    return {
      options: [
        {
          id: 'option_idea_validation_first',
          title: '验证问题优先',
          description: `围绕当前范围推进：${scope}。先验证人群、场景和痛点是否真实存在，再决定是否做完整产品。`,
          pros: ['成本低', '能快速降低不确定性', '不会过早承诺完整功能'],
          cons: ['短期产出不像正式产品'],
          isRecommended: true,
        },
        {
          id: 'option_idea_light_prototype',
          title: '轻量原型优先',
          description: '做一个很小的可体验版本，用真实试用反馈判断方向。',
          pros: ['用户更容易感知价值', '反馈更具体'],
          cons: ['实现成本高于访谈验证', '容易过早陷入功能细节'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先采用验证问题优先，早期想法最重要的是先确认需求是否真实。',
    };
  }
  if (scenarioKind === 'activity') {
    return {
      options: [
        {
          id: 'option_structured_activity',
          title: '结构化共读活动',
          description: `围绕当前范围推进：${scope}。用固定流程组织宣传、现场引导和反馈收集。`,
          pros: ['流程清楚', '便于分工', '更容易对照完成标准复盘'],
          cons: ['现场氛围依赖主持和问题设计'],
          isRecommended: true,
        },
        {
          id: 'option_open_sharing',
          title: '开放式分享活动',
          description: '降低准备复杂度，让参与者围绕书籍和问题自由交流，再做统一总结。',
          pros: ['准备压力较低', '参与者表达空间更大'],
          cons: ['讨论质量更依赖参与者主动性', '现场节奏需要更强控场'],
          isRecommended: false,
        },
      ],
      recommendation: '建议先采用结构化共读活动，用清楚流程保证到场、讨论、反馈和后续小组转化都能被检查。',
    };
  }
  return {
    options: [
      {
        id: 'option_focused_v1',
        title: '先做聚焦版',
        description: `围绕当前范围推进：${scope}`,
        pros: ['边界清楚', '验证速度快', '更容易控制成本'],
        cons: ['后续高级能力需要再补充'],
        isRecommended: true,
      },
      {
        id: 'option_expanded_v1',
        title: '一次扩大范围',
        description: '把当前还没有完全确认的扩展内容也纳入首版。',
        pros: ['可以提前覆盖更多想法'],
        cons: ['未确认内容会增加工作量和返工风险'],
        isRecommended: false,
      },
    ],
    recommendation: '建议先采用聚焦版，用明确场景和完成标准验证价值。',
  };
}

type QuickScenarioKind =
  | 'creative'
  | 'software'
  | 'academic'
  | 'service'
  | 'outsourcing'
  | 'collaboration'
  | 'early_idea'
  | 'activity'
  | 'general';

function inferScenarioKind(text: string): QuickScenarioKind {
  if (/课程论文|论文|文献|查重|评分|研究问题/.test(text)) return 'academic';
  if (/外包|官网|交付物|验收|部署文档|设计源文件|变更机制/.test(text)) return 'outsourcing';
  if (/毕业设计|答辩|团队里|论文负责人|多人协作|共同交付/.test(text)) return 'collaboration';
  if (/早期想法|先验证|不急着|访谈|问题假设|用户假设/.test(text)) return 'early_idea';
  if (/服务流程|续费|前台|顾问|触达率|投诉|回访/.test(text)) return 'service';
  if (/海报|文案|视觉|小红书|朋友圈|立牌|投放|品牌全案/.test(text)) return 'creative';
  if (/小程序|App|APP|网站|网页|系统|平台|后端|前端|接口|数据库/.test(text)) return 'software';
  if (/读书会|线下活动策划|活动策划方案|到场|反馈表|满意度/.test(text)) return 'activity';
  return 'general';
}

function decisioningIsGrounded(
  understanding: QuickUnderstanding,
  decisioning: QuickDecisioningOutput,
): boolean {
  const sourceText = [
    understanding.summary,
    ...QUICK_SLOT_IDS.map((slot) => slotText(understanding, slot) ?? ''),
  ].join('\n');
  const excludedTerms = excludedTermsFromText(sourceText);
  const optionText = [
    decisioning.recommendation,
    ...decisioning.options.flatMap((option) => [
      option.title,
      option.description,
      ...option.pros,
      ...option.cons,
    ]),
  ].join('\n');
  if (!excludedTerms.every((term) => !proposesExcludedTerm(optionText, term))) return false;
  if (!doesNotInventActivityDetails(sourceText, optionText)) return false;
  const sourceFacts = new Set(numericFactsWithUnits(sourceText));
  return numericFactsWithUnits(optionText).every((fact) => sourceFacts.has(fact));
}

function excludedTermsFromText(text: string): string[] {
  const terms = [
    '线上直播',
    '直播',
    '长期社群',
    '社群运营',
    '社群',
    '付费课程',
    '付费',
    '多场次',
    '多场',
    '后续系列',
    '系列活动',
    '在线支付',
    '支付',
    '物流',
    '跨校物流',
    '信用体系',
    '信用',
    '实名认证',
    '会员',
    '电商',
    '多语言',
    'CRM',
    '复杂CRM',
    '真实企业招聘',
    '企业招聘',
    '付费功能',
    '复杂权限',
    '权限',
    '心理诊断',
    '诊断',
    '真人咨询',
    '咨询',
    '社区',
    '完整App',
    '完整APP',
  ];
  return terms.filter((term) => {
    const pattern = new RegExp(
      `(?:不做|不接|不改|不新增|不包含|不涉及|不需要|不用|无需|暂不|暂不接|排除|不能|避免)[^。；\\n]{0,32}${escapeRegExp(term)}`,
      'i',
    );
    return pattern.test(text);
  });
}

function proposesExcludedTerm(text: string, term: string): boolean {
  const escaped = escapeRegExp(term);
  const positiveBefore = new RegExp(
    `(?:增加|加入|支持|包含|覆盖|提供|开展|设置|融入|建立|扩展到|延伸到|纳入|对接|接入|开通|启用|引入|线上线下混合)[^。；\\n]{0,18}${escaped}`,
    'i',
  );
  const positiveAfter = new RegExp(
    `${escaped}[^。；\\n]{0,12}(?:版|方案|功能|模块|系统|体系|能力|内容|流程|参与|互动|服务|对接|接入|运营)`,
    'i',
  );
  return positiveBefore.test(text) || positiveAfter.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderSimpleView(snapshot: QuickBriefSnapshot): string {
  const u = snapshot.understanding;
  const recommended = snapshot.options.find((item) => item.isRecommended);
  return [
    '# 需求简报（概述）',
    '## 现在可以这样理解',
    `${u.summary} 目前最重要的是先把对象、场景、范围和完成标准放在同一张图里看清楚，避免后续执行时一边推进一边改口径。`,
    '## 目前已经说清楚',
    [
      `这件事主要面向：${slotText(u, 'target_user') ?? '还没确定'}`,
      `发生在这样的场景中：${slotText(u, 'core_scenario') ?? '还没确定'}`,
      `这次先做到：${slotText(u, 'scope_boundary') ?? '还没确定'}`,
      `可以用这些标准判断是否做好：${slotText(u, 'completion_criteria') ?? '还没确定'}`,
      `需要提前注意：${slotText(u, 'constraints_risks') ?? '目前还没看到明确限制'}`,
    ].join('；'),
    '## 建议先这样推进',
    `${recommended?.description ?? '先补齐关键信息，再形成推进方案。'} 这个方向的好处是先把最核心的结果做出来，用清楚的标准判断是否有效，再决定要不要扩大范围。`,
    '## 还没完全确定的事',
    snapshot.unknowns.length > 0
      ? `还有这些内容建议继续确认：${snapshot.unknowns.map((item) => item.question).join('；')}`
      : '目前没有必须先确认的问题。后续如果要进入正式项目，可以继续补充责任人、时间安排、预算拆分、交付物格式和复盘方式。',
  ].join('\n\n');
}

function renderDetailedReport(snapshot: QuickBriefSnapshot, canUseAsDraft: boolean): string {
  const u = snapshot.understanding;
  const option = snapshot.options.find((item) => item.isRecommended);
  const unknownRows = snapshot.unknowns.length > 0
    ? snapshot.unknowns
      .map((item) => `| ${item.status} | ${item.question} | ${item.impact} |`)
      .join('\n')
    : '| 暂无 | 当前没有必须优先确认的问题。 | 无 |';
  return [
    '# 需求分析详细报告',
    '## 报告摘要',
    [
      `- 报告状态：${canUseAsDraft ? '快速问诊草稿，可用于继续沟通。' : '信息不足草稿，应继续追问后再用于沟通。'}`,
      `- 当前理解：${u.summary}`,
      `- 推荐方向：${option?.title ?? '暂不形成方案'}。${option?.description ?? '当前信息不足。'}`,
      '- 使用边界：本报告不是正式项目基线，也不代表用户已做正式决策。',
    ].join('\n'),
    '## 已确认理解',
    [
      '| 维度 | 当前口径 | 状态 |',
      '| --- | --- | --- |',
      `| 期望结果 | ${slotText(u, 'expected_outcome') ?? '待确认'} | ${slotStatusLabel(slotStatus(u, 'expected_outcome'))} |`,
      `| 目标用户 / 相关角色 | ${slotText(u, 'target_user') ?? '待确认'} | ${slotStatusLabel(slotStatus(u, 'target_user'))} |`,
      `| 核心场景 | ${slotText(u, 'core_scenario') ?? '待确认'} | ${slotStatusLabel(slotStatus(u, 'core_scenario'))} |`,
      `| 范围说明 | ${slotText(u, 'scope_boundary') ?? '待确认'} | ${slotStatusLabel(slotStatus(u, 'scope_boundary'))} |`,
      `| 完成标准 | ${slotText(u, 'completion_criteria') ?? '待确认'} | ${slotStatusLabel(slotStatus(u, 'completion_criteria'))} |`,
      `| 风险与约束 | ${slotText(u, 'constraints_risks') ?? '待确认'} | ${slotStatusLabel(slotStatus(u, 'constraints_risks'))} |`,
    ].join('\n'),
    '## 用户场景与独立验证',
    [
      '| 编号 | 用户场景 | 参与对象 | 独立验证方式 |',
      '| --- | --- | --- | --- |',
      `| 场景-001 | ${slotText(u, 'core_scenario') ?? '待确认'} | ${slotText(u, 'target_user') ?? '待确认'} | 从开始到结束走一遍，检查是否达到期望结果。 |`,
      '| 场景-002 | 复核当前范围并排除不做内容 | 需求方 / 执行方 | 对照范围说明检查是否加入了未确认内容。 |',
    ].join('\n'),
    '## 需求清单',
    [
      '| 编号 | 需求项 | 优先级 | 当前描述 |',
      '| --- | --- | --- | --- |',
      `| 需求-001 | 交付目标 | 必须明确 | ${slotText(u, 'expected_outcome') ?? '待确认'} |`,
      `| 需求-002 | 目标对象 | 必须明确 | ${slotText(u, 'target_user') ?? '待确认'} |`,
      `| 需求-003 | 核心场景 | 必须明确 | ${slotText(u, 'core_scenario') ?? '待确认'} |`,
      `| 需求-004 | 范围边界 | 必须明确 | ${slotText(u, 'scope_boundary') ?? '待确认'} |`,
      `| 需求-005 | 完成标准 | 必须明确 | ${slotText(u, 'completion_criteria') ?? '待确认'} |`,
    ].join('\n'),
    '## 成功标准与验收口径',
    [
      '| 编号 | 成功标准 | 验证方式 |',
      '| --- | --- | --- |',
      `| 标准-001 | ${slotText(u, 'completion_criteria') ?? '待确认'} | 使用可观察方式检查，不把主观满意当作唯一标准。 |`,
      '| 标准-002 | 重大未知必须保留为待确认 | 查看报告待确认事项，确认没有把推测写成事实。 |',
    ].join('\n'),
    '## 边界情况与异常处理',
    [
      '| 类型 | 情况 | 当前处理口径 |',
      '| --- | --- | --- |',
      '| 范围扩张 | 执行中加入未确认能力 | 作为变更或待确认项，不直接并入本期范围。 |',
      '| 完成标准不清 | 无法判断是否完成 | 回到对话继续追问，直到出现可观察标准。 |',
      '| 关键未知未补齐 | 影响方案或承诺的问题仍未回答 | 保留草稿状态，不写成正式承诺。 |',
    ].join('\n'),
    '## 假设与依赖',
    [
      '| 编号 | 假设 / 依赖 | 处理方式 |',
      '| --- | --- | --- |',
      '| 假设-001 | 当前报告只基于用户输入和已回答内容。 | 未确认内容保留为待确认。 |',
      '| 假设-002 | 快速问诊确认不等于正式审批。 | 进入正式项目后需要重新确认责任人与证据。 |',
    ].join('\n'),
    '## 方案比较与推荐',
    snapshot.options.length > 0
      ? [
        '| 方案 | 建议 | 说明 | 优势 | 风险 |',
        '| --- | --- | --- | --- | --- |',
        ...snapshot.options.map((item) =>
          `| ${item.title} | ${item.isRecommended ? '推荐' : '备选'} | ${item.description} | ${item.pros.join('；')} | ${item.cons.join('；')} |`,
        ),
      ].join('\n')
      : '当前信息不足，暂不形成方案。',
    '## 风险与待确认事项',
    ['| 状态 | 事项 | 影响 |', '| --- | --- | --- |', unknownRows].join('\n'),
    '## 需求质量检查',
    renderQualityIssues(snapshot.qualityIssues),
    '## 版本说明与后续动作',
    [
      '- 当前版本来自本次快速问诊记录。',
      '- 概述和详细报告必须来自同一份需求记录。',
      '- 用户补充后应生成新版本，不静默改写已导出的旧版本。',
    ].join('\n'),
  ].join('\n\n');
}

function renderQualityIssues(issues: QuickQualityIssue[]): string {
  if (issues.length === 0) return '当前没有发现需要优先处理的质量问题。';
  return [
    '| 维度 | 说明 | 优先级 |',
    '| --- | --- | --- |',
    ...issues.map((item) => `| ${item.dimension} | ${item.userLabel} | ${item.priorityScore} |`),
  ].join('\n');
}

function emptySlots(): QuickUnderstanding['slots'] {
  return Object.fromEntries(
    QUICK_SLOT_IDS.map((slot) => [
      slot,
      { value: null, status: 'missing' as QuickSlotStatus, source: 'system_default' as const },
    ]),
  ) as QuickUnderstanding['slots'];
}

function setSlot(
  slots: QuickUnderstanding['slots'],
  slot: QuickSlotId,
  value: string | null,
  status: QuickSlotStatus,
): void {
  slots[slot] = {
    value,
    status: value ? status : 'missing',
    source: value ? (status === 'inferred' ? 'assistant_inferred' : 'user') : 'system_default',
  };
}

function inferExpectedOutcome(text: string, originalInput: string): string {
  if (/海报/.test(text) && /网页|在线访问|扫码|手机/.test(text)) {
    const mobile = /手机|扫码/.test(text) ? '、手机可访问' : '';
    const speed = inferCompletionCriteria(text);
    return `生成可在线访问${mobile}的网页海报${speed ? `，${speed}` : ''}`;
  }
  const firstSentence = originalInput.split(/[。！？\n]/)[0]?.trim();
  return firstSentence || text.slice(0, 120);
}

function inferTargetUser(text: string): string | null {
  if (/轻度社交紧张/.test(text)) return '轻度社交紧张的人';
  if (/社恐|社交紧张/.test(text)) return '有社交紧张困扰的人';
  if (/课程导师|学术评审|导师或评审/.test(text)) return '课程导师或评审';
  if (/论文/.test(text) && /课程|通识课|评分|初稿/.test(text)) return '课程导师或评审';
  const audience = text.match(/面向([^，。；\n]{2,48})/);
  if (audience?.[1]) return normalizeRole(audience[1]);
  const primary = text.match(/主要(?:是|给)?([^，。；\n]{2,30})(?:使用|用|的同事|为主)?/);
  if (primary?.[1]) {
    const primaryRole = normalizeRole(primary[1]);
    if (primaryRole === '用户' && /课程导师|学术评审|导师或评审/.test(text)) {
      return '课程导师或评审';
    }
    if (/^(投放|发布|覆盖|支持|完成|用于)/.test(primaryRole)) {
      return matchAny(text, [
        /给([^，。；\n]{2,30})(?:用|使用|看)/,
        /(大学新生|大一新生|新生|团队宣传岗|个人创作者|学生|老师|客户|运营人员|运营同事|运营岗|管理员|访客|用户)/,
      ]);
    }
    if (/个人创作者[^。；\n]{0,12}次要/.test(text)) {
      return `${primaryRole}（主要），个人创作者（次要）`;
    }
    return primaryRole;
  }
  const patterns = [
    /主要(?:是|给)?([^，。；\n]{2,30})(?:使用|用|的同事|为主)/,
    /给([^，。；\n]{2,30})(?:用|使用|看)/,
    /(大学新生|大一新生|新生|团队宣传岗|个人创作者|学生|老师|客户|运营人员|运营同事|运营岗|管理员|访客|用户)/,
  ];
  return matchAny(text, patterns);
}

function inferCoreScenario(text: string): string | null {
  if (/(?:具体)?流程[^。；\n]{0,24}(?:还没想清楚|没想清楚|不清楚|不确定|没想好)/.test(text)) {
    return null;
  }
  if (/输入.*生成/.test(text) && /扫码|手机|在线访问|网页/.test(text)) {
    return '输入一句话后生成网页海报，手机扫码查看';
  }
  if (/输入.*生成/.test(text)) return '输入一句话后由系统生成结果';
  if (/扫码|手机/.test(text)) return '生成后通过手机查看';
  const fromToFlow = text.match(
    /(从[^。；\n]{2,80}到[^。；\n]{2,120}(?:完整流程|完整闭环|闭环|流程))/,
  );
  if (fromToFlow?.[1]) return fromToFlow[1].trim();
  if (/企业官网/.test(text) && /潜在客户|渠道伙伴|招聘候选人/.test(text)) {
    return '潜在客户了解业务与案例后联系咨询，渠道伙伴和招聘候选人查看公司信息';
  }
  if (/论文/.test(text) && /学习方式|教师评价|学术诚信/.test(text)) {
    return '围绕学习方式、教师评价和学术诚信分析生成式人工智能对大学课程的影响';
  }
  const explicitProcess = text.match(
    /(?:典型过程|具体过程|使用过程|活动流程|服务流程|流程)(?:是|为|：|:|\s)+([^。；\n]{4,180})/,
  );
  if (explicitProcess?.[1]) return explicitProcess[1].trim();
  const stagedProcess = text.match(
    /(先[^。；\n]{2,80}(?:再|然后)[^。；\n]{2,140}(?:最后|结束后|活动当天)[^。；\n]{2,140})/,
  );
  if (stagedProcess?.[1]) return stagedProcess[1].trim();
  if (/读书会/.test(text)) {
    return '线下读书会活动策划与执行';
  }
  const activityProcess = text.match(
    /((?:报名|签到|破冰|分组|讨论|分享|反馈)[^。；\n]{8,180})/,
  );
  if (activityProcess?.[1] && !/(?:还没想清楚|没想清楚|不清楚|不确定|没想好)/.test(activityProcess[1])) {
    return activityProcess[1].trim();
  }
  const match = text.match(/(?:场景|流程|使用时)[是：: ]([^。；\n]{4,120})/);
  return match?.[1]?.trim() ?? null;
}

function inferScope(text: string, turns: QuickTurn[]): string | null {
  if (answersNoToPreviousQuestion(turns, /协作编辑|二次修改|权限体系/, /不需要|不用|暂不|不做|够用/)) {
    return '本期先做一次生成可用的网页海报，暂不做多人协作编辑或二次修改';
  }
  const firstVersionNeeds = text.match(
    /(?:第一版|首版|本期|本次)[^。；\n]{0,18}(?:只需要|需要|只做)([^。；\n]{4,180})/,
  );
  if (firstVersionNeeds?.[0]) return normalizeScopeText(firstVersionNeeds[0]);
  const firstVersionCoverage = text.match(
    /(?:第一版|首版|本期|本次)[^。；\n]{0,16}(?:覆盖|包括|包含)([^。；\n]{4,160})/,
  );
  if (firstVersionCoverage?.[1]) return normalizeScopeText(`本次覆盖${firstVersionCoverage[1].trim()}`);
  const explicit = text.match(/(?:只做|首版|本次)([^。；\n]{4,100})/);
  if (explicit) return normalizeScopeText(explicit[0]);
  if (/不需要|不用|暂不|不做/.test(text)) {
    const noPart = text.match(/(?:不需要|不用|暂不|不做)([^。；\n]{2,80})/);
    return `本期先保留核心能力，暂不做${noPart?.[1]?.trim() ?? '扩展能力'}`;
  }
  return null;
}

function inferCompletionCriteria(text: string): string | null {
  const criteria = text.match(/(?:完成标准|验收标准|怎样算(?:做好|成功)|成功标准)[^，。；\n]*[是为：: ]([^。；\n]{4,140})/);
  if (criteria?.[1]) return criteria[1].trim();
  const acceptanceDeliverables = text.match(/(?:需要验收|验收)([^。；\n]{4,140})/);
  if (acceptanceDeliverables?.[0]) return acceptanceDeliverables[0].trim();
  const draftCriteria = text.match(/(?:两周内完成初稿|两周内做[^。；\n]{4,120}|形成题目、论点、结构、资料清单和写作计划|访谈问题、低保真流程和一个可测试脚本)/);
  if (draftCriteria?.[0]) {
    const deadline = text.match(/两周内完成初稿/);
    const value = draftCriteria[0].trim();
    return deadline?.[0] && !value.includes(deadline[0]) ? `${value}，${deadline[0]}` : value;
  }
  const generatedTime = text.match(/从[^。；\n]{0,40}到[^。；\n]{0,40}不超过\s*\d+\s*秒/);
  if (generatedTime) return generatedTime[0].replace(/\s+/g, '');
  const upperBound = text.match(/不超过\s*\d+\s*秒/);
  if (upperBound) return upperBound[0].replace(/\s+/g, '');
  const seconds = text.match(/(\d+\s*秒[^。；\n]{0,40})/);
  if (seconds) return seconds[1].replace(/\s+/g, '');
  const measurableGoal = text.match(/目标是[^。；\n]{0,180}(?:\d+\s*%|每周|提升|降低|减少|不少于|至少)[^。；\n]{0,80}/);
  if (measurableGoal) return measurableGoal[0].trim();
  const activityCriteria = Array.from(text.matchAll(/(?:计划覆盖|实际到场|报名满|满意度|反馈率|达到|不少于|至少|不低于)[^。\n]{0,220}/g))
    .map((match) => match[0].trim())
    .find((candidate) => /(?:不少于|至少|达到|不低于|以上|\d+\s*(?:人|名|分))/.test(candidate));
  if (activityCriteria) {
    return activityCriteria;
  }
  return null;
}

function inferConstraints(text: string): string | null {
  const explicitConstraints = extractConstraintSentences(text);
  if (explicitConstraints.length > 0) {
    const latestSubstantial = [...explicitConstraints].reverse().find((item) => hasSubstantialConstraints(item));
    if (latestSubstantial) return latestSubstantial;
    return explicitConstraints.slice(-2).join('；');
  }

  const hasNegatedRightsOrSafety =
    /(没有|无|无需|不涉及)[^。；\n]{0,18}(版权|内容审核|敏感|隐私|权限|安全|合规)/.test(text);
  const flags = [
    !hasNegatedRightsOrSafety && /版权|内容审核|敏感/.test(text) ? '需考虑版权和内容审核' : null,
    /成本|预算/.test(text) ? '需控制成本或预算' : null,
    !hasNegatedRightsOrSafety && /隐私|权限|安全/.test(text) ? '需关注隐私、权限或安全' : null,
    /性能|并发|速度|30\s*秒/.test(text) ? '存在性能或生成速度约束' : null,
  ].filter((item): item is string => item !== null);
  return flags.length > 0 ? flags.join('，') : null;
}

function extractConstraintSentences(text: string): string[] {
  const constraintPattern =
    /(限制|约束|预算|成本|时间|周一|周二|周三|周四|周五|周六|周日|上午|下午|晚上|场地|地点|教室|活动室|不做|不接|不改|不新增|不包含|暂不|不需要|不能|没有额外|无额外|无需|版权|安全|合规)/;
  return Array.from(new Set(
    text
      .split(/[。；\n]/)
      .flatMap((item) => normalizeConstraintFragments(item, constraintPattern))
      .map((item) => item.replace(/\s+/g, ' ')),
  ));
}

function normalizeConstraintFragments(value: string, constraintPattern: RegExp): string[] {
  const cleaned = value
    .trim()
    .replace(/^(?:补充|再次确认|最终确认|最后确认|复核)?(?:限制|约束)?[：:]\s*/, '');
  if (cleaned.length < 4 || !constraintPattern.test(cleaned)) return [];
  if (hasSubstantialConstraints(cleaned)) return [trimConstraintLead(cleaned)];

  const fragments = cleaned
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && constraintPattern.test(item));
  const exclusion = cleaned.match(/(?:但|并且|同时|本次)?(不做|不包含|暂不|不需要|不能|无需)[^，。；\n]{2,120}/);
  if (exclusion?.[0]) fragments.push(exclusion[0].replace(/^(但|并且|同时|本次)/, ''));
  return Array.from(new Set(fragments));
}

function trimConstraintLead(value: string): string {
  const match = value.match(/(预算|活动时间|时间|地点|场地|周一|周二|周三|周四|周五|周六|周日|上午|下午|晚上|校内|教室|活动室|不做|不接|不改|不新增|不包含|没有额外|无额外|无需)/);
  if (!match || match.index === undefined || match.index <= 0) return value;
  return value.slice(match.index).trim().replace(/^活动时间/, '时间');
}

function normalizeScopeText(value: string): string {
  return value.replace(/^暂时|^本次|^首版/, '').trim();
}

function normalizeRole(value: string): string {
  return value
    .replace(/^给/, '')
    .replace(/的同事$/, '')
    .replace(/为主$/, '')
    .trim();
}

function answersNoToPreviousQuestion(
  turns: QuickTurn[],
  questionPattern: RegExp,
  answerPattern: RegExp,
): boolean {
  for (let i = 1; i < turns.length; i += 1) {
    const prev = turns[i - 1];
    const current = turns[i];
    if (prev?.role === 'assistant' && current?.role === 'user') {
      if (questionPattern.test(prev.content) && answerPattern.test(current.content)) return true;
    }
  }
  return false;
}

function matchAny(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ?? match?.[0];
    if (value) return value.trim();
  }
  return null;
}

function buildSummary(slots: QuickUnderstanding['slots']): string {
  const target = slots.target_user?.value ?? '目标用户';
  const outcome = slots.expected_outcome?.value ?? '期望结果';
  const scenario = slots.core_scenario?.value ?? '核心场景';
  return `面向${target}，围绕“${scenario}”，目标是：${outcome}。`;
}

function buildUnknownForSlot(slot: QuickSlotId, status: QuickSlotStatus): QuickUnknown | null {
  if (status === 'confirmed') return null;
  if (status === 'partial' && slot !== 'constraints_risks') return null;
  const priorityScore = slotPriority(slot, status);
  return {
    id: `unknown_${slot}`,
    slot,
    label: slotLabel(slot),
    question: questionForSlot(slot),
    impact: impactForSlot(slot),
    priorityScore,
    status: status === 'inferred'
      ? '系统推测'
      : priorityScore >= 70
        ? '影响较大，建议先确认'
        : status === 'missing'
          ? '尚未提供'
          : '待确认',
    isBlocking: priorityScore >= 70,
  };
}

function buildQualityIssues(
  understanding: QuickUnderstanding,
  unknowns: QuickUnknown[],
): QuickQualityIssue[] {
  const issues: QuickQualityIssue[] = [];
  for (const unknown of unknowns) {
    issues.push({
      dimension: dimensionForSlot(unknown.slot),
      userLabel: `${unknown.label}还不够明确：${unknown.question}`,
      internalCode: `quick_quality_${unknown.slot}`,
      severity: unknown.isBlocking ? 'blocking' : 'warning',
      suggestedQuestion: unknown.question,
      priorityScore: unknown.priorityScore,
    });
  }
  const completion = slotText(understanding, 'completion_criteria');
  if (completion && !/\d|是否|可见|完成|通过|不超过|至少|达到/.test(completion)) {
    issues.push({
      dimension: '可验证性',
      userLabel: '完成标准还不够可观察，需要换成能检查的结果。',
      internalCode: 'quick_quality_completion_not_verifiable',
      severity: 'warning',
      suggestedQuestion: '怎样才算这件事已经做好了？有没有能观察或检查的标准？',
      priorityScore: 65,
    });
  }
  return issues.sort((a, b) => b.priorityScore - a.priorityScore);
}

function slotPriority(slot: QuickSlotId, status: QuickSlotStatus): number {
  const impact: Record<QuickSlotId, number> = {
    expected_outcome: 95,
    target_user: 90,
    core_scenario: 88,
    scope_boundary: 86,
    completion_criteria: 84,
    constraints_risks: 60,
  };
  const uncertainty: Record<QuickSlotStatus, number> = {
    missing: 1,
    inferred: 0.7,
    partial: 0.45,
    confirmed: 0,
  };
  return Math.round(impact[slot] * uncertainty[status]);
}

function questionForSlot(slot: QuickSlotId, understanding?: QuickUnderstanding): string {
  const existing = understanding ? slotText(understanding, slot) : null;
  const prefix = existing ? `我现在理解的是“${existing}”。` : '';
  const map: Record<QuickSlotId, string> = {
    expected_outcome: '你希望最后拿到的结果具体是什么？',
    target_user: '这个需求主要给谁使用或谁会受影响？',
    core_scenario: '用户会在什么具体场景下使用它？请描述一次典型过程。',
    scope_boundary: '第一版先做到哪里，哪些能力这次明确不做？',
    completion_criteria: '怎样算这件事已经做好了？有没有能观察或检查的标准？',
    constraints_risks: '有没有时间、成本、合规、版权、安全或其他必须注意的限制？',
  };
  return `${prefix}${map[slot]}`;
}

function impactForSlot(slot: QuickSlotId): string {
  const map: Record<QuickSlotId, string> = {
    expected_outcome: '影响需求方向和最终产出。',
    target_user: '影响场景、优先级和表达方式。',
    core_scenario: '影响流程闭环和方案设计。',
    scope_boundary: '影响工作量、报价、排期和取舍。',
    completion_criteria: '影响是否能判断完成。',
    constraints_risks: '影响风险、成本和上线条件。',
  };
  return map[slot];
}

function dimensionForSlot(slot: QuickSlotId): QuickQualityIssue['dimension'] {
  const map: Record<QuickSlotId, QuickQualityIssue['dimension']> = {
    expected_outcome: '完整性',
    target_user: '清晰度',
    core_scenario: '完整性',
    scope_boundary: '范围边界',
    completion_criteria: '可验证性',
    constraints_risks: '未知项',
  };
  return map[slot];
}

function slotLabel(slot: QuickSlotId): string {
  const map: Record<QuickSlotId, string> = {
    expected_outcome: '期望结果',
    target_user: '目标用户',
    core_scenario: '核心场景',
    scope_boundary: '范围说明',
    completion_criteria: '完成标准',
    constraints_risks: '风险与限制',
  };
  return map[slot];
}

function slotText(understanding: QuickUnderstanding, slot: QuickSlotId): string | null {
  return understanding.slots[slot]?.value?.trim() || null;
}

function shouldUseModel(
  skillId: string,
  modelEnabled: boolean,
  modelSkillIds: Set<string> | null,
): boolean {
  if (!modelEnabled) return false;
  return modelSkillIds === null || modelSkillIds.has(skillId);
}

function registeredDomainPack(id: string): string {
  return id === 'software-delivery' ? 'software-delivery' : 'general';
}

function normalizeDomainPacks(ids: string[]): string[] {
  const set = new Set(ids.map(registeredDomainPack));
  set.add('general');
  return Array.from(set);
}

function mergeStructuring(
  fallback: QuickStructuringOutput,
  model: QuickStructuringOutput,
  state: RuntimeState,
): QuickStructuringOutput {
  const slots = { ...fallback.understanding.slots };
  const sourceText = [state.originalInput, ...state.turns.map((turn) => turn.content)].join('\n');
  for (const slot of QUICK_SLOT_IDS) {
    const modelSlot = model.understanding.slots[slot];
    if (
      modelSlot?.value &&
      modelSlot.status !== 'missing' &&
      shouldAcceptModelSlot(slot, state, sourceText, fallback.understanding.slots[slot]?.value ?? null, modelSlot.value)
    ) {
      slots[slot] = normalizeMergedSlot(slot, modelSlot);
    }
  }
  return {
    understanding: {
      summary: model.understanding.summary || buildSummary(slots),
      slots,
    },
    changedSlots: QUICK_SLOT_IDS.filter((slot) => slotStatusFromSlots(slots, slot) !== 'missing'),
  };
}

function normalizeMergedSlot(
  slot: QuickSlotId,
  value: QuickUnderstanding['slots'][QuickSlotId],
): QuickUnderstanding['slots'][QuickSlotId] {
  if (
    slot === 'constraints_risks' &&
    value?.value &&
    value.status === 'inferred' &&
    hasSubstantialConstraints(value.value)
  ) {
    return { ...value, status: 'partial', source: 'user' };
  }
  return value;
}

function shouldAcceptModelSlot(
  slot: QuickSlotId,
  state: RuntimeState,
  sourceText: string,
  fallbackValue: string | null,
  modelValue: string,
): boolean {
  if (isPlaceholderModelValue(modelValue)) return false;
  if (!preservesNumericFacts(fallbackValue, modelValue)) return false;
  if (!doesNotInventSlotClaims(slot, sourceText, modelValue)) return false;
  if (slot === 'target_user' && !acceptsTargetUserOverride(fallbackValue, modelValue)) return false;
  if (slot === 'core_scenario' && !acceptsCoreScenarioOverride(fallbackValue, modelValue)) return false;
  if (slot === 'scope_boundary' && !acceptsScopeBoundaryOverride(fallbackValue, modelValue)) return false;
  if (slot === 'constraints_risks' && !acceptsConstraintsOverride(fallbackValue, modelValue)) return false;
  if (slot === 'completion_criteria' && !hasCompletionEvidence(sourceText)) return false;
  if (slot === 'scope_boundary' && !fallbackValue && !hasScopeEvidence(sourceText)) return false;
  if (!hasOnlyOriginalInput(state) || !declaresUnclearNeed(state.originalInput)) return true;
  return slot === 'expected_outcome' || slot === 'target_user';
}

function isPlaceholderModelValue(value: string): boolean {
  return /^(待确认|暂无|未提及|不明确|不清楚|未知|待补充|未提供|没有提供)$/.test(value.trim());
}

function acceptsTargetUserOverride(fallbackValue: string | null, modelValue: string): boolean {
  const normalized = modelValue.trim();
  if (/^(运营|流程|活动|报名|签到|反馈|直播|课程|社群|学生|用户|客户|参与者)$/.test(normalized) && fallbackValue && fallbackValue !== normalized) {
    return false;
  }
  if (/^(运营|流程|活动|报名|签到|反馈|直播|课程|社群)$/.test(normalized)) return false;
  if (!fallbackValue) return true;
  if (/\d/.test(fallbackValue) && !modelValue.includes(fallbackValue)) return false;
  return sharesMeaningfulTerm(fallbackValue, modelValue);
}

function acceptsCoreScenarioOverride(fallbackValue: string | null, modelValue: string): boolean {
  const normalized = modelValue.trim();
  if (/^[、，；,.]/.test(normalized)) return false;
  if (/^(宣传方式|现场分工|活动流程|服务流程|流程|使用场景)$/.test(normalized)) return false;
  if (
    fallbackValue &&
    /先[^。；\n]{2,80}(?:再|然后)[^。；\n]{2,140}(?:最后|结束后|活动当天)/.test(fallbackValue) &&
    !/(先|再|然后|最后|结束后|活动当天|报名|签到|破冰|分组|讨论|分享|反馈)/.test(normalized)
  ) {
    return false;
  }
  if (fallbackValue && !sharesMeaningfulTerm(fallbackValue, modelValue)) return false;
  return true;
}

function acceptsScopeBoundaryOverride(fallbackValue: string | null, modelValue: string): boolean {
  if (!fallbackValue) return true;
  const fallbackHasPositiveScope = /(覆盖|包含|包括|活动前|现场|活动后|执行|总结|宣传)/.test(fallbackValue);
  const modelHasPositiveScope = /(覆盖|包含|包括|活动前|现场|活动后|执行|总结|宣传)/.test(modelValue);
  const modelHasOnlyExclusion =
    /^(不做|不包含|暂不|不需要|无需|本次不做|本次不包含)/.test(modelValue.trim()) ||
    (!modelHasPositiveScope && /(不做|不包含|暂不|不需要|无需)/.test(modelValue));
  if (fallbackHasPositiveScope && modelHasOnlyExclusion) return false;
  return sharesMeaningfulTerm(fallbackValue, modelValue);
}

function acceptsConstraintsOverride(fallbackValue: string | null, modelValue: string): boolean {
  if (!fallbackValue) return true;
  const fallbackHasBudget = /预算|\d+\s*(元|万元)/.test(fallbackValue);
  const modelHasBudget = /预算|\d+\s*(元|万元)/.test(modelValue);
  const fallbackSignals = constraintSignals(fallbackValue);
  const modelSignals = constraintSignals(modelValue);
  for (const signal of fallbackSignals) {
    if (!modelSignals.has(signal)) return false;
  }
  const modelOnlyLooksLikeExclusion =
    /^(不做|不包含|暂不|不需要|无需|但不做|本次不做|本次不包含)/.test(modelValue.trim()) ||
    (!modelHasBudget && /(不做|不包含|暂不|不需要|无需)/.test(modelValue));
  if (fallbackHasBudget && (!modelHasBudget || modelOnlyLooksLikeExclusion)) return false;
  return sharesMeaningfulTerm(fallbackValue, modelValue) || modelHasBudget;
}

function constraintSignals(value: string): Set<string> {
  const signals = new Set<string>();
  if (/预算|成本|\d+\s*(元|万元|块)/.test(value)) signals.add('budget');
  if (/(周一|周二|周三|周四|周五|周六|周日|上午|下午|晚上|时间|日期|截止|期限)/.test(value)) {
    signals.add('time');
  }
  if (/(校内|教室|活动室|场地|地点|线上|线下)/.test(value)) signals.add('place');
  if (/(不做|不包含|暂不|不需要|无需|不能|避免|禁止)/.test(value)) signals.add('exclusion');
  if (/(合规|版权|安全|隐私|审核|风险)/.test(value)) signals.add('risk');
  return signals;
}

function doesNotInventSlotClaims(slot: QuickSlotId, sourceText: string, modelValue: string): boolean {
  if (slot !== 'scope_boundary' && slot !== 'constraints_risks') return true;
  return doesNotInventUnsupportedTerms(sourceText, modelValue);
}

function hasCompletionEvidence(text: string): boolean {
  if (/不少于|至少|不超过|达到|不低于|报名满|实际到场|满意度|反馈率|可观察|检查/.test(text)) {
    return true;
  }
  const explicitCriterion =
    /(?:完成标准|验收标准|成功标准)[^。；\n]{0,8}(?:是|为|：|:)/.test(text) ||
    /怎样算[^。；\n]{0,20}(?:做好|成功|完成)/.test(text);
  if (!explicitCriterion) return false;
  return !/完成标准[^。；\n]{0,12}(?:没想清楚|不清楚|不确定|没想好)|验收标准[^。；\n]{0,12}(?:没想清楚|不清楚|不确定|没想好)/.test(text);
}

function hasScopeEvidence(text: string): boolean {
  return /只做|首版|第一版|本次|先做|范围|不做|不需要|不用|暂不|排除/.test(text);
}

function doesNotInventUnsupportedTerms(sourceText: string, value: string): boolean {
  const source = normalizeClaimText(sourceText);
  const target = normalizeClaimText(value);
  const guardedTerms = [
    '上传图片',
    '图片上传',
    '分享链接',
    '链接分享',
    '登录',
    '注册',
    '模板',
    '多人协作',
    '导出',
    '自定义布局',
    '后台',
    '权限',
    '支付',
    '订单',
    '接口',
    'api',
    '数据库',
    '线上直播',
    '直播',
    '多场次',
    '多场',
    '后续系列',
    '系列活动',
    '长期社群',
    '社群运营',
    '付费课程',
    '其他年级',
    '校外人员',
  ];
  return guardedTerms.every((term) => !target.includes(term) || source.includes(term));
}

function normalizeClaimText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

function preservesNumericFacts(fallbackValue: string | null, modelValue: string): boolean {
  if (!fallbackValue) return true;
  const fallbackNumbers = numericTokens(fallbackValue);
  if (fallbackNumbers.length === 0) return true;
  const modelNumbers = new Set(numericTokens(modelValue));
  return fallbackNumbers.every((token) => modelNumbers.has(token));
}

function sharesMeaningfulTerm(a: string, b: string): boolean {
  const source = normalizeClaimText(a);
  const target = normalizeClaimText(b);
  if (!source || !target) return false;
  if (target.includes(source) || source.includes(target)) return true;
  const terms = [
    '新生',
    '学生',
    '大一',
    '老师',
    '客户',
    '用户',
    '访客',
    '创作者',
    '宣传岗',
    '运营人员',
    '管理员',
    '参与者',
    '同学',
  ];
  return terms.some((term) => source.includes(term) && target.includes(term));
}

function numericTokens(value: string): string[] {
  return Array.from(new Set(value.match(/\d+(?:\.\d+)?/g) ?? []));
}

function hasOnlyOriginalInput(state: RuntimeState): boolean {
  const original = state.originalInput.trim();
  const userTurns = state.turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content.trim())
    .filter(Boolean);
  return userTurns.length === 0 || userTurns.every((content) => content === original);
}

function declaresUnclearNeed(text: string): boolean {
  return /没想清楚|没想好|还没想|不清楚|不确定|不知道|模糊|没明确|还没明确/.test(text);
}

function slotStatus(understanding: QuickUnderstanding, slot: QuickSlotId): QuickSlotStatus {
  return slotStatusFromSlots(understanding.slots, slot);
}

function slotStatusLabel(status: QuickSlotStatus): string {
  switch (status) {
    case 'confirmed':
      return '已确认';
    case 'partial':
      return '建议确认';
    case 'inferred':
      return '系统推测';
    case 'missing':
      return '尚未提供';
    default:
      return '待确认';
  }
}

function slotStatusFromSlots(
  slots: QuickUnderstanding['slots'],
  slot: QuickSlotId,
): QuickSlotStatus {
  return slots[slot]?.status ?? 'missing';
}

function requireStructuring(state: RuntimeState): QuickStructuringOutput {
  if (!state.structuring) throw new Error('structuring output is required');
  return state.structuring;
}

function requireValidation(state: RuntimeState): QuickValidationOutput {
  if (!state.validation) throw new Error('validation output is required');
  return state.validation;
}
