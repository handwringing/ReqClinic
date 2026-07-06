import type { AppDb } from '../db/client';
import type { AiInvokeResult, AiProvider, SkillInvocationAudit } from '../ai/provider';
import type { AiJob } from '../db/schema/job';
import { env } from '../config/env';
import { QuickConsultRuntime } from '../agent/quick-runtime';
import {
  QUICK_SLOT_IDS,
  quickRuntimeOutputSchema,
  type QuickRuntimeOutput,
  type QuickSlotId,
  type QuickSlotStatus,
  type QuickTurn,
} from '../agent/quick-schemas';
import { QuickSessionRepo } from '../repo/quick-session-repo';
import { QuickTurnRepo } from '../repo/quick-turn-repo';
import { QuickUnknownRepo } from '../repo/quick-unknown-repo';
import { BriefRepo } from '../repo/brief-repo';
import { now } from '../shared/time';

const QUICK_RUNTIME_SCHEMA_VERSION = 'quick_runtime_output.v1';
const QUICK_MODEL_SKILLS = [
  'quick.structuring.understanding_patch',
  'quick.elicitation.next_question',
  'quick.decisioning.options',
  'quick.composition.brief_views',
];

type CoverageState = 'covered' | 'partial' | 'not_started';

interface CoverageSlotProjection {
  slot_id: QuickSlotId;
  status: CoverageState;
  last_updated: string | null;
  label: string;
  is_blocking: boolean;
}

interface QuickStoredSnapshot {
  slots: CoverageSlotProjection[];
  understanding: QuickRuntimeOutput['structuring']['understanding'];
  unknowns: QuickRuntimeOutput['validation']['unknowns'];
  quality_issues: QuickRuntimeOutput['validation']['qualityIssues'];
  options: QuickRuntimeOutput['decisioning']['options'];
  recommendation: string;
  views: QuickRuntimeOutput['composition']['views'];
  routing: QuickRuntimeOutput['routing'];
  updated_by: string;
  updated_at: string;
}

type QuickRuntimeWithAudit = QuickRuntimeOutput & { audit: SkillInvocationAudit[] };

export class QuickJobExecutor {
  private readonly runtime: QuickConsultRuntime;
  private readonly quickSessionRepo: QuickSessionRepo;
  private readonly quickTurnRepo: QuickTurnRepo;
  private readonly quickUnknownRepo: QuickUnknownRepo;
  private readonly briefRepo: BriefRepo;

  constructor(
    db: AppDb,
    private readonly provider: AiProvider,
  ) {
    this.runtime = new QuickConsultRuntime(provider);
    this.quickSessionRepo = new QuickSessionRepo(db.db);
    this.quickTurnRepo = new QuickTurnRepo(db.db);
    this.quickUnknownRepo = new QuickUnknownRepo(db.db);
    this.briefRepo = new BriefRepo(db.db);
  }

  async process(job: AiJob, payload: unknown): Promise<AiInvokeResult> {
    if (!job.quickSessionId) {
      throw new Error(`Quick job ${job.id} has no quick_session_id`);
    }
    const session = this.quickSessionRepo.findById(job.quickSessionId);
    if (!session) {
      throw new Error(`Quick session not found for job ${job.id}`);
    }

    this.ensureOriginalTurn(session.id, session.originalInput);
    const turns = this.loadTurns(session.id);
    const forceBrief =
      job.taskType === 'brief_generation' ||
      session.status === 'brief_ready';
    const modelEnabled = env.AI_PROVIDER !== 'stub' && session.sourceKind !== 'sample';
    let runtimeResult = await this.runtime.run({
      originalInput: session.originalInput,
      turns,
      forceBrief,
      forceDecisioning:
        forceBrief ||
        job.taskType === 'understanding_review' ||
        session.status === 'option_review',
      modelEnabled,
      modelSkillIds: QUICK_MODEL_SKILLS,
    });
    runtimeResult = applySampleScriptIfAvailable(
      session.sourceKind,
      session.sourceCaseId,
      turns,
      runtimeResult,
      forceBrief ||
        job.taskType === 'understanding_review' ||
        session.status === 'option_review',
      forceBrief,
    );
    const runtime = quickRuntimeOutputSchema.parse(runtimeResult);

    const snapshot = this.persistRuntime(job, runtime);
    const output = this.applyTaskResult(job, payload, runtime, snapshot);

    return {
      output,
      provider: modelEnabled ? env.AI_PROVIDER : 'quick-runtime-fallback',
      model: modelEnabled ? modelNameForCurrentProvider() : 'quick-runtime-fallback',
      promptVersion: QUICK_RUNTIME_SCHEMA_VERSION,
      inputTokens: sumSkillTokens(runtimeResult.audit, 'inputTokens'),
      outputTokens: sumSkillTokens(runtimeResult.audit, 'outputTokens'),
      thinkingMode: aggregateThinkingMode(runtimeResult.audit),
      usageEstimated: runtimeResult.audit.some((audit) => audit.usageEstimated),
      skillAudits: runtimeResult.audit,
    };
  }

  private ensureOriginalTurn(sessionId: string, originalInput: string): void {
    const existing = this.quickTurnRepo.listBySession(sessionId, { limit: 1 }).items;
    if (existing.length > 0) return;
    this.quickTurnRepo.create({
      quickSessionId: sessionId,
      role: 'user',
      content: originalInput,
      messageType: 'answer',
    });
  }

  private loadTurns(sessionId: string): QuickTurn[] {
    return this.quickTurnRepo
      .listBySession(sessionId, { limit: 200 })
      .items.map((turn) => ({
        role: turn.role === 'ai' ? 'assistant' : 'user',
        content: turn.content,
      }));
  }

  private persistRuntime(job: AiJob, runtime: QuickRuntimeOutput): QuickStoredSnapshot {
    const ts = now();
    const snapshot: QuickStoredSnapshot = {
      slots: projectCoverage(runtime, ts),
      understanding: runtime.structuring.understanding,
      unknowns: runtime.validation.unknowns,
      quality_issues: runtime.validation.qualityIssues,
      options: runtime.decisioning.options,
      recommendation: runtime.decisioning.recommendation,
      views: runtime.composition.views,
      routing: runtime.routing,
      updated_by: job.id,
      updated_at: ts,
    };
    const session = this.quickSessionRepo.findById(job.quickSessionId!);
    if (!session) {
      throw new Error(`Quick session not found for job ${job.id}`);
    }

    this.quickUnknownRepo.replaceForSession(
      session.id,
      runtime.validation.unknowns.map((unknown) => ({
        slot: toDbUnknownCategory(unknown.slot),
        question: unknown.question,
        severity: unknown.isBlocking ? 'blocking' : 'warning',
        status: 'open',
      })),
    );

    const nextStatus = nextSessionStatus(session.status, job.taskType, runtime, parsePayload(payloadFromJob(job)));
    this.quickSessionRepo.updateRuntimeSnapshot({
      id: session.id,
      coverageSlotsJson: JSON.stringify(snapshot),
      status: nextStatus,
      understandingVersion: session.currentUnderstandingVersion + 1,
    });
    return snapshot;
  }

  private applyTaskResult(
    job: AiJob,
    payload: unknown,
    runtime: QuickRuntimeOutput,
    snapshot: QuickStoredSnapshot,
  ): unknown {
    const sessionId = job.quickSessionId!;
    const payloadObj = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const session = this.quickSessionRepo.findById(sessionId);
    if (!session) {
      throw new Error(`Quick session not found for job ${job.id}`);
    }

    if (job.taskType === 'understanding_review') {
      const action = typeof payloadObj.action === 'string' ? payloadObj.action : 'correct';
      if (action === 'correct') {
        this.appendAiTurnOnce(sessionId, '我已按当前理解准备好方案比较。你可以先查看推荐方案，再生成需求简报。');
        this.quickSessionRepo.updateStatus(sessionId, 'option_review');
        return {
          result_type: 'understanding_updated',
          new_understanding_version: session.currentUnderstandingVersion + 1,
          next_step: 'option_review',
        };
      }
      this.appendQuestionOrReviewPrompt(sessionId, runtime);
      return {
        result_type: 'understanding_updated',
        new_understanding_version: session.currentUnderstandingVersion + 1,
        next_step: runtime.validation.canEnterReview ? 'understanding_review' : 'clarifying',
      };
    }

    if (job.taskType === 'option_comparison') {
      return {
        result_type: 'option_comparison',
        options: runtime.decisioning.options,
        recommendation: runtime.decisioning.recommendation,
        next_step: 'brief_generation',
      };
    }

    if (job.taskType === 'brief_generation') {
      const brief = this.createBriefVersion(sessionId, runtime, snapshot);
      this.quickSessionRepo.setCurrentBriefVersion({
        id: sessionId,
        briefVersionId: brief.id,
        status: 'brief_ready',
      });
      return {
        result_type: 'brief_version',
        brief_version: brief.version,
        is_incomplete: brief.isIncomplete === 1,
        blocking_unknown_count: brief.blockingUnknownCount,
      };
    }

    if (session.status === 'brief_ready') {
      const brief = this.createBriefVersion(sessionId, runtime, snapshot);
      this.quickSessionRepo.setCurrentBriefVersion({
        id: sessionId,
        briefVersionId: brief.id,
        status: 'brief_ready',
      });
      return {
        result_type: 'brief_version',
        brief_version: brief.version,
        is_incomplete: brief.isIncomplete === 1,
        blocking_unknown_count: brief.blockingUnknownCount,
      };
    }

    this.appendQuestionOrReviewPrompt(sessionId, runtime);
    return {
      result_type: 'next_question',
      next_question: runtime.elicitation.question
        ? {
            question_id: `qst_${job.id}`,
            text: runtime.elicitation.question,
            topic: runtime.elicitation.slot ?? runtime.validation.nextQuestionSlot ?? 'expected_outcome',
          }
        : null,
      coverage_slots: snapshot.slots,
      is_blocking_unknown: runtime.validation.unknowns.some((unknown) => unknown.isBlocking),
    };
  }

  private appendQuestionOrReviewPrompt(
    sessionId: string,
    runtime: QuickRuntimeOutput,
  ): void {
    if (runtime.validation.canEnterReview) {
      this.appendAiTurnOnce(
        sessionId,
        '我已把当前理解整理好了。请先复核整理区内容；如果有一处需要调整，可以点击对应卡片加入对话框后再发送修改。',
      );
      return;
    }
    if (runtime.elicitation.question) {
      this.quickTurnRepo.create({
        quickSessionId: sessionId,
        role: 'ai',
        content: runtime.elicitation.question,
        messageType: 'question',
      });
    }
  }

  private appendAiTurnOnce(sessionId: string, content: string): void {
    const latest = this.quickTurnRepo.listBySession(sessionId, { limit: 1 }).items.at(-1);
    if (latest?.role === 'ai' && latest.content === content) return;
    this.quickTurnRepo.create({
      quickSessionId: sessionId,
      role: 'ai',
      content,
      messageType: 'status',
    });
  }

  private createBriefVersion(
    sessionId: string,
    runtime: QuickRuntimeOutput,
    snapshot: QuickStoredSnapshot,
  ) {
    const blockingUnknownCount = runtime.validation.unknowns.filter((u) => u.isBlocking).length;
    const briefSnapshot = buildBriefSnapshot(runtime, snapshot);
    return this.briefRepo.createVersion({
      quickSessionId: sessionId,
      contentJson: JSON.stringify(briefSnapshot),
      status: blockingUnknownCount > 0 ? 'incomplete' : 'complete',
      blockingUnknownCount,
    });
  }
}

const POSTER_SAMPLE_STEPS = [
  {
    slot: 'expected_outcome' as QuickSlotId,
    question: '我先确认一下你说的“海报”指什么。你希望生成的是一个可以在线访问的网页，还是一张可供下载的图片文件？',
    unknownLabel: '交付形态',
  },
  {
    slot: 'target_user' as QuickSlotId,
    question: '明白，交付物是网页。那么这个网站主要给谁用？是团队内部宣传岗同事批量出海报，还是面向个人创作者自助生成？',
    unknownLabel: '主要使用者',
  },
  {
    slot: 'completion_criteria' as QuickSlotId,
    question: '你提到“30秒内能出结果”，这个30秒是指从输入到海报生成完成的时间，还是指生成完后在手机上首次打开看到画面的时间？',
    unknownLabel: '完成判断口径',
  },
  {
    slot: 'scope_boundary' as QuickSlotId,
    question: '最后一个问题：生成出来的海报，是否需要支持多人协作编辑或二次修改？这会影响是否要做编辑器和权限体系。',
    unknownLabel: '协作与二次修改',
  },
];

function applySampleScriptIfAvailable(
  sourceKind: string,
  sourceCaseId: string | null,
  turns: QuickTurn[],
  runtime: QuickRuntimeWithAudit,
  forceDecisioning: boolean,
  forceBrief: boolean,
): QuickRuntimeWithAudit {
  if (sourceKind !== 'sample' || !sourceCaseId) return runtime;
  if (sourceCaseId === 'ai-poster-website') {
    return applyPosterSampleScript(turns, runtime, forceDecisioning, forceBrief);
  }
  const demoCase = SAMPLE_DEMO_CASES[sourceCaseId];
  if (!demoCase) return runtime;
  return applyGenericSampleScript(demoCase, turns, runtime, forceDecisioning, forceBrief);
}

interface SampleStep {
  slot: QuickSlotId;
  question: string;
  label: string;
}

interface SampleCardUpdate {
  cardId: QuickSlotId | 'unknowns';
  slot: QuickSlotId;
  value: string;
  answerNeedle: string;
}

interface SampleDemoCase {
  title: string;
  steps: SampleStep[];
  slots: Partial<Record<QuickSlotId, string>>;
  review: SampleCardUpdate;
  supplement: SampleCardUpdate;
  unknown: {
    id: string;
    slot: QuickSlotId;
    question: string;
    impact: string;
  };
  options: Array<{
    id: string;
    title: string;
    description: string;
    pros: string[];
    cons: string[];
    isRecommended: boolean;
  }>;
}

const SAMPLE_DEMO_CASES: Record<string, SampleDemoCase> = {
  'campus-marketplace': {
    title: '校园二手交易小程序',
    steps: [
      { slot: 'expected_outcome', label: '首版目标', question: '这个小程序第一版更想解决“发布信息”还是“完成交易闭环”？两者会影响支付、聊天和纠纷处理范围。' },
      { slot: 'target_user', label: '校内身份', question: '目标用户是否只限本校学生？如果是，需要什么方式确认身份？' },
      { slot: 'core_scenario', label: '核心流程', question: '首版最关键的使用场景是什么：发布、搜索、私聊、举报，还是线下交接记录？' },
      { slot: 'scope_boundary', label: '范围边界', question: '为了控制范围，第一版是否明确不做支付、物流和担保交易？' },
    ],
    slots: {
      expected_outcome: '校内闲置发布、搜索、联系更安全',
      target_user: '本校学生，需校园邮箱或学号认证',
      core_scenario: '发布闲置、分类搜索、私聊约线下交接，必要时举报',
      scope_boundary: '首版不做支付、物流、担保交易',
      completion_criteria: '学生能完成发布、搜索、私聊和举报的端到端流程',
      constraints_risks: '身份认证、违规商品、线下纠纷和隐私保护需要明确',
    },
    review: {
      cardId: 'constraints_risks',
      slot: 'constraints_risks',
      value: '校内身份认证、违规商品审核、举报处理和线下纠纷规则需要首版说明清楚',
      answerNeedle: '违规商品审核',
    },
    supplement: {
      cardId: 'unknowns',
      slot: 'constraints_risks',
      value: '违规商品清单由学生事务处提供初版，平台管理员每月维护；举报高频项可以随时补充',
      answerNeedle: '学生事务处',
    },
    unknown: {
      id: 'cmp_unknown_001',
      slot: 'constraints_risks',
      question: '违规商品清单由谁维护？',
      impact: '影响审核和举报规则。',
    },
    options: [
      {
        id: 'cmp_option_a',
        title: '信息发布优先',
        description: '先验证发布、搜索和私聊需求，再决定是否补交易闭环。',
        pros: ['上线快', '风险低'],
        cons: ['不能沉淀完整交易数据'],
        isRecommended: true,
      },
      {
        id: 'cmp_option_trade',
        title: '交易闭环优先',
        description: '首版直接考虑支付、担保和纠纷处理，更接近完整平台。',
        pros: ['交易数据更完整'],
        cons: ['治理、合规和开发成本更高'],
        isRecommended: false,
      },
    ],
  },
  'aigc-education-paper': {
    title: '生成式智能教育影响课程论文',
    steps: [
      { slot: 'completion_criteria', label: '课程要求', question: '这篇论文的课程要求是什么？先确认字数、截止时间和是否有评分标准。' },
      { slot: 'scope_boundary', label: '讨论范围', question: '你更想讨论哪个教育阶段或场景：中小学、高校、教师备课、学生写作，还是评价方式？' },
      { slot: 'expected_outcome', label: '论证主线', question: '你倾向提出什么核心问题：它提高学习效率，还是削弱原创性与评价公平？' },
      { slot: 'constraints_risks', label: '材料证据', question: '材料方面，老师是否允许使用英文文献和真实案例？这会影响证据范围。' },
    ],
    slots: {
      expected_outcome: '形成一篇有明确研究问题和论证主线的课程论文',
      target_user: '课程教师与学生本人',
      core_scenario: '课程作业，两周内完成3000字论文',
      scope_boundary: '聚焦高校学生写作，不泛化到所有教育场景',
      completion_criteria: '3000字、文献引用充分、问题明确、结构清晰',
      constraints_risks: '需平衡效率、原创性和评价公平，引用英文文献与高校政策案例',
    },
    review: {
      cardId: 'completion_criteria',
      slot: 'completion_criteria',
      value: '两周内完成3000字课程论文，具备清晰论点、章节结构和可引用材料清单',
      answerNeedle: '可引用材料清单',
    },
    supplement: {
      cardId: 'unknowns',
      slot: 'completion_criteria',
      value: '至少引用6篇文献、其中2篇英文文献，参考文献按APA格式整理',
      answerNeedle: '至少引用',
    },
    unknown: {
      id: 'aep_unknown_001',
      slot: 'completion_criteria',
      question: '引用格式和最低文献数量是否有要求？',
      impact: '影响论文结构、材料筛选和最终排版。',
    },
    options: [
      {
        id: 'aep_option_a',
        title: '问题导向论文',
        description: '围绕“效率与公平的张力”组织章节。',
        pros: ['论点集中', '便于引用文献'],
        cons: ['需要筛选材料'],
        isRecommended: true,
      },
      {
        id: 'aep_option_broad',
        title: '综述铺陈型论文',
        description: '按技术、教学、评价和治理分块综述，覆盖面更宽。',
        pros: ['材料更容易铺开'],
        cons: ['容易泛泛而谈，中心论点较弱'],
        isRecommended: false,
      },
    ],
  },
  'gym-renewal-service': {
    title: '健身房会员续费流程',
    steps: [
      { slot: 'expected_outcome', label: '核心指标', question: '这次优化的核心指标是什么：续费率、续费金额、投诉减少，还是员工跟进效率？' },
      { slot: 'core_scenario', label: '流失节点', question: '会员通常在哪个节点流失：到期前无提醒、价格沟通、课程体验，还是续费手续太麻烦？' },
      { slot: 'target_user', label: '服务角色', question: '续费流程涉及哪些角色？前台、会籍顾问、教练和店长分别做什么？' },
      { slot: 'scope_boundary', label: '首版范围', question: '第一版是先改人工流程，还是要同时接客户管理系统、短信和企业微信？' },
    ],
    slots: {
      expected_outcome: '提升会员续费率和员工跟进效率',
      target_user: '会员、会籍顾问、教练、店长',
      core_scenario: '到期前提醒、顾问跟进、教练反馈辅助、店长查看数据',
      scope_boundary: '首版改人工流程和企业微信提醒，客户管理系统集成放到第二版',
      completion_criteria: '续费跟进节点可追踪，顾问漏跟进减少',
      constraints_risks: '会员隐私、员工执行一致性、提醒频率打扰感',
    },
    review: {
      cardId: 'core_scenario',
      slot: 'core_scenario',
      value: '到期前14天提醒、顾问跟进、教练补充训练反馈、店长查看转化结果',
      answerNeedle: '到期前14天',
    },
    supplement: {
      cardId: 'unknowns',
      slot: 'completion_criteria',
      value: '8周内月续费率从42%提升到50%，同时观察漏跟进数量变化',
      answerNeedle: '42%',
    },
    unknown: {
      id: 'grs_unknown_001',
      slot: 'completion_criteria',
      question: '当前续费率和目标提升幅度是多少？',
      impact: '影响完成标准是否可度量。',
    },
    options: [
      {
        id: 'grs_option_a',
        title: '流程先行',
        description: '先统一跟进节点和企业微信提醒，再评估系统集成。',
        pros: ['改动快', '便于验证'],
        cons: ['自动化程度有限'],
        isRecommended: true,
      },
      {
        id: 'grs_option_system',
        title: '系统集成优先',
        description: '同时接入客户管理系统和自动化消息，减少人工记录。',
        pros: ['长期自动化更好'],
        cons: ['上线慢，容易先卡在数据和系统对接'],
        isRecommended: false,
      },
    ],
  },
  'corporate-website-outsourcing': {
    title: '企业官网外包采购',
    steps: [
      { slot: 'expected_outcome', label: '官网目的', question: '官网的主要目的是什么：品牌展示、获客线索、招聘展示，还是投资人/客户背书？' },
      { slot: 'core_scenario', label: '栏目功能', question: '首版需要哪些栏目和功能？例如首页、产品、案例、新闻、表单、内容管理、多语言。' },
      { slot: 'completion_criteria', label: '交付物', question: '交付物包括哪些：设计稿、前端代码、部署上线、内容管理、文案、图片拍摄，还是只做页面？' },
      { slot: 'scope_boundary', label: '排除项', question: '为了减少返工，哪些内容要明确排除？例如拍摄、品牌重做、复杂会员系统、长期运维。' },
    ],
    slots: {
      expected_outcome: '品牌展示与获客线索',
      target_user: '潜在客户、合作伙伴和企业市场负责人',
      core_scenario: '访问官网了解产品案例并提交联系表单',
      scope_boundary: '排除拍摄、品牌重做、长期运维和会员系统',
      completion_criteria: '设计稿、前端代码和部署上线完成，联系表单可用',
      constraints_risks: '需明确素材责任、验收标准、里程碑和变更机制',
    },
    review: {
      cardId: 'scope_boundary',
      slot: 'scope_boundary',
      value: '首版只做企业官网设计、前端开发和上线，排除拍摄、品牌重做、会员系统和长期运维',
      answerNeedle: '首版只做企业官网设计',
    },
    supplement: {
      cardId: 'unknowns',
      slot: 'scope_boundary',
      value: '首版不做完整CMS，只保留联系表单后台；产品案例和关于我们内容由甲方市场负责人交付',
      answerNeedle: '不做完整内容管理系统',
    },
    unknown: {
      id: 'cwo_unknown_001',
      slot: 'scope_boundary',
      question: '是否需要内容管理功能以及谁维护内容？',
      impact: '影响报价、交付和长期责任边界。',
    },
    options: [
      {
        id: 'cwo_option_a',
        title: '工作范围先明确',
        description: '先产出工作范围、交付物、排除项和验收表，再询价。',
        pros: ['减少返工', '便于比价'],
        cons: ['前期澄清更多'],
        isRecommended: true,
      },
      {
        id: 'cwo_option_fast',
        title: '直接询价推进',
        description: '先让供应商按经验报价，再在沟通中逐步补范围。',
        pros: ['启动更快'],
        cons: ['报价不可比，后续变更和返工风险高'],
        isRecommended: false,
      },
    ],
  },
  'ai-interview-assistant-capstone': {
    title: '智能面试助手毕业设计',
    steps: [
      { slot: 'expected_outcome', label: '答辩目标', question: '这个毕业设计的主要评审对象是谁？老师看重可运行演示、研究创新，还是工程完整度？' },
      { slot: 'core_scenario', label: '核心能力', question: '第一版核心能力是生成面试题、模拟面试、评分反馈，还是岗位能力画像？' },
      { slot: 'target_user', label: '团队分工', question: '三个人分别负责什么？前端、后端、模型、资料和答辩材料是否有人负责？' },
      { slot: 'constraints_risks', label: '风险边界', question: '有没有必须避开的风险，比如录音隐私、真实面试数据、模型幻觉或学校伦理要求？' },
    ],
    slots: {
      expected_outcome: '可答辩演示的智能面试助手',
      target_user: '三人小组、答辩老师、模拟求职者',
      core_scenario: '选择岗位、模拟问答、生成评分反馈、展示答辩材料',
      scope_boundary: '题库生成简化，不采集真实面试数据，不做录音',
      completion_criteria: '端到端演示稳定，评分反馈可解释，答辩材料完整',
      constraints_risks: '模型幻觉、隐私合规、团队分工和时间节点',
    },
    review: {
      cardId: 'target_user',
      slot: 'target_user',
      value: '三人项目组、答辩老师和演示中的模拟求职者，真实求职者不纳入首版',
      answerNeedle: '真实求职者不纳入首版',
    },
    supplement: {
      cardId: 'unknowns',
      slot: 'completion_criteria',
      value: '第6周跑通模拟面试到评分反馈闭环，第14周完成答辩版本',
      answerNeedle: '第 6 周',
    },
    unknown: {
      id: 'aia_unknown_001',
      slot: 'completion_criteria',
      question: '最终答辩日期和中期检查节点是什么？',
      impact: '影响版本计划和范围裁剪。',
    },
    options: [
      {
        id: 'aia_option_a',
        title: '演示闭环优先',
        description: '先保证模拟面试到评分反馈的闭环，再扩展题库和报告。',
        pros: ['适合答辩', '分工清晰'],
        cons: ['研究深度需另补材料'],
        isRecommended: true,
      },
      {
        id: 'aia_option_research',
        title: '研究创新优先',
        description: '先投入岗位画像和评价模型，突出论文创新点。',
        pros: ['研究表达更强'],
        cons: ['演示闭环和工程稳定性风险更高'],
        isRecommended: false,
      },
    ],
  },
  'social-anxiety-coach': {
    title: '社恐沟通训练智能产品',
    steps: [
      { slot: 'core_scenario', label: '练习场景', question: '先不急着定产品形态。你说的“练沟通”更像练什么时刻：破冰聊天、面试、汇报、恋爱社交，还是线下点单问路？' },
      { slot: 'target_user', label: '目标人群', question: '目标用户更偏学生、职场新人，还是长期社交焦虑的人？不同人群需要的反馈强度不一样。' },
      { slot: 'expected_outcome', label: '助手角色', question: '智能助手的角色更像陪练对象、反馈教练，还是脚本生成器？' },
      { slot: 'completion_criteria', label: '验证重点', question: '第一版要验证什么最大不确定性：用户是否愿意练、反馈是否有用，还是付费意愿？' },
    ],
    slots: {
      expected_outcome: '智能陪练并给出沟通反馈',
      target_user: '学生与职场新人',
      core_scenario: '面试和汇报前进行模拟练习，结束后得到反馈',
      scope_boundary: '不做医疗或心理治疗方向，脚本生成只是辅助',
      completion_criteria: '验证用户是否愿意持续练习，以及反馈是否有帮助',
      constraints_risks: '心理健康边界、反馈伤害感、隐私和长期留存',
    },
    review: {
      cardId: 'scope_boundary',
      slot: 'scope_boundary',
      value: '只做沟通陪练和反馈，不提供心理诊断或治疗建议，并明确隐私保护',
      answerNeedle: '不提供心理诊断',
    },
    supplement: {
      cardId: 'unknowns',
      slot: 'completion_criteria',
      value: '先假设每周练习3次、每次10分钟；首轮验证看7天内是否完成至少2次练习',
      answerNeedle: '每周练习',
    },
    unknown: {
      id: 'sac_unknown_001',
      slot: 'completion_criteria',
      question: '用户愿意在什么频率下练习？',
      impact: '影响留存假设和产品节奏。',
    },
    options: [
      {
        id: 'sac_option_a',
        title: '验证型原型',
        description: '先做陪练和反馈的最小闭环，用真实练习意愿决定后续方向。',
        pros: ['避免过早定稿', '能验证真实需求'],
        cons: ['功能完整度较低'],
        isRecommended: true,
      },
      {
        id: 'sac_option_full',
        title: '完整训练产品',
        description: '首版就加入课程、长期计划和多场景库。',
        pros: ['产品感更完整'],
        cons: ['验证周期长，也更容易越过非医疗边界'],
        isRecommended: false,
      },
    ],
  },
};

function applyGenericSampleScript(
  demoCase: SampleDemoCase,
  turns: QuickTurn[],
  runtime: QuickRuntimeWithAudit,
  forceDecisioning: boolean,
  forceBrief: boolean,
): QuickRuntimeWithAudit {
  const userTurns = turns.filter((turn) => turn.role === 'user').map((turn) => turn.content);
  const answers = userTurns.slice(1);
  const combined = userTurns.join('\n');
  const hasReviewRevision = includesNeedle(combined, demoCase.review.answerNeedle);
  const hasSupplement = includesNeedle(combined, demoCase.supplement.answerNeedle);
  const guidedAnswerCount = Math.min(
    answers.filter((answer) => !answer.trim().startsWith('【')).length,
    demoCase.steps.length,
  );
  const canEnterReview = guidedAnswerCount >= demoCase.steps.length;
  const nextStep = canEnterReview ? null : demoCase.steps[guidedAnswerCount];
  const slots = buildSampleSlots(demoCase, guidedAnswerCount, hasReviewRevision, hasSupplement);
  const unknowns = canEnterReview
    ? hasSupplement
      ? []
      : [sampleUnknown(demoCase)]
    : [sampleStepUnknown(demoCase, nextStep)];
  const options = canEnterReview || forceDecisioning ? demoCase.options : [];

  const patchedRuntime: QuickRuntimeWithAudit = {
    ...runtime,
    structuring: {
      understanding: {
        summary: buildSampleSummary(demoCase, slots),
        slots,
      },
      changedSlots: QUICK_SLOT_IDS.filter((slot) => slots[slot]?.value),
    },
    validation: {
      canEnterReview,
      nextQuestionSlot: nextStep?.slot ?? null,
      unknowns,
      qualityIssues: unknowns.map((unknown) => ({
        dimension: unknown.slot === demoCase.unknown.slot ? '未知项' : '完整性',
        userLabel: `${unknown.label}需要确认：${unknown.question}`,
        internalCode: `sample_quality_${unknown.slot}`,
        severity: unknown.isBlocking ? 'blocking' : 'warning',
        suggestedQuestion: unknown.question,
        priorityScore: unknown.priorityScore,
      })),
    },
    elicitation: {
      question: nextStep?.question ?? null,
      slot: nextStep?.slot ?? null,
      rationale: nextStep ? '按案例脚本继续澄清一个关键问题。' : '当前案例已进入理解复核。',
    },
    decisioning: {
      options,
      recommendation: options.find((item) => item.isRecommended)?.description ?? options[0]?.description ?? '请先完成案例问答，再查看方案。',
    },
  };

  return {
    ...patchedRuntime,
    composition: buildGenericSampleComposition(demoCase, patchedRuntime, forceBrief || canEnterReview),
  };
}

function buildSampleSlots(
  demoCase: SampleDemoCase,
  guidedAnswerCount: number,
  hasReviewRevision: boolean,
  hasSupplement: boolean,
): QuickRuntimeOutput['structuring']['understanding']['slots'] {
  const slots: QuickRuntimeOutput['structuring']['understanding']['slots'] = {};
  const answeredSlots = new Set<QuickSlotId>();
  demoCase.steps.slice(0, guidedAnswerCount).forEach((step) => answeredSlots.add(step.slot));
  for (const slot of QUICK_SLOT_IDS) {
    const value = demoCase.slots[slot];
    if (!value) continue;
    if (answeredSlots.has(slot) || (guidedAnswerCount >= demoCase.steps.length && slot !== demoCase.supplement.slot)) {
      slots[slot] = { value, status: 'partial', source: 'user' };
    }
  }
  if (hasReviewRevision) {
    slots[demoCase.review.slot] = { value: demoCase.review.value, status: 'partial', source: 'user' };
  }
  if (hasSupplement) {
    slots[demoCase.supplement.slot] = { value: demoCase.supplement.value, status: 'partial', source: 'user' };
  }
  return slots;
}

function sampleStepUnknown(
  demoCase: SampleDemoCase,
  step: SampleStep | null,
): QuickRuntimeOutput['validation']['unknowns'][number] {
  const item = step ?? demoCase.steps[0];
  return {
    id: `${demoCase.title}_${item.slot}`,
    slot: item.slot,
    label: item.label,
    question: item.question,
    impact: '影响案例流程是否能形成可复核的需求简报。',
    priorityScore: 88,
    status: '待确认',
    isBlocking: true,
  };
}

function sampleUnknown(demoCase: SampleDemoCase): QuickRuntimeOutput['validation']['unknowns'][number] {
  return {
    id: demoCase.unknown.id,
    slot: demoCase.unknown.slot,
    label: '待补充信息',
    question: demoCase.unknown.question,
    impact: demoCase.unknown.impact,
    priorityScore: 78,
    status: '影响较大，建议先确认',
    isBlocking: true,
  };
}

function buildSampleSummary(
  demoCase: SampleDemoCase,
  slots: QuickRuntimeOutput['structuring']['understanding']['slots'],
): string {
  const expected = slots.expected_outcome?.value ?? demoCase.slots.expected_outcome ?? '目标待确认';
  const scenario = slots.core_scenario?.value ?? demoCase.slots.core_scenario ?? '场景待确认';
  return `${demoCase.title}的当前目标是：${expected}。核心场景是：${scenario}。`;
}

function buildGenericSampleComposition(
  demoCase: SampleDemoCase,
  runtime: QuickRuntimeOutput,
  canUseAsDraft: boolean,
): QuickRuntimeOutput['composition'] {
  const u = runtime.structuring.understanding;
  const expectedOutcome = slotValue(u, 'expected_outcome') ?? '待确认';
  const targetUser = slotValue(u, 'target_user') ?? '待确认';
  const coreScenario = slotValue(u, 'core_scenario') ?? '待确认';
  const scope = slotValue(u, 'scope_boundary') ?? '待确认';
  const completionCriteria = slotValue(u, 'completion_criteria') ?? '待确认';
  const constraints = slotValue(u, 'constraints_risks') ?? '待确认';
  return {
    snapshot: {
      originalInput: runtime.composition.snapshot.originalInput,
      understanding: runtime.structuring.understanding,
      unknowns: runtime.validation.unknowns,
      options: runtime.decisioning.options,
      qualityIssues: runtime.validation.qualityIssues,
    },
    views: {
      simple: [
        '# 需求简报（概述）',
        '## 当前理解',
        `${demoCase.title}现在可以理解为：${expectedOutcome}。`,
        '## 已经明确',
        `使用对象：${targetUser}。核心场景：${coreScenario}。本期范围：${scope}。`,
        '## 还需要注意',
        runtime.validation.unknowns.length > 0
          ? runtime.validation.unknowns.map((item) => `- ${item.question}`).join('\n')
          : `主要约束已经整理为：${constraints}。`,
        '## 建议下一步',
        runtime.decisioning.recommendation || '先按推荐方案推进，并在正式项目中补充责任人、时间和验收证据。',
      ].join('\n\n'),
      exec: renderGenericSampleDetailedReport({
        demoCase,
        canUseAsDraft,
        expectedOutcome,
        targetUser,
        coreScenario,
        scope,
        completionCriteria,
        constraints,
        runtime,
      }),
    },
  };
}

function renderGenericSampleDetailedReport(input: {
  demoCase: SampleDemoCase;
  canUseAsDraft: boolean;
  expectedOutcome: string;
  targetUser: string;
  coreScenario: string;
  scope: string;
  completionCriteria: string;
  constraints: string;
  runtime: QuickRuntimeOutput;
}): string {
  const optionRows = input.runtime.decisioning.options
    .map((item) => `| ${item.title} | ${item.isRecommended ? '推荐' : '备选'} | ${item.description} | ${item.pros.join('；')} | ${item.cons.join('；')} |`)
    .join('\n');
  const unknownRows = input.runtime.validation.unknowns.length > 0
    ? input.runtime.validation.unknowns.map((item) => `| ${item.question} | ${item.impact} | ${item.isBlocking ? '建议先确认' : '可稍后补充'} |`).join('\n')
    : '| 当前关键待确认项已补充 | 可以进入下一轮正式项目拆解 | 已处理 |';

  return [
    '# 需求分析详细报告',
    [
      '## 报告摘要',
      `- 项目主题：${input.demoCase.title}。`,
      `- 报告状态：${input.canUseAsDraft ? '本轮整理草稿，可用于继续沟通。' : '信息不足草稿，应继续追问后再用于沟通。'}`,
      `- 当前目标：${input.expectedOutcome}。`,
      '- 使用边界：本报告基于当前对话整理，不等于正式项目基线；进入正式项目后仍需补充责任人、排期、成本和验收证据。',
    ].join('\n'),
    [
      '## 已确认理解',
      '| 维度 | 当前口径 | 状态 |',
      '| --- | --- | --- |',
      `| 期望结果 | ${input.expectedOutcome} | 建议确认 |`,
      `| 目标用户 / 相关角色 | ${input.targetUser} | 建议确认 |`,
      `| 核心场景 | ${input.coreScenario} | 建议确认 |`,
      `| 范围说明 | ${input.scope} | 建议确认 |`,
      `| 完成标准 | ${input.completionCriteria} | 建议确认 |`,
      `| 风险与约束 | ${input.constraints} | 建议确认 |`,
    ].join('\n'),
    [
      '## 用户场景与独立验证',
      '| 场景 | 参与对象 | 用户要完成的事 | 验证方式 |',
      '| --- | --- | --- | --- |',
      `| 主流程 | ${input.targetUser} | ${input.coreScenario} | 用一个端到端样例复现流程是否成立 |`,
      `| 完成判断 | 需求方 / 评审者 | 判断是否达到：${input.completionCriteria} | 用可观察证据检查，不只凭主观满意 |`,
      '| 范围检查 | 需求方 / 执行方 | 确认没有把排除项写进首版 | 对照范围说明逐项核查 |',
    ].join('\n'),
    [
      '## 需求清单',
      '| 编号 | 需求项 | 优先级 | 当前描述 | 验证口径 |',
      '| --- | --- | --- | --- | --- |',
      `| 需求-001 | 交付目标 | 必须明确 | ${input.expectedOutcome} | 能用一句话说明最终要得到什么 |`,
      `| 需求-002 | 服务对象 | 必须明确 | ${input.targetUser} | 能区分主要对象和相关角色 |`,
      `| 需求-003 | 核心流程 | 必须明确 | ${input.coreScenario} | 能按步骤复现主流程 |`,
      `| 需求-004 | 范围边界 | 必须明确 | ${input.scope} | 未确认能力不进入首版承诺 |`,
      `| 需求-005 | 完成标准 | 必须明确 | ${input.completionCriteria} | 有可观察、可讨论的检查方式 |`,
      `| 需求-006 | 风险与约束 | 建议明确 | ${input.constraints} | 有责任方或后续确认方式 |`,
    ].join('\n'),
    [
      '## 方案比较与推荐',
      '| 方案 | 建议 | 说明 | 主要收益 | 主要代价 |',
      '| --- | --- | --- | --- | --- |',
      optionRows,
    ].join('\n'),
    [
      '## 风险与待确认事项',
      '| 待确认事项 | 影响 | 建议 |',
      '| --- | --- | --- |',
      unknownRows,
    ].join('\n'),
    [
      '## 需求质量检查',
      '- 完整性：目标、对象、场景、范围、完成标准和风险约束已使用同一份问诊记录整理。',
      '- 清晰度：未确认能力只作为待确认或后续正式项目内容，不写成当前承诺。',
      '- 一致性：对话、整理区卡片、方案比较、概述和详细报告使用同一版本快照。',
      '- 可验证性：完成标准需要能被观察或检查；不把“感觉满意”作为唯一验收口径。',
      '- 未知项处理：仍未确认的内容保留在待确认事项中，不由系统替用户下结论。',
    ].join('\n'),
    [
      '## 后续动作建议',
      '- 若继续补充：优先处理待确认事项，再生成新版简报。',
      '- 若升级正式项目：建议按模块拆成目标、流程、范围、责任、风险、验收六类继续推进。',
      '- 若用于沟通：先让需求方确认范围边界和完成标准，再进入报价、排期或执行计划。',
    ].join('\n'),
  ].join('\n\n');
}

function includesNeedle(text: string, needle: string): boolean {
  return text.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''));
}

function applyPosterSampleScript(
  turns: QuickTurn[],
  runtime: QuickRuntimeWithAudit,
  forceDecisioning: boolean,
  forceBrief: boolean,
): QuickRuntimeWithAudit {
  const userTurns = turns.filter((turn) => turn.role === 'user').map((turn) => turn.content);
  const answers = userTurns.slice(1);
  const combined = userTurns.join('\n');
  const hasReviewRevision = /首版只做单页网页海报生成/.test(combined);
  const hasFallbackSupplement = /模板海报|模板兜底|生成失败/.test(combined);
  const answeredScriptCount = Math.min(
    answers.filter((answer) => answer.trim().length > 0).length,
    POSTER_SAMPLE_STEPS.length,
  );
  const slots = { ...runtime.structuring.understanding.slots };

  if (answeredScriptCount >= 1) {
    slots.expected_outcome = {
      value: '30秒内得到可移动端访问的网页海报',
      status: 'partial',
      source: 'user',
    };
    slots.core_scenario = {
      value: '输入一句话后生成网页海报，手机扫码查看',
      status: 'partial',
      source: 'user',
    };
  }
  if (answeredScriptCount >= 2) {
    slots.target_user = {
      value: '团队宣传岗（主要），个人创作者（次要）',
      status: 'partial',
      source: 'user',
    };
  }
  if (answeredScriptCount >= 3) {
    slots.completion_criteria = {
      value: '从输入完成到海报出来不超过30秒',
      status: 'partial',
      source: 'user',
    };
  }
  if (answeredScriptCount >= 4 || hasReviewRevision) {
    slots.scope_boundary = {
      value: hasReviewRevision
        ? '首版只做单页网页海报生成，不做编辑器、团队协作和图片导出'
        : '首版只做单页网页海报生成，不做多人协作编辑或二次修改',
      status: 'partial',
      source: 'user',
    };
  }
  if (hasFallbackSupplement) {
    slots.constraints_risks = {
      value: '生成失败时返回模板海报并提示稍后重试，本期不做复杂人工修复',
      status: 'partial',
      source: 'user',
    };
  }

  const understanding = {
    summary: '面向团队宣传岗，围绕“一句话生成网页海报并扫码查看”的场景，目标是在30秒内得到可移动端访问的网页海报。',
    slots,
  };
  const canEnterReview = answeredScriptCount >= POSTER_SAMPLE_STEPS.length;
  const nextStep = canEnterReview ? null : POSTER_SAMPLE_STEPS[answeredScriptCount];
  const unknowns = canEnterReview
    ? hasFallbackSupplement
      ? []
      : [
          {
            id: 'apw_unknown_fallback',
            slot: 'constraints_risks' as QuickSlotId,
            label: '生成失败兜底',
            question: '智能生成失败时是否需要兜底方案？',
            impact: '影响可用性承诺、错误处理和首版验收。',
            priorityScore: 72,
            status: '影响较大，建议先确认' as const,
            isBlocking: true,
          },
        ]
    : [
        {
          id: `apw_unknown_${nextStep?.slot ?? 'expected_outcome'}`,
          slot: nextStep?.slot ?? 'expected_outcome',
          label: nextStep?.unknownLabel ?? '待确认信息',
          question: nextStep?.question ?? '请继续补充当前案例信息。',
          impact: '影响案例流程是否能形成可复核的需求简报。',
          priorityScore: 88,
          status: '待确认' as const,
          isBlocking: true,
        },
      ];
  const options = canEnterReview || forceDecisioning
    ? [
        {
          id: 'apw_option_static_page',
          title: '模板结构快速生成',
          description: '首版用稳定模板生成单页网页海报，优先保证速度、扫码查看和范围可控。',
          pros: ['生成链路短', '速度和成本更容易控制', '适合快速验证真实需求'],
          cons: ['视觉变化有限', '后续编辑能力需要另做'],
          isRecommended: true,
        },
        {
          id: 'apw_option_ai_layout',
          title: '智能排版增强',
          description: '让生成模型参与文案和版式变化，海报效果更灵活，但速度和稳定性需要额外验证。',
          pros: ['创意空间更大', '输出差异化更明显'],
          cons: ['性能风险更高', '失败兜底必须提前设计'],
          isRecommended: false,
        },
      ]
    : [];
  const patchedRuntime: QuickRuntimeWithAudit = {
    ...runtime,
    structuring: {
      understanding,
      changedSlots: QUICK_SLOT_IDS.filter((slot) => slots[slot]?.value),
    },
    validation: {
      canEnterReview,
      nextQuestionSlot: nextStep?.slot ?? null,
      unknowns,
      qualityIssues: unknowns.map((unknown) => ({
        dimension: unknown.slot === 'constraints_risks' ? '未知项' : '完整性',
        userLabel: `${unknown.label}还需要确认：${unknown.question}`,
        internalCode: `sample_quality_${unknown.slot}`,
        severity: unknown.isBlocking ? 'blocking' : 'warning',
        suggestedQuestion: unknown.question,
        priorityScore: unknown.priorityScore,
      })),
    },
    elicitation: {
      question: nextStep?.question ?? null,
      slot: nextStep?.slot ?? null,
      rationale: nextStep ? '按案例脚本继续澄清一个关键问题。' : '当前案例已进入理解复核。',
    },
    decisioning: {
      options,
      recommendation: options[0]?.description ?? '请先完成案例问答，再查看方案。',
    },
  };

  return {
    ...patchedRuntime,
    composition: buildPosterSampleComposition(patchedRuntime, forceBrief || canEnterReview),
  };
}

function buildPosterSampleComposition(
  runtime: QuickRuntimeWithAudit,
  canUseAsDraft: boolean,
): QuickRuntimeOutput['composition'] {
  const snapshot = {
    originalInput: runtime.composition.snapshot.originalInput,
    understanding: runtime.structuring.understanding,
    unknowns: runtime.validation.unknowns,
    options: runtime.decisioning.options,
    qualityIssues: runtime.validation.qualityIssues,
  };
  const scope = slotValue(runtime.structuring.understanding, 'scope_boundary') ?? '待确认';
  const constraints = slotValue(runtime.structuring.understanding, 'constraints_risks');
  const fallbackStillUnknown = runtime.validation.unknowns.some((unknown) => unknown.id === 'apw_unknown_fallback');
  return {
    snapshot,
    views: {
      simple: [
        '# 需求简报（概述）',
        '## 当前理解',
        '你想做的是一个智能海报生成网站。用户输入一句话后，系统生成一个可在线访问的单页网页海报，手机扫码即可查看。',
        '## 已经明确',
        `主要使用者是${slotValue(runtime.structuring.understanding, 'target_user') ?? '待确认'}；本期范围是${scope}；完成标准是${slotValue(runtime.structuring.understanding, 'completion_criteria') ?? '待确认'}。`,
        '## 还需要注意',
        !fallbackStillUnknown && constraints
          ? `生成失败时的处理方式已明确：${constraints}。`
          : constraints
            ? `生成失败兜底仍需确认；当前已知限制是：${constraints}。`
          : '生成失败时是否提供模板兜底仍需确认，确认后再把简报用于正式沟通。',
        '## 建议下一步',
        '先按“模板结构快速生成”推进首版，验证一句话生成、30秒内完成、手机扫码查看这三个核心点。',
      ].join('\n\n'),
      exec: renderPosterSampleDetailedReport(runtime, scope, constraints, canUseAsDraft, fallbackStillUnknown),
    },
  };
}

function renderPosterSampleDetailedReport(
  runtime: QuickRuntimeOutput,
  scope: string,
  constraints: string | null,
  canUseAsDraft: boolean,
  fallbackStillUnknown: boolean,
): string {
  const expectedOutcome = slotValue(runtime.structuring.understanding, 'expected_outcome') ?? '待确认';
  const targetUser = slotValue(runtime.structuring.understanding, 'target_user') ?? '待确认';
  const coreScenario = slotValue(runtime.structuring.understanding, 'core_scenario') ?? '待确认';
  const completionCriteria = slotValue(runtime.structuring.understanding, 'completion_criteria') ?? '待确认';
  const riskText = fallbackStillUnknown
    ? '生成失败时是否提供模板兜底待确认'
    : (constraints ?? '生成失败时的兜底策略待确认');
  const fallbackScenario = fallbackStillUnknown
    ? '| 失败兜底 | 宣传岗 | 生成失败时需要获得清楚提示或兜底方案 | 具体处理方式仍需确认，避免用户停在空白或不可理解状态 |'
    : '| 失败兜底 | 宣传岗 | 生成失败时获得模板海报和清楚提示 | 避免用户停在空白或不可理解状态 |';
  const includedScope = fallbackStillUnknown
    ? '一句话输入、单页网页海报生成、移动端访问、30秒内返回结果'
    : '一句话输入、单页网页海报生成、移动端访问、30秒内返回结果、失败模板兜底';
  const failureHandling = fallbackStillUnknown
    ? '| 生成失败 | 处理方式待确认 | 需要明确是返回模板兜底、提示稍后重试，还是提供其他恢复方式 |'
    : '| 生成失败 | 返回模板海报并提示稍后重试 | 当前版本不做复杂人工修复 |';
  const qualityFallbackLine = fallbackStillUnknown
    ? '- 可验证性：30秒生成、手机查看和范围不扩张已经可以设计验收项；失败兜底仍需补充后再写入验收。'
    : '- 可验证性：30秒生成、手机查看、失败兜底和范围不扩张都可以设计成具体验收项。';
  const unknownText =
    runtime.validation.unknowns.length > 0
      ? runtime.validation.unknowns.map((item) => `- ${item.question} ${item.impact}`).join('\n')
      : '- 当前关键待确认项已补充，可以进入下一轮正式项目拆解。';
  const optionRows = runtime.decisioning.options
    .map((item) => (
      `| ${item.title} | ${item.isRecommended ? '推荐' : '备选'} | ${item.description} | ${item.pros.join('；')} | ${item.cons.join('；')} |`
    ))
    .join('\n');

  return [
    '# 需求分析详细报告',
    [
      '## 报告摘要',
      `- 报告状态：${canUseAsDraft ? '本轮整理草稿，可用于继续沟通。' : '信息不足草稿，应继续追问后再用于沟通。'}`,
      '- 当前目标：建设一个一句话生成网页海报的快速生成工具。',
      '- 推荐方向：先做模板结构快速生成，优先保证速度、可访问性和范围边界。',
      '- 使用边界：本报告基于当前对话整理，不等于正式项目基线；进入正式项目后仍需补充负责人、排期、成本和技术验证证据。',
    ].join('\n'),
    [
      '## 原始诉求与分析目标',
      '- 原始诉求：用户输入一句话后生成可在线访问的网页海报，最好手机上也能看，30秒内出结果。',
      '- 分析目标：把模糊想法整理为可沟通、可评审、可拆解的需求文档，明确第一版要做什么、不做什么，以及如何判断已经达到可用状态。',
      '- 当前分析重点：优先验证一句话生成、网页海报、手机查看和生成耗时，不提前扩大到编辑器、团队协作或图片导出。',
    ].join('\n'),
    [
      '## 已确认理解',
      '| 维度 | 当前口径 | 状态 |',
      '| --- | --- | --- |',
      `| 期望结果 | ${expectedOutcome} | 建议确认 |`,
      `| 目标用户 / 相关角色 | ${targetUser} | 建议确认 |`,
      `| 核心场景 | ${coreScenario} | 建议确认 |`,
      `| 范围说明 | ${scope} | 建议确认 |`,
      `| 完成标准 | ${completionCriteria} | 建议确认 |`,
      `| 风险与约束 | ${riskText} | ${constraints ? '建议确认' : '尚未提供'} |`,
    ].join('\n'),
    [
      '## 用户场景与价值',
      '| 场景 | 参与对象 | 用户要完成的事 | 价值判断 |',
      '| --- | --- | --- | --- |',
      `| 快速出海报 | ${targetUser} | 输入一句活动或宣传描述，获得可在线访问的网页海报 | 缩短从想法到可查看页面的时间 |`,
      '| 手机查看 | 宣传岗 / 查看者 | 通过扫码或移动端打开海报页面 | 验证网页海报是否适合移动端查看 |',
      fallbackScenario,
    ].join('\n'),
    [
      '## 范围定义',
      '| 范围项 | 当前定义 | 处理原则 |',
      '| --- | --- | --- |',
      `| 本期包含 | ${includedScope} | 先验证核心链路是否成立 |`,
      '| 本期不包含 | 编辑器、团队协作、图片导出、复杂人工修复 | 作为后续版本或正式项目拆解项，不并入当前结论 |',
      '| 范围依据 | 目标是先证明快速生成和查看体验 | 不用未确认能力包装首版承诺 |',
    ].join('\n'),
    [
      '## 需求清单',
      '| 编号 | 需求项 | 优先级 | 当前描述 | 验证口径 |',
      '| --- | --- | --- | --- | --- |',
      '| 需求-001 | 一句话生成 | 必须明确 | 用户输入一句描述后生成网页海报 | 输入有效描述后能得到结果页面 |',
      '| 需求-002 | 网页海报访问 | 必须明确 | 结果是可在线访问的单页网页海报 | 桌面和手机宽度都能正常查看 |',
      '| 需求-003 | 手机扫码查看 | 必须明确 | 手机可打开海报页面并阅读主要内容 | 扫码或移动端打开后首屏无明显错位 |',
      `| 需求-004 | 性能目标 | 必须明确 | ${completionCriteria} | 从输入完成到结果出现计时验证 |`,
      `| 需求-005 | 范围边界 | 必须明确 | ${scope} | 对照范围说明检查是否加入未确认能力 |`,
      `| 需求-006 | 失败兜底 | 建议明确 | ${riskText} | 模拟生成失败，确认用户看到模板海报和重试提示 |`,
    ].join('\n'),
    [
      '## 成功标准与验收口径',
      '| 编号 | 成功标准 | 验证方式 |',
      '| --- | --- | --- |',
      `| 标准-001 | ${completionCriteria} | 以固定样例集记录从提交到结果出现的耗时 |`,
      '| 标准-002 | 手机可访问 | 用手机宽度和扫码入口检查页面可读性、首屏布局和主要内容展示 |',
      '| 标准-003 | 范围不扩张 | 检查首版不出现编辑器、团队协作、图片导出等未确认能力 |',
      '| 标准-004 | 失败不死路 | 模拟生成失败，确认用户能看到模板结果、稍后重试提示或清楚错误说明 |',
    ].join('\n'),
    [
      '## 边界情况与异常处理',
      '| 情况 | 当前处理口径 | 说明 |',
      '| --- | --- | --- |',
      '| 输入过短或无意义 | 引导用户补充宣传对象、内容主题和期望结果 | 不直接生成低质量海报 |',
      '| 生成超时 | 展示等待说明并允许稍后重试 | 不能让用户误以为按钮无反馈 |',
      failureHandling,
      '| 用户要求编辑或协作 | 记录为后续版本需求 | 不改写为本期范围 |',
    ].join('\n'),
    [
      '## 方案比较与推荐',
      '| 方案 | 建议 | 说明 | 优势 | 风险 |',
      '| --- | --- | --- | --- | --- |',
      optionRows,
    ].join('\n'),
    [
      '## 风险与待确认事项',
      unknownText,
      '- 后续进入正式项目时，还应确认内容审核规则、模板资源来源、生成成本、访问链接有效期和数据留存策略。',
    ].join('\n'),
    [
      '## 需求质量检查',
      '- 完整性：目标、对象、场景、范围、完成标准和失败处理已经形成同一口径。',
      '- 清晰度：本期不做编辑器、团队协作和图片导出，避免把未确认能力写成承诺。',
      '- 一致性：概述、整理区卡片、方案比较和详细报告使用同一份需求记录。',
      qualityFallbackLine,
      '- 未知项处理：未确认内容只进入待确认或后续正式项目，不作为当前版本事实。',
    ].join('\n'),
    [
      '## 后续动作建议',
      '- 若继续补充：可围绕模板兜底、手机查看和生成失败体验继续完善。',
      '- 若升级正式项目：建议拆成目标确认、核心流程、模板与访问、性能验证、风险兜底、验收计划六个模块推进。',
      '- 若用于对外沟通：先标注这是初步整理草稿，并让需求方确认范围边界和完成标准。',
    ].join('\n'),
  ].join('\n\n');
}

function projectCoverage(runtime: QuickRuntimeOutput, timestamp: string): CoverageSlotProjection[] {
  return QUICK_SLOT_IDS.map((slot) => {
    const status = runtime.structuring.understanding.slots[slot]?.status ?? 'missing';
    return {
      slot_id: slot,
      status: toCoverageState(status),
      last_updated: status === 'missing' ? null : timestamp,
      label: slotLabel(slot),
      is_blocking: ['expected_outcome', 'target_user', 'core_scenario', 'scope_boundary', 'completion_criteria'].includes(slot),
    };
  });
}

function nextSessionStatus(
  currentStatus: string,
  taskType: string,
  runtime: QuickRuntimeOutput,
  payload: Record<string, unknown>,
): string {
  if (currentStatus === 'brief_ready') return 'brief_ready';
  if (taskType === 'option_comparison' || taskType === 'brief_generation') return currentStatus;
  if (taskType === 'understanding_review' && payload.action === 'correct') return currentStatus;
  return runtime.validation.canEnterReview ? 'understanding_review' : 'clarifying';
}

function buildBriefSnapshot(
  runtime: QuickRuntimeOutput,
  snapshot: QuickStoredSnapshot,
): Record<string, unknown> {
  const u = runtime.structuring.understanding;
  const option = runtime.decisioning.options.find((item) => item.isRecommended);
  return {
    original_input: runtime.composition.snapshot.originalInput,
    expected_outcome: slotValue(u, 'expected_outcome'),
    target_users: slotValue(u, 'target_user') ? [slotValue(u, 'target_user')] : [],
    core_scenario: slotValue(u, 'core_scenario'),
    scope_included: slotValue(u, 'scope_boundary') ? [slotValue(u, 'scope_boundary')] : [],
    scope_excluded: [],
    core_requirements: [
      {
        id: '需求-001',
        title: '交付目标',
        description: slotValue(u, 'expected_outcome') ?? '待确认',
        priority: '必须明确',
      },
      {
        id: '需求-002',
        title: '核心场景',
        description: slotValue(u, 'core_scenario') ?? '待确认',
        priority: '必须明确',
      },
      {
        id: '需求-003',
        title: '范围说明',
        description: slotValue(u, 'scope_boundary') ?? '待确认',
        priority: '必须明确',
      },
    ],
    completion_criteria: [
      {
        id: '标准-001',
        description: slotValue(u, 'completion_criteria') ?? '待确认',
        verification: '以可观察结果检查，不把主观满意作为唯一标准。',
      },
    ],
    candidate_options: runtime.decisioning.options.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      pros: item.pros,
      cons: item.cons,
      is_recommended: item.isRecommended,
    })),
    constraints_risks: slotValue(u, 'constraints_risks')
      ? [{ id: 'RISK-001', description: slotValue(u, 'constraints_risks') }]
      : [],
    unknowns: runtime.validation.unknowns.map((item) => ({
      id: item.id,
      slot: item.slot,
      question: item.question,
      impact: item.impact,
      is_blocking: item.isBlocking,
      status: item.status,
    })),
    recommended_next_step: option?.description ?? runtime.decisioning.recommendation,
    views: runtime.composition.views,
    runtime_snapshot: snapshot,
  };
}

function slotValue(
  understanding: QuickRuntimeOutput['structuring']['understanding'],
  slot: QuickSlotId,
): string | null {
  return understanding.slots[slot]?.value?.trim() || null;
}

function toCoverageState(status: QuickSlotStatus): CoverageState {
  if (status === 'confirmed') return 'covered';
  if (status === 'partial' || status === 'inferred') return 'partial';
  return 'not_started';
}

function slotLabel(slot: QuickSlotId): string {
  const labels: Record<QuickSlotId, string> = {
    expected_outcome: '期望结果',
    target_user: '目标用户',
    core_scenario: '核心场景',
    scope_boundary: '范围说明',
    completion_criteria: '完成标准',
    constraints_risks: '风险与限制',
  };
  return labels[slot];
}

function toDbUnknownCategory(slot: QuickSlotId): string {
  if (slot === 'target_user') return 'user_object';
  if (slot === 'core_scenario') return 'core_scenarios';
  return slot;
}

function payloadFromJob(job: AiJob): unknown {
  try {
    return JSON.parse(job.payloadJson);
  } catch {
    return {};
  }
}

function parsePayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
}

function sumSkillTokens(
  audits: SkillInvocationAudit[],
  field: 'inputTokens' | 'outputTokens',
): number {
  return audits.reduce((sum, audit) => sum + audit[field], 0);
}

function aggregateThinkingMode(
  audits: SkillInvocationAudit[],
): AiInvokeResult['thinkingMode'] {
  if (audits.some((audit) => audit.thinkingMode === 'enabled')) return 'enabled';
  if (audits.some((audit) => audit.thinkingMode === 'disabled')) return 'disabled';
  if (audits.some((audit) => audit.thinkingMode === 'unset')) return 'unset';
  return undefined;
}

function modelNameForCurrentProvider(): string {
  if (env.AI_PROVIDER === 'ollama') return env.OLLAMA_MODEL;
  if (env.AI_PROVIDER === 'openai_compatible') return env.OPENAI_COMPAT_MODEL;
  return 'quick-runtime-fallback';
}
