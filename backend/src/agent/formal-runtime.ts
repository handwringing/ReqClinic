import { createHash } from 'node:crypto';
import type { AiInvokeResult, AiProvider, SkillInvocationAudit } from '../ai/provider';
import { estimateTokens } from '../ai/json-prompt';
import { env } from '../config/env';
import {
  FORMAL_SKILL_MANIFESTS,
  formalMapSnapshotSchema,
  type FormalMapModule,
  type FormalMapSnapshotOutput,
} from './formal-schemas';

export interface FormalRuntimeInput {
  projectId: string;
  projectTitle: string;
  projectDescription: string;
  intakeText: string;
  turns: Array<{ role: 'assistant' | 'user'; content: string; boundRefs?: unknown[] }>;
  previousSnapshot?: unknown | null;
  sourceKind: 'direct' | 'quick_upgrade' | 'conversation_update';
  quickBriefSnapshot?: unknown | null;
  modelEnabled: boolean;
}

export interface FormalRuntimeResult {
  snapshot: FormalMapSnapshotOutput;
  providerResult: AiInvokeResult | null;
  audit: SkillInvocationAudit[];
}

export class FormalGuidanceRuntime {
  constructor(private readonly provider: AiProvider) {}

  async run(input: FormalRuntimeInput): Promise<FormalRuntimeResult> {
    const fallback = buildFallbackSnapshot(input);
    let providerResult: AiInvokeResult | null = null;
    let snapshot = fallback;

    if (input.modelEnabled) {
      try {
        providerResult = await this.provider.invoke({
          taskType: 'formal_guidance',
          payload: {
            project_id: input.projectId,
            project_title: input.projectTitle,
            project_description: input.projectDescription,
            intake_text: input.intakeText,
            source_kind: input.sourceKind,
            quick_brief_snapshot: input.quickBriefSnapshot ?? null,
            previous_snapshot: input.previousSnapshot ?? null,
            dialogue_turns: input.turns,
            hard_constraints: [
              '只生成候选地图、追问和指导报告，不写最终确认版。',
              '不要把待确认内容写成已确认事实。',
              '不要出现 agent、skill、schema、slot、blocking 等开发者词。',
              '如果任务不是软件项目，不要套网页、接口、数据库、登录等软件模板。',
            ],
          },
        });
        const parsed = formalMapSnapshotSchema.safeParse(providerResult.output);
        if (parsed.success) {
          snapshot = mergeWithFallback(parsed.data, fallback);
        }
      } catch {
        providerResult = null;
        snapshot = {
          ...fallback,
          qualityNotes: [
            ...fallback.qualityNotes,
            '模型输出暂不可用，已使用确定性地图继续工作。',
          ],
        };
      }
    }
    snapshot = mergeIntakeContext(snapshot, input);
    snapshot = mergeQuickBriefContext(snapshot, input);
    snapshot = reconcileSnapshotWithTurns(snapshot, input);

    return {
      snapshot,
      providerResult,
      audit: buildAudit(providerResult, input, snapshot),
    };
  }
}

export function buildDeterministicFormalSnapshot(input: FormalRuntimeInput): FormalMapSnapshotOutput {
  let snapshot = buildFallbackSnapshot(input);
  snapshot = mergeIntakeContext(snapshot, input);
  snapshot = mergeQuickBriefContext(snapshot, input);
  snapshot = reconcileSnapshotWithTurns(snapshot, input);
  return snapshot;
}

function buildAudit(
  providerResult: AiInvokeResult | null,
  input: FormalRuntimeInput,
  snapshot: FormalMapSnapshotOutput,
): SkillInvocationAudit[] {
  const totalInputTokens =
    providerResult?.inputTokens ?? estimateTokens(JSON.stringify(input));
  const totalOutputTokens =
    providerResult?.outputTokens ?? estimateTokens(JSON.stringify(snapshot));
  const modelSkillId = 'formal.composition.guidance_report';

  return FORMAL_SKILL_MANIFESTS.map((skill) => {
    const usesModel = providerResult !== null && skill.skillId === modelSkillId;
    return {
      skillId: skill.skillId,
      skillVersion: skill.skillVersion,
      inputSchemaVersion: skill.inputSchemaVersion,
      outputSchemaVersion: skill.outputSchemaVersion,
      promptVersion: skill.promptVersion,
      provider: usesModel ? providerResult.provider : null,
      model: usesModel ? providerResult.model : null,
      thinkingMode: usesModel ? providerResult.thinkingMode ?? 'unset' : null,
      inputTokens: usesModel ? totalInputTokens : 0,
      outputTokens: usesModel ? totalOutputTokens : 0,
      usageEstimated: usesModel ? providerResult.usageEstimated === true : false,
    };
  });
}

function buildFallbackSnapshot(input: FormalRuntimeInput): FormalMapSnapshotOutput {
  const theme = detectTheme([
    input.projectTitle,
    input.projectDescription,
    input.intakeText,
    ...input.turns.map((turn) => turn.content),
  ].join('\n'));
  const modules = applyTurnAnswersToModules(
    mergeQuickBriefIntoModules(modulesForTheme(theme, input), input),
    input.turns,
  );
  const currentModule = chooseCurrentModule(modules, input.turns);
  const nextQuestion = currentModule.questions[0] ?? '这部分目前最需要谁来确认？';
  const summary = summarizeInput(input);
  return formalMapSnapshotSchema.parse({
    result_type: 'formal_map_snapshot',
    title: `${input.projectTitle || titleFromText(input.intakeText)}需求地图`,
    summary,
    projectType: themeLabel(theme),
    sourceContext:
      input.sourceKind === 'quick_upgrade'
        ? '来自快速问诊简报升级，正式项目需要重新确认关键内容。'
        : '来自项目初始说明，后续由问诊继续补齐。',
    currentModuleId: currentModule.id,
    nextQuestion,
    generationSteps: [
      { label: '整理起点', state: 'done' },
      { label: '划分模块', state: 'done' },
      { label: '继续追问', state: 'active' },
      { label: '生成报告', state: input.turns.length >= 4 ? 'active' : 'pending' },
    ],
    modules,
    unresolvedItems: unresolvedFromModules(modules),
    reportProjection: buildReportProjection(input, modules, summary, nextQuestion),
    qualityNotes: [
      '当前地图是项目整理结果，重要内容仍需负责人确认。',
    ],
  });
}

type Theme = 'software' | 'activity' | 'academic' | 'outsourcing' | 'service' | 'collaboration' | 'general';

function detectTheme(text: string): Theme {
  if (/网站|小程序|App|平台|后台|接口|数据库|登录|系统|工具|生成|开发/.test(text)) return 'software';
  if (/活动|报名|嘉宾|场地|物料|宣发|到场|沙龙|发布会|读书会|展会/.test(text)) return 'activity';
  if (/论文|课程|研究|文献|导师|作业|引用|开题/.test(text)) return 'academic';
  if (/外包|采购|供应商|合同|验收|交付物|报价/.test(text)) return 'outsourcing';
  if (/园区|访客|通行|续费|门店|服务流程|前台|安保|会员/.test(text)) return 'service';
  if (/毕业设计|小组|答辩|多人|分工|协作/.test(text)) return 'collaboration';
  return 'general';
}

function themeLabel(theme: Theme): string {
  const labels: Record<Theme, string> = {
    software: '软件或数字产品',
    activity: '活动策划',
    academic: '学术写作',
    outsourcing: '外包采购',
    service: '服务流程',
    collaboration: '多人协作项目',
    general: '通用项目',
  };
  return labels[theme];
}

function modulesForTheme(theme: Theme, input: FormalRuntimeInput): FormalMapModule[] {
  const base = baseKnown(input);
  if (theme === 'activity') {
    return linkModules([
      module('activity_goal', '活动目标', '正在梳理', '确认活动要带来报名、转化、品牌声量还是内部共识。', base, ['不同目标会改变预算、流程和复盘指标。'], ['这次活动最核心的成功结果是什么？']),
      module('audience', '目标人群', '待补充', '说明活动面向谁、为什么会参与、用什么渠道触达。', [], ['参与动机会影响主题和传播话术。'], ['最希望吸引哪类人参加？他们为什么愿意来？']),
      module('format', '活动形式与流程', '有方案可选', '设计线上、线下或混合形式，以及签到、互动、转化流程。', [], ['流程复杂度受场地、人力和预算影响。'], ['活动更适合讲座、工作坊、展位体验还是沙龙？'], [
        option('format_workshop', '工作坊优先', '适合需要深度参与和产出结果的活动。', '准备成本更高，对主持和物料要求更高。', true),
        option('format_salon', '沙龙交流优先', '适合先建立连接和收集反馈。', '产出不如工作坊明确。'),
      ]),
      module('resources', '资源与分工', '建议确认', '明确预算、场地、人员、物料、嘉宾和供应商责任。', [], ['部分资源需要提前锁定。'], ['目前已确定哪些预算、人力或场地资源？']),
      module('promotion', '宣发与报名', '待补充', '安排渠道、节奏、素材、报名入口和提醒机制。', [], ['不同渠道需要不同素材规格。'], ['主要靠哪些渠道触达目标人群？']),
      module('risk', '风险预案', '建议确认', '处理报名不足、嘉宾变动、天气、设备和现场秩序风险。', [], ['需要至少保留关键风险兜底。'], ['最需要提前准备哪类兜底方案？']),
      module('report', '策划案与复盘', '待补充', '把执行方案、预算、分工、复盘指标汇总成可沟通文档。', ['报告应来自同一份需求地图。'], ['复盘指标应与活动目标一致。'], ['策划案主要给谁看，用于审批、执行还是对外沟通？']),
    ]);
  }
  if (theme === 'academic') {
    return linkModules([
      module('assignment_rules', '任务要求', '待补充', '整理字数、格式、截止时间、引用数量和评分口径。', base, ['老师更看重明确问题和证据支撑。'], ['课程对字数、格式和引用数量有什么硬性要求？']),
      module('research_question', '研究问题', '正在梳理', '把宽泛主题收窄为可论证、可收集证据的问题。', [], ['过宽主题会削弱论证力度。'], ['这篇论文最想回答的一个具体问题是什么？']),
      module('evidence', '证据范围', '建议确认', '确认可用文献、政策、案例、数据和引用限制。', [], ['英文文献和案例材料是否允许仍需确认。'], ['老师是否允许英文文献、政策案例或实证数据？']),
      module('structure', '章节结构', '有方案可选', '根据研究问题生成论证链，而不是套固定模板。', [], ['结构应服务研究问题。'], ['更适合问题导向结构，还是案例比较结构？'], [
        option('structure_argument', '问题导向结构', '适合围绕一个明确问题逐步论证。', '需要更早收窄研究问题。', true),
        option('structure_review', '综述比较结构', '适合材料较多、主题较宽时使用。', '容易变成材料堆叠。'),
      ]),
      module('schedule', '写作计划', '待补充', '拆分资料收集、初稿、修改和提交节点。', [], ['资料不足时应先缩小问题范围。'], ['距离截止还有多久，是否需要先做最小可交稿版本？']),
      module('report', '论文说明与提交', '待补充', '把选题、证据、结构和提交要求汇总为写作说明。', ['报告应来自同一份需求地图。'], [], ['最终文档需要给老师看，还是也要用于答辩汇报？']),
    ]);
  }
  if (theme === 'outsourcing') {
    return linkModules([
      module('business_goal', '业务目标与受众', '正在梳理', '确认项目服务品牌展示、获客线索、内部效率还是客户信任。', base, ['目标不同会影响报价和验收。'], ['首版最重要的是品牌可信度、线索转化，还是内部使用效率？']),
      module('scope', '工作范围与排除项', '有方案可选', '明确本次做什么、不做什么、哪些变化需要重新报价。', [], ['排除项不清会造成返工和争议。'], ['哪些内容必须首版交付，哪些要明确排除？'], [
        option('scope_contract_first', '先定范围再询价', '适合减少报价差异和后续扯皮。', '前期澄清会多一些。', true),
        option('scope_vendor_first', '先找供应商估算', '适合快速获取市场报价。', '报价不可比，后续变更风险更高。'),
      ]),
      module('deliverables', '交付物与材料责任', '建议确认', '列清设计稿、代码、文案、素材、部署、培训和交接。', [], ['素材责任会影响工期和费用。'], ['哪些材料由甲方提供，哪些由供应商负责？']),
      module('milestones', '里程碑与验收', '待补充', '把阶段评审、付款节点、验收标准和不通过处理方式写清楚。', [], ['验收应覆盖交付物和实际可用性。'], ['验收时按清单、演示效果还是上线结果判断？']),
      module('change_rule', '变更与费用规则', '建议确认', '提前写清返工边界和新增需求计价方式。', [], ['免费修改次数和范围需要合同化。'], ['哪些修改算免费调整，哪些算新增需求？']),
      module('risk', '供应商风险', '待补充', '识别延期、质量、维护、知识产权和账号交接风险。', [], ['风险应进入合同或验收附件。'], ['最担心供应商在哪个环节失控？']),
      module('report', '采购说明与合同附件', '待补充', '生成可用于询价、评审和合同附件的需求说明。', ['报告应来自同一份需求地图。'], [], ['这份报告主要用于内部审批、供应商询价还是合同附件？']),
    ]);
  }
  if (theme === 'service') {
    return linkModules([
      module('journey', '服务流程', '正在梳理', '从用户进入、办理、异常处理到结束记录一条线梳理。', base, ['高峰期和异常场景会影响流程设计。'], ['整个流程里哪一步最容易卡住？']),
      module('roles', '角色与权限', '建议确认', '区分用户、工作人员、主管和管理员的责任。', [], ['不同角色的确认权可能不同。'], ['谁可以修改记录，谁只能查看或处理？']),
      module('exception', '异常处理', '有方案可选', '处理信息不全、资格不符、设备不可用和人工兜底。', [], ['异常处理需要留下记录。'], ['遇到异常时是重新申请，还是由现场人员人工处理？'], [
        option('exception_manual', '人工兜底优先', '适合上线早期保证现场不断流。', '记录一致性需要额外管理。', true),
        option('exception_strict', '规则校验优先', '适合合规要求更高的场景。', '用户体验可能更硬。'),
      ]),
      module('records', '记录与追踪', '待补充', '确认记录内容、查询权限、保留时间和复盘方式。', [], ['记录保留期可能涉及管理要求。'], ['记录需要保存多久，谁可以查询？']),
      module('risk', '运营风险', '建议确认', '识别排队、设备、隐私、执行一致性和人工兜底风险。', [], ['现场必须保留关键兜底方案。'], ['如果关键设备或人员不可用，流程怎么继续？']),
      module('report', '流程说明与培训', '待补充', '生成面向执行人员的流程说明、异常清单和培训重点。', ['报告应来自同一份需求地图。'], [], ['这份说明主要给管理者、现场人员还是外部用户看？']),
    ]);
  }
  if (theme === 'collaboration') {
    return linkModules([
      module('success', '成功标准', '正在梳理', '确认项目评审看重演示、成果、文档还是协作过程。', base, ['评价标准会影响范围排序。'], ['最终评审最不能失败的是演示闭环、材料完整，还是创新说明？']),
      module('scope', '首版范围', '有方案可选', '把首版必须做、后续再做和明确不做分开。', [], ['多人项目容易范围扩张。'], ['首版必须包含哪些内容，哪些可以放到后续？'], [
        option('scope_demo', '演示闭环优先', '适合先保证可展示结果。', '深度能力需要后续加强。', true),
        option('scope_full', '完整能力优先', '适合时间充足且分工稳定。', '集成风险更高。'),
      ]),
      module('roles', '分工与责任', '建议确认', '说明每个人负责什么、交付什么、谁确认集成。', [], ['接口和材料责任不清会拖慢集成。'], ['每个成员的最终交付物分别是什么？']),
      module('schedule', '版本节奏', '待补充', '拆分检查、联调、材料和最终展示节点。', [], ['关键节点需要冻结范围。'], ['第一版演示必须在哪一天前冻结？']),
      module('risk', '协作风险', '建议确认', '处理成员进度、接口不稳定、模型调用、材料缺失等风险。', [], ['需要提前准备兜底方案。'], ['如果关键成员或接口延迟，谁负责兜底？']),
      module('report', '汇报材料', '待补充', '把需求、分工、演示路径和风险说明汇总成汇报材料。', ['报告应来自同一份需求地图。'], [], ['最终材料用于答辩、评审还是内部同步？']),
    ]);
  }
  if (theme === 'software') {
    return linkModules([
      module('user_goal', '目标用户与结果', '正在梳理', '确认谁使用、解决什么问题、最重要的结果是什么。', base, ['目标不同会影响功能优先级。'], ['第一版最重要的用户结果是什么？']),
      module('core_flow', '核心流程', '有方案可选', '把用户从进入、操作、得到结果到异常处理的路径说清楚。', [], ['核心流程决定首版功能边界。'], ['用户完成一次核心任务要经过哪些步骤？'], [
        option('flow_minimal', '最小闭环优先', '适合先验证主要流程。', '高级能力会放到后续。', true),
        option('flow_complete', '完整体验优先', '适合已有明确用户和资源。', '开发和测试成本更高。'),
      ]),
      module('scope', '功能范围与排除项', '建议确认', '明确本次包含、不包含以及后续版本。', [], ['排除项不清会导致范围蔓延。'], ['首版明确不做哪些功能或场景？']),
      module('quality', '完成标准与质量', '待补充', '定义响应时间、稳定性、内容质量、兼容性或运营指标。', [], ['完成标准需要可检查。'], ['怎样判断第一版已经达到可交付？']),
      module('risk', '风险与兜底', '建议确认', '识别成本、合规、模型、数据、性能和人工兜底风险。', [], ['高风险项不能写成确定承诺。'], ['哪个风险最可能影响上线时间或成本？']),
      module('report', '需求报告与任务拆解', '待补充', '生成可给团队评审和后续拆解使用的需求分析报告。', ['报告应来自同一份需求地图。'], [], ['报告主要给产品、开发、外包方还是管理者看？']),
    ]);
  }
  return linkModules([
    module('goal', '项目目标', '正在梳理', '确认要解决的问题、服务对象和希望达成的结果。', base, ['目标不清会影响后续所有判断。'], ['这件事最重要的成功结果是什么？']),
    module('people', '参与对象与确认人', '建议确认', '确认谁使用、谁受影响、谁有权确认结果。', [], ['参与者不等于最终确认人。'], ['最终由谁判断这个项目可以交付或完成？']),
    module('scope', '范围与边界', '有方案可选', '说明本次包含什么、不包含什么，以及后续如何扩展。', [], ['范围边界需要明确责任。'], ['第一版必须包含哪些结果？哪些明确不做？'], [
      option('scope_first', '先定首版范围', '适合降低不确定性并快速推进。', '长期能力进入后续版本。', true),
      option('scope_blueprint', '先画完整蓝图', '适合长期协作和复杂项目。', '前期确认成本更高。'),
    ]),
    module('standard', '完成标准', '待补充', '把目标转成可观察、可检查的完成标准。', [], ['完成标准应能被具体检查。'], ['怎样判断这件事已经做到位？']),
    module('risk', '风险与取舍', '建议确认', '识别影响成本、时间、质量和承诺的关键风险。', [], ['部分风险需要责任人确认。'], ['哪些风险会影响成本、时间或交付承诺？']),
    module('report', '报告与后续动作', '待补充', '从同一份需求地图生成概述、详细报告和后续动作。', ['报告应来自同一份需求地图。'], ['未确认内容不能写成最终结论。'], ['报告主要给谁看，用于沟通、评审还是执行？']),
  ]);
}

function module(
  id: string,
  title: string,
  status: FormalMapModule['status'],
  summary: string,
  known: string[],
  assumptions: string[],
  questions: string[],
  options: FormalMapModule['options'] = [],
): FormalMapModule {
  return {
    id,
    title,
    status,
    summary,
    known,
    assumptions,
    questions,
    options,
    relatedModuleIds: [],
  };
}

function option(
  id: string,
  title: string,
  fit: string,
  tradeoff: string,
  recommended = false,
): FormalMapModule['options'][number] {
  return { id, title, fit, tradeoff, recommended };
}

function linkModules(modules: FormalMapModule[]): FormalMapModule[] {
  return modules.map((item, index) => ({
    ...item,
    relatedModuleIds: [
      modules[index - 1]?.id,
      modules[index + 1]?.id,
      item.id !== 'report' ? 'report' : modules[0]?.id,
    ].filter((id): id is string => Boolean(id) && id !== item.id),
  }));
}

function mergeQuickBriefContext(
  snapshot: FormalMapSnapshotOutput,
  input: FormalRuntimeInput,
): FormalMapSnapshotOutput {
  if (input.sourceKind !== 'quick_upgrade') return snapshot;
  const modules = mergeQuickBriefIntoModules(snapshot.modules, input);
  const currentModule =
    modules.find((item) => item.id === snapshot.currentModuleId) ??
    chooseCurrentModule(modules, input.turns);
  const nextQuestion = currentModule.questions[0] ?? snapshot.nextQuestion;
  const summary = summarizeInput(input);
  return formalMapSnapshotSchema.parse({
    ...snapshot,
    sourceContext: '来自快速问诊简报升级，快速简报只作为候选来源；正式项目会继续确认目标、范围、方案和责任。',
    currentModuleId: currentModule.id,
    nextQuestion,
    modules,
    unresolvedItems: unresolvedFromModules(modules),
    reportProjection: buildReportProjection(input, modules, summary, nextQuestion),
    qualityNotes: Array.from(new Set([
      ...snapshot.qualityNotes,
      '快速问诊内容已作为候选来源带入，正式项目仍需逐项确认。',
    ])),
  });
}

function mergeQuickBriefIntoModules(
  modules: FormalMapModule[],
  input: FormalRuntimeInput,
): FormalMapModule[] {
  if (input.sourceKind !== 'quick_upgrade') return modules;
  const brief = quickBriefHints(input.quickBriefSnapshot);
  if (brief.lines.length === 0 && brief.options.length === 0) return modules;

  const cloned = modules.map((item) => ({
    ...item,
    known: item.known.filter((known) => !known.startsWith('用户补充：')),
    assumptions: [...item.assumptions],
    questions: [...item.questions],
    options: [...item.options],
    relatedModuleIds: [...item.relatedModuleIds],
  }));

  for (const line of brief.lines) {
    const target = findModuleForQuickBriefLine(cloned, line.kind);
    appendUnique(target.assumptions, `快速问诊候选：${line.text}`);
    if (line.question) appendUnique(target.questions, line.question);
    if (target.status === '待补充') target.status = '建议确认';
  }

  if (brief.options.length > 0) {
    const target = findModuleForQuickBriefLine(cloned, 'option');
    for (const optionItem of brief.options) {
      if (target.options.some((item) => item.title === optionItem.title)) continue;
      target.options.push(optionItem);
    }
    if (target.status === '待补充') target.status = '有方案可选';
  }

  return cloned;
}

type QuickBriefLineKind = 'goal' | 'audience' | 'scenario' | 'scope' | 'quality' | 'risk' | 'option';

function quickBriefHints(snapshot: unknown): {
  lines: Array<{ kind: QuickBriefLineKind; text: string; question?: string }>;
  options: FormalMapModule['options'];
} {
  const source = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, any> : {};
  const lines: Array<{ kind: QuickBriefLineKind; text: string; question?: string }> = [];

  const expectedOutcome = stringValue(source.expected_outcome);
  if (expectedOutcome) {
    lines.push({
      kind: 'goal',
      text: `期望结果为“${expectedOutcome}”，需要负责人确认是否作为第一版目标。`,
      question: '第一版最重要的用户结果是否就是这个？',
    });
  }

  const targetUsers = stringList(source.target_users).join('、');
  if (targetUsers) {
    lines.push({
      kind: 'audience',
      text: `主要对象为“${targetUsers}”，需要确认优先级和使用责任。`,
      question: '正式项目里谁是最优先服务的对象？',
    });
  }

  const coreScenario = stringValue(source.core_scenario);
  if (coreScenario) {
    lines.push({
      kind: 'scenario',
      text: `核心场景为“${coreScenario}”，需要确认完整流程和异常处理。`,
      question: '这个核心场景里最容易失败或卡住的是哪一步？',
    });
  }

  const included = stringList(source.scope_included);
  const excluded = stringList(source.scope_excluded);
  if (included.length || excluded.length) {
    const parts = [
      included.length ? `本期包含：${included.join('；')}` : '',
      excluded.length ? `本期不包含：${excluded.join('；')}` : '',
    ].filter(Boolean);
    lines.push({
      kind: 'scope',
      text: `${parts.join('。')}。需要负责人确认是否进入首版范围。`,
      question: '这些范围边界是否需要调整或补充？',
    });
  }

  const criteria = objectList(source.completion_criteria)
    .map((item) => stringValue(item.description ?? item.title))
    .filter(Boolean);
  if (criteria.length) {
    lines.push({
      kind: 'quality',
      text: `完成标准候选：${criteria.join('；')}。`,
      question: '这些完成标准是否足以判断第一版可交付？',
    });
  }

  const riskDescriptions = objectList(source.constraints_risks)
    .map((item) => stringValue(item.description ?? item.title))
    .filter(Boolean);
  const unknownQuestions = objectList(source.unknowns)
    .map((item) => stringValue(item.question))
    .filter(Boolean);
  const risks = [
    ...riskDescriptions,
    ...unknownQuestions,
  ];
  if (risks.length) {
    lines.push({
      kind: 'risk',
      text: `风险和待确认点：${risks.join('；')}。`,
      question: unknownQuestions[0] ?? '这些风险和兜底处理方式是否需要调整或补充？',
    });
  }

  const options = objectList(source.candidate_options)
    .map((item, index) => ({
      id: `quick_option_${index + 1}`,
      title: clip(stringValue(item.title) || `候选方案 ${index + 1}`, 24),
      fit: clip(stringValue(item.description) || stringList(item.pros).join('；') || '来自快速问诊的候选方向。', 90),
      tradeoff: clip(stringList(item.cons).join('；') || '需要在正式项目中继续评估成本、风险和适用条件。', 90),
      recommended: item.is_recommended === true || item.isRecommended === true,
    }))
    .filter((item) => item.title);

  return { lines, options };
}

function findModuleForQuickBriefLine(
  modules: FormalMapModule[],
  kind: QuickBriefLineKind,
): FormalMapModule {
  const matcher: Record<QuickBriefLineKind, RegExp> = {
    goal: /目标|结果|成功|用户/,
    audience: /用户|对象|人群|角色|受众/,
    scenario: /流程|场景|交付|形态|体验/,
    scope: /范围|边界|排除|功能/,
    quality: /完成|标准|质量|验收|指标/,
    risk: /风险|兜底|异常|合规|成本/,
    option: /方案|流程|范围|取舍|形态/,
  };
  return modules.find((item) => matcher[kind].test(`${item.id}${item.title}${item.summary}`))
    ?? modules.find((item) => item.id !== 'report')
    ?? modules[0];
}

function appendUnique(list: string[], value: string): void {
  const clean = clip(value, 180);
  if (!clean) return;
  if (!list.some((item) => item === clean || item.includes(clean) || clean.includes(item))) {
    list.push(clean);
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function objectList(value: unknown): Array<Record<string, any>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object');
}

interface IntakeSections {
  description: string;
  roles: string[];
  materials: string[];
  constraints: string[];
}

function extractIntakeSections(input: FormalRuntimeInput): IntakeSections {
  const sections: IntakeSections = {
    description: input.projectDescription.trim(),
    roles: [],
    materials: [],
    constraints: [],
  };

  const lines = input.intakeText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const descriptionLines: string[] = [];
  for (const line of lines) {
    const roles = line.match(/^相关人员[:：]\s*(.+)$/);
    if (roles) {
      sections.roles.push(...splitIntakeItems(roles[1]));
      continue;
    }
    const materials = line.match(/^已有材料[:：]\s*(.+)$/);
    if (materials) {
      sections.materials.push(...splitIntakeItems(materials[1]));
      continue;
    }
    const constraints = line.match(/^约束[:：]\s*(.+)$/);
    if (constraints) {
      sections.constraints.push(...splitIntakeItems(constraints[1]));
      continue;
    }
    descriptionLines.push(line);
  }

  if (!sections.description) {
    sections.description = descriptionLines[0] ?? '';
  }

  sections.roles = uniqueIntakeItems(sections.roles);
  sections.materials = uniqueIntakeItems(sections.materials);
  sections.constraints = uniqueIntakeItems(sections.constraints);
  return sections;
}

function splitIntakeItems(text: string): string[] {
  return text
    .split(/[；;\n]/)
    .map((item) => trimSummaryPunctuation(item.trim()))
    .filter(Boolean);
}

function uniqueIntakeItems(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = normalizeSummaryPart(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(item);
  }
  return result;
}

function baseKnown(input: FormalRuntimeInput): string[] {
  const sections = extractIntakeSections(input);
  const items = [
    sections.description ? `项目描述：${sections.description}` : '',
    sections.roles.length ? `相关人员：${sections.roles.join('；')}` : '',
    sections.materials.length ? `已有材料：${sections.materials.join('；')}` : '',
    sections.constraints.length ? `项目约束：${sections.constraints.join('；')}` : '',
  ].filter(Boolean);
  if (items.length === 0) return ['已记录项目起点。'];
  return items.map((item) => clip(item, 150));
}

function chooseCurrentModule(
  modules: FormalMapModule[],
  turns: FormalRuntimeInput['turns'],
): FormalMapModule {
  const firstWithQuestions = modules.find((item) => item.questions.length > 0 && item.status !== '已整理');
  return firstWithQuestions ?? modules[0];
}

function applyTurnAnswersToModules(
  modules: FormalMapModule[],
  turns: FormalRuntimeInput['turns'],
): FormalMapModule[] {
  const cloned = modules.map((item) => ({
    ...item,
    known: [...item.known],
    assumptions: [...item.assumptions],
    questions: [...item.questions],
    options: [...item.options],
    relatedModuleIds: [...item.relatedModuleIds],
  }));

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn.role !== 'user') continue;
    const answer = clip(turn.content, 180);
    if (!answer) continue;
    const previousQuestion = findPreviousAssistantQuestion(turns, index);
    const target = findAnsweredModule(cloned, previousQuestion, turn.boundRefs);
    if (!target) continue;

    const knownLine = `用户补充：${answer}`;
    if (!target.known.some((item) => item === knownLine || item.includes(answer))) {
      target.known.push(knownLine);
    }
    if (previousQuestion) {
      target.questions = target.questions.filter((question) => question !== previousQuestion);
    } else if (target.questions.length > 0) {
      target.questions = target.questions.slice(1);
    }
    if (target.questions.length === 0) {
      target.status = '已整理';
    } else if (target.status === '待补充' || target.status === '建议确认') {
      target.status = '正在梳理';
    }
  }

  return cloned;
}

function findPreviousAssistantQuestion(
  turns: FormalRuntimeInput['turns'],
  beforeIndex: number,
): string | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'assistant') return turn.content;
  }
  return null;
}

function findAnsweredModule(
  modules: FormalMapModule[],
  previousQuestion: string | null,
  boundRefs?: unknown[],
): FormalMapModule | null {
  const refTitles = Array.isArray(boundRefs)
    ? boundRefs
        .map((ref) => {
          if (!ref || typeof ref !== 'object') return '';
          const record = ref as Record<string, unknown>;
          return typeof record.title === 'string' ? record.title : '';
        })
        .filter(Boolean)
    : [];
  const byRef = refTitles.length
    ? modules.find((item) => refTitles.some((title) => title.includes(item.title) || item.title.includes(title)))
    : null;
  if (byRef) return byRef;
  if (previousQuestion) {
    const byQuestion = modules.find((item) => item.questions.includes(previousQuestion));
    if (byQuestion) return byQuestion;
    const byQuestionText = findAnsweredModuleByQuestionText(modules, previousQuestion);
    if (byQuestionText) return byQuestionText;
  }
  return modules.find((item) => item.questions.length > 0 && item.status !== '已整理') ?? modules[0] ?? null;
}

function findAnsweredModuleByQuestionText(
  modules: FormalMapModule[],
  question: string,
): FormalMapModule | null {
  const rules: Array<{ question: RegExp; module: RegExp }> = [
    { question: /成功|目标|结果|指标|达成/, module: /目标|成功|结果|指标/ },
    { question: /吸引|人群|受众|谁|对象|参加|愿意|用户|居民|家庭/, module: /人群|受众|对象|用户|角色/ },
    { question: /形式|流程|讲座|工作坊|沙龙|展位|线上|线下|签到|互动/, module: /形式|流程|场景|路径/ },
    { question: /预算|人力|场地|资源|物料|分工|人员|责任/, module: /资源|分工|角色|责任|人员/ },
    { question: /渠道|触达|宣传|宣发|报名|素材|提醒/, module: /宣发|报名|渠道|推广|素材/ },
    { question: /风险|兜底|异常|失败|设备|天气|秩序/, module: /风险|预案|异常|兜底/ },
    { question: /报告|策划案|复盘|审批|执行|沟通|给谁看|材料/, module: /报告|复盘|说明|材料|提交/ },
    { question: /范围|边界|包含|不做|排除|首版/, module: /范围|边界|排除|首版/ },
    { question: /验收|完成|标准|检查|判断/, module: /验收|完成|标准|质量/ },
  ];

  for (const rule of rules) {
    if (!rule.question.test(question)) continue;
    const matched = modules.find((item) => rule.module.test(`${item.id}${item.title}${item.summary}`));
    if (matched) return matched;
  }
  return null;
}

function reconcileSnapshotWithTurns(
  snapshot: FormalMapSnapshotOutput,
  input: FormalRuntimeInput,
): FormalMapSnapshotOutput {
  const modules = applyTurnAnswersToModules(snapshot.modules, input.turns);
  const currentModule = chooseCurrentModule(modules, input.turns);
  const nextQuestion = currentModule.questions[0] ?? '这部分目前还有哪一点需要负责人最后确认？';
  const summary = summarizeInput(input);
  return formalMapSnapshotSchema.parse({
    ...snapshot,
    modules,
    currentModuleId: currentModule.id,
    nextQuestion,
    unresolvedItems: unresolvedFromModules(modules),
    reportProjection: buildReportProjection(input, modules, summary, nextQuestion),
  });
}

function unresolvedFromModules(modules: FormalMapModule[]): FormalMapSnapshotOutput['unresolvedItems'] {
  return modules
    .filter((item) => item.questions.length > 0)
    .slice(0, 5)
    .map((item) => ({
      id: `unresolved_${item.id}`,
      label: item.title,
      detail: item.questions[0],
      impact: `${item.title}不明确会影响正式报告和后续执行安排。`,
    }));
}

function mergeIntakeContext(
  snapshot: FormalMapSnapshotOutput,
  input: FormalRuntimeInput,
): FormalMapSnapshotOutput {
  const modules = applyIntakeContextToModules(snapshot.modules, snapshot.currentModuleId, input);
  const summary = summarizeInput(input);
  return formalMapSnapshotSchema.parse({
    ...snapshot,
    summary,
    modules,
    unresolvedItems: unresolvedFromModules(modules),
    reportProjection: buildReportProjection(input, modules, summary, snapshot.nextQuestion),
    qualityNotes: Array.from(new Set([
      ...snapshot.qualityNotes,
      '项目表单中的人员、材料和约束已作为地图上下文保留。',
    ])),
  });
}

function applyIntakeContextToModules(
  modules: FormalMapModule[],
  currentModuleId: string,
  input: FormalRuntimeInput,
): FormalMapModule[] {
  const sections = extractIntakeSections(input);
  if (!sections.description && sections.roles.length === 0 && sections.materials.length === 0 && sections.constraints.length === 0) {
    return modules;
  }

  const cloned = modules.map((item) => ({
    ...item,
    known: [...item.known],
    assumptions: [...item.assumptions],
    questions: [...item.questions],
    options: [...item.options],
    relatedModuleIds: [...item.relatedModuleIds],
  }));

  const current = cloned.find((item) => item.id === currentModuleId) ?? cloned[0];
  if (sections.description) {
    appendUnique(current.known, `项目描述：${sections.description}`);
  }
  if (sections.roles.length) {
    appendIntakeLine(cloned, current, /角色|人员|分工|权限|对象|受众|目标用户|人群|资源/, `相关人员：${sections.roles.join('；')}`);
  }
  if (sections.materials.length) {
    appendIntakeLine(cloned, current, /材料|证据|文献|资源|交付物|报告|说明|来源|物料/, `已有材料：${sections.materials.join('；')}`);
  }
  if (sections.constraints.length) {
    appendIntakeLine(cloned, current, /约束|范围|边界|排除|风险|验收|完成|质量|里程碑|节奏|计划/, `项目约束：${sections.constraints.join('；')}`);
  }

  return cloned;
}

function appendIntakeLine(
  modules: FormalMapModule[],
  current: FormalMapModule,
  matcher: RegExp,
  line: string,
): void {
  appendUnique(current.known, line);
  const target = modules.find((item) => matcher.test(`${item.id}${item.title}${item.summary}`));
  if (target && target.id !== current.id) {
    appendUnique(target.known, line);
  }
}

function buildReportProjection(
  input: FormalRuntimeInput,
  modules: FormalMapModule[],
  summary: string,
  nextQuestion: string,
): FormalMapSnapshotOutput['reportProjection'] {
  const confirmed = buildConfirmedReportSection(input, modules);
  const assumptions = modules.flatMap((item) => item.assumptions.map((assumption) => `- ${item.title}：${assumption}`)).join('\n') || '- 暂无系统推测。';
  const questions = modules.flatMap((item) => item.questions.map((question) => `- ${item.title}：${question}`)).join('\n') || '- 暂无待确认问题。';
  const optionRows = modules.flatMap((item) =>
    item.options.map((opt) => `| ${escapeMarkdownTableCell(item.title)} | ${escapeMarkdownTableCell(opt.title)} | ${escapeMarkdownTableCell(opt.fit)} | ${escapeMarkdownTableCell(opt.tradeoff)} | ${opt.recommended ? '建议优先' : '备选'} |`),
  );
  const options = optionRows.length
    ? [
      '| 模块 | 方案 | 适用情况 | 主要取舍 | 建议 |',
      '| --- | --- | --- | --- | --- |',
      ...optionRows,
    ].join('\n')
    : '当前还没有形成候选方案。建议先补齐关键问题，再比较方案取舍。';

  return {
    overview: [
      summary,
      `当前更适合先围绕“${modules[0]?.title ?? '项目目标'}”和“${modules[1]?.title ?? '范围'}”继续确认。`,
      `下一步建议先回答：${nextQuestion}`,
    ].join('\n\n'),
    detailedReport: [
      '# 正式项目需求分析报告',
      '',
      '## 1. 当前理解摘要',
      '',
      summary,
      '',
      '## 2. 已明确内容',
      '',
      confirmed,
      '',
      '## 3. 系统推测，需要确认',
      '',
      assumptions,
      '',
      '## 4. 模块化需求地图',
      '',
      ...modules.map((item, index) => [
        `### ${index + 1}. ${item.title}`,
        '',
        item.summary,
        '',
        formatModuleKnownForReport(item),
        item.assumptions.length ? `需要确认的判断：${item.assumptions.join('；')}` : '需要确认的判断：暂无。',
        item.questions.length ? `下一步问题：${item.questions.join('；')}` : '下一步问题：暂无。',
        '',
      ].join('\n')),
      '## 5. 候选方案与取舍',
      '',
      options,
      '',
      '## 6. 待确认事项',
      '',
      questions,
      '',
      '## 7. 建议下一步',
      '',
      `先回答当前最高优先级问题：${nextQuestion}`,
      '',
      '## 8. 版本说明',
      '',
      input.sourceKind === 'quick_upgrade'
        ? '本报告由快速问诊简报升级而来，快速简报仅作为候选来源；正式项目中的目标、范围、方案和责任仍需逐项确认。'
        : '本报告由项目初始说明生成，当前仍是整理中的需求地图，不代表最终验收结论。',
    ].join('\n'),
  };
}

const INTAKE_KNOWN_PREFIX_RE = /^(项目描述|相关人员|已有材料|项目约束)：/;

function buildConfirmedReportSection(
  input: FormalRuntimeInput,
  modules: FormalMapModule[],
): string {
  const sections = extractIntakeSections(input);
  const intakeLines = [
    sections.description ? `- 项目起点：${sections.description}` : '',
    sections.roles.length ? `- 相关人员与角色：${sections.roles.join('；')}` : '',
    sections.materials.length ? `- 已有材料：${sections.materials.join('；')}` : '',
    sections.constraints.length ? `- 约束条件：${sections.constraints.join('；')}` : '',
  ].filter(Boolean);

  const moduleLines = uniqueLines(
    modules.flatMap((item) =>
      item.known
        .filter((known) => !INTAKE_KNOWN_PREFIX_RE.test(known))
        .map((known) => `- ${item.title}：${known}`),
    ),
  );

  const lines = [...intakeLines, ...moduleLines];
  return lines.length ? lines.join('\n') : '- 已记录项目起点。';
}

function formatModuleKnownForReport(item: FormalMapModule): string {
  const moduleKnown = uniqueLines(item.known.filter((known) => !INTAKE_KNOWN_PREFIX_RE.test(known)));
  if (moduleKnown.length === 0) {
    return '已明确：暂未形成该模块的可确认内容。';
  }
  return `已明确：${moduleKnown.join('；')}`;
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.replace(/[，。；：、\s]/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '／').replace(/\n/g, ' ').trim();
}

function summarizeInput(input: FormalRuntimeInput): string {
  const sections = extractIntakeSections(input);
  const parts = [input.projectTitle, sections.description || input.projectDescription]
    .map((item) => trimSummaryPunctuation(item.trim().replace(/\s+/g, ' ')))
    .filter(Boolean);
  const uniqueParts = parts.filter((part, index) => {
    const normalized = normalizeSummaryPart(part);
    return !parts.slice(0, index).some((prior) => {
      const priorNormalized = normalizeSummaryPart(prior);
      return priorNormalized.includes(normalized) || normalized.includes(priorNormalized);
    });
  });
  const source = uniqueParts.join('。');
  if (!source) return '当前已进入正式项目问诊，系统将从目标、对象、范围、完成标准和风险开始澄清。';
  const context = [
    sections.roles.length ? `相关人员包括：${clip(sections.roles.join('；'), 90)}` : '',
    sections.materials.length ? `已有材料包括：${clip(sections.materials.join('；'), 90)}` : '',
    sections.constraints.length ? `主要约束包括：${clip(sections.constraints.join('；'), 110)}` : '',
  ].filter(Boolean);
  const contextText = context.length ? `已记录${context.join('；')}。` : '';
  return `当前项目起点是：${trimSummaryPunctuation(clip(source, 110))}。${contextText}后续需要把目标、参与对象、范围边界、完成标准和风险逐步确认清楚。`;
}

function normalizeSummaryPart(text: string): string {
  return text
    .replace(/[，。；：、\s]/g, '')
    .trim();
}

function trimSummaryPunctuation(text: string): string {
  return text.replace(/[。；，、,.!?！？;；:：]+$/g, '').trim();
}

function titleFromText(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return '正式项目';
  return clip(clean, 18);
}

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function mergeWithFallback(
  model: FormalMapSnapshotOutput,
  fallback: FormalMapSnapshotOutput,
): FormalMapSnapshotOutput {
  const modelDrifted = hasThemeDrift(model, fallback);
  const safeModules = model.modules
    .filter((item) => !hasDeveloperTerms(item.title) && !hasDeveloperTerms(item.summary))
    .slice(0, 12);
  const modules = (modelDrifted ? fallback.modules : safeModules.length >= 3 ? safeModules : fallback.modules).map(sanitizeModule);
  const currentModuleId =
    !modelDrifted && modules.some((item) => item.id === model.currentModuleId)
      ? model.currentModuleId
      : modules[0].id;
  const overview =
    !modelDrifted && model.reportProjection.overview.length >= 80 && !hasDeveloperTerms(model.reportProjection.overview)
      ? sanitizeUserVisibleText(model.reportProjection.overview)
      : fallback.reportProjection.overview;
  const detailedReport =
    !modelDrifted && model.reportProjection.detailedReport.length >= 600 && !hasDeveloperTerms(model.reportProjection.detailedReport)
      ? sanitizeUserVisibleText(model.reportProjection.detailedReport)
      : fallback.reportProjection.detailedReport;
  return formalMapSnapshotSchema.parse({
    ...fallback,
    ...(modelDrifted ? {} : model),
    title: modelDrifted || hasDeveloperTerms(model.title) ? fallback.title : sanitizeUserVisibleText(model.title),
    summary: modelDrifted || hasDeveloperTerms(model.summary) ? fallback.summary : sanitizeUserVisibleText(model.summary),
    currentModuleId,
    nextQuestion: modelDrifted || hasDeveloperTerms(model.nextQuestion) ? fallback.nextQuestion : sanitizeUserVisibleText(model.nextQuestion),
    modules,
    unresolvedItems: modelDrifted ? fallback.unresolvedItems : model.unresolvedItems.length ? model.unresolvedItems : fallback.unresolvedItems,
    reportProjection: {
      overview,
      detailedReport,
    },
    qualityNotes: Array.from(new Set([
      ...fallback.qualityNotes,
      ...(modelDrifted ? ['模型输出偏离项目类型，已按当前项目本体回退整理。'] : model.qualityNotes),
    ].map(sanitizeUserVisibleText))),
  });
}

function hasThemeDrift(model: FormalMapSnapshotOutput, fallback: FormalMapSnapshotOutput): boolean {
  if (fallback.projectType !== '软件或数字产品') return false;
  const modelText = [
    model.projectType,
    model.title,
    model.summary,
    ...model.modules.flatMap((item) => [item.title, item.summary]),
  ].join('\n');
  const activitySignals = (modelText.match(/活动目标|目标人群|活动形式|宣发|报名|嘉宾|场地|策划案|复盘/g) ?? []).length;
  const productSignals = (modelText.match(/网站|系统|平台|工具|小程序|App|生成|功能|用户|流程/g) ?? []).length;
  return activitySignals >= 3 && productSignals < activitySignals + 2;
}

function sanitizeModule(module: FormalMapModule): FormalMapModule {
  return {
    ...module,
    title: sanitizeUserVisibleText(module.title),
    summary: sanitizeUserVisibleText(module.summary),
    known: module.known.map(sanitizeUserVisibleText),
    assumptions: module.assumptions.map(sanitizeUserVisibleText),
    questions: module.questions.map(sanitizeUserVisibleText),
    options: module.options?.map((option) => ({
      ...option,
      title: sanitizeUserVisibleText(option.title),
      fit: sanitizeUserVisibleText(option.fit),
      tradeoff: sanitizeUserVisibleText(option.tradeoff),
    })),
  };
}

function sanitizeUserVisibleText(text: string): string {
  return text
    .replace(/候选理解/g, '整理结果')
    .replace(/正式基线/g, '最终验收结论')
    .replace(/正式确认/g, '负责人确认')
    .replace(/报告快照/g, '报告预览')
    .replace(/地图快照/g, '需求地图')
    .replace(/建档/g, '初始说明');
}

function hasDeveloperTerms(text: string): boolean {
  return /agent|skill|schema|slot|blocking|understanding_review|option_review|custom|sample|stub|API Key/i.test(text);
}

export function formalInputHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null), 'utf8').digest('hex');
}

export function modelNameForFormalProvider(): string {
  if (env.AI_PROVIDER === 'openai_compatible') return env.OPENAI_COMPAT_MODEL;
  if (env.AI_PROVIDER === 'ollama') return env.OLLAMA_MODEL;
  return 'formal-runtime-fallback';
}
