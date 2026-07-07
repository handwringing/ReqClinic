'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  Download,
  FileText,
  GitBranch,
  Layers3,
  Link2,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AppBackground } from '@/components/layout/app-background';
import { LongWaitProgress } from '@/components/ui';
import { MarkdownBriefContent } from '@/components/brief/brief-views';
import { ApiClientError } from '@/lib/api/errors';
import { getApiClient } from '@/lib/api';
import { getQuickDemoCase } from '@/lib/quick-demo-cases';
import {
  FORMAL_CUSTOM_PROJECT_ID,
  FORMAL_STATIC_CASE_IDS,
  staticFormalProjectSourceCase,
} from '@/lib/static-demo-ids';
import type { Conflict, FormalMapResponse, FormalMapData, Project, ProjectMember, ProjectSourceKind, Source } from '@/lib/api/types';
import type {
  QuickDemoGuidanceCanvas,
  QuickDemoGuidanceModule,
  QuickDemoGuidanceOption,
  QuickDemoGuidanceStatus,
} from '@/lib/quick-demo-cases';
import { FormalTopbar } from './formal-topbar';
import { FormalAiPanel, type FormalBinding } from './formal-ai-panel';

export interface FormalAnalysisPageProps {
  projectId: string;
  routeSource?: string;
}

interface PageData {
  loading: boolean;
  error: string | null;
  project: Project | null;
  formalMap: FormalMapResponse | null;
  members: ProjectMember[];
  sources: Source[];
  conflicts: Conflict[];
}

type ExternalBinding = FormalBinding & { nonce: number };
type FormalReportTab = 'overview' | 'detail' | 'export';
type FormalMobilePanel = 'current' | 'map' | 'report';

const POSTER_CASE = getQuickDemoCase('ai-poster-website');
type FormalTheme = 'service' | 'outsourcing' | 'collaboration' | 'academic' | 'activity' | 'generic';

const FORMAL_SAMPLE_TITLES: Record<string, string> = {
  aster: '园区访客预约与通行',
  outsourcing: '企业官网外包采购',
  capstone: '智能面试助手毕业设计',
};

function buildStaticProject(projectId: string): Project | null {
  const now = '2026-07-07T00:00:00.000Z';
  const sourceCaseId = staticFormalProjectSourceCase(projectId);

  if (sourceCaseId) {
    const isFormalSample = FORMAL_STATIC_CASE_IDS.includes(sourceCaseId as any);
    const upgradedCase = getQuickDemoCase(sourceCaseId);
    return {
      id: projectId,
      title: FORMAL_SAMPLE_TITLES[sourceCaseId] ?? upgradedCase?.title ?? '正式项目示例',
      status: 'reviewing',
      source_kind: projectId.startsWith('formal-upgrade-') ? 'quick_upgrade' : 'sample',
      source_case_id: isFormalSample ? sourceCaseId : null,
      version: 1,
      created_by: '00000000-0000-4000-8000-000000000099',
      created_at: now,
      updated_at: now,
    };
  }

  if (projectId === FORMAL_CUSTOM_PROJECT_ID) {
    return {
      id: projectId,
      title: '自定义项目示例',
      status: 'reviewing',
      source_kind: 'custom',
      source_case_id: null,
      version: 1,
      created_by: '00000000-0000-4000-8000-000000000099',
      created_at: now,
      updated_at: now,
    };
  }

  return null;
}

function buildInitialPageData(projectId: string): PageData {
  const staticProject = buildStaticProject(projectId);
  return {
    loading: staticProject === null,
    error: null,
    project: staticProject,
    formalMap: null,
    members: [],
    sources: [],
    conflicts: [],
  };
}

function isPosterProject(title: string): boolean {
  return /海报|智能海报|网页海报/.test(title);
}

function detectFormalTheme(title: string): FormalTheme {
  if (/园区|访客|通行|服务|流程|会员|续费/.test(title)) return 'service';
  if (/外包|采购|官网|合同|交付物/.test(title)) return 'outsourcing';
  if (/毕业|答辩|小组|协作|面试助手/.test(title)) return 'collaboration';
  if (/论文|课程|研究|学术|文献/.test(title)) return 'academic';
  if (/活动|策划|展会|发布会|运营/.test(title)) return 'activity';
  return 'generic';
}

function buildThemeModules(theme: FormalTheme): QuickDemoGuidanceModule[] {
  const commonReport: QuickDemoGuidanceModule = {
    id: 'report',
    title: '报告与后续变化',
    status: '正在梳理',
    summary: '从同一份需求地图生成报告，并保留后续变化影响。',
    known: ['报告应来自同一版本需求地图。'],
    assumptions: ['未确认内容应继续标为待确认。'],
    questions: ['报告要给谁看，用于沟通、评审还是交付准备？'],
    relatedModuleIds: ['requirements', 'risks'],
  };

  if (theme === 'outsourcing') {
    return [
      {
        id: 'business_goal',
        title: '业务目标与受众',
        status: '正在梳理',
        summary: '先确认官网重做要服务品牌展示、获客线索还是客户信任。',
        known: ['官网需要展示产品、案例、公司介绍并收集客户线索。'],
        assumptions: ['获客线索的质量标准仍需要销售侧确认。'],
        questions: ['首版最重要的是品牌可信度，还是线索转化？'],
        relatedModuleIds: ['lead_flow', 'acceptance'],
      },
      {
        id: 'content_scope',
        title: '栏目与内容范围',
        status: '有方案可选',
        summary: '明确栏目、页面数量、文案、图片、案例和多语言是否包含。',
        known: ['文案和图片由甲方提供。'],
        assumptions: ['品牌重做、拍摄和会员系统不进入首版。'],
        questions: ['哪些栏目必须首版上线，哪些可以后续补？'],
        options: [
          {
            id: 'scope_minimal',
            title: '首版获客闭环',
            fit: '适合先上线官网和线索表单。',
            tradeoff: '品牌故事和内容深度会弱一些。',
            recommended: true,
          },
          {
            id: 'scope_full_brand',
            title: '品牌内容优先',
            fit: '适合重视企业形象和案例呈现。',
            tradeoff: '内容准备和评审周期更长。',
          },
        ],
        relatedModuleIds: ['deliverables', 'change_rule'],
      },
      {
        id: 'lead_flow',
        title: '线索收集流程',
        status: '待确认',
        summary: '把表单、通知、数据去向和销售跟进责任说清楚。',
        known: ['需要收集客户线索。'],
        assumptions: ['线索通知和 CRM 对接范围尚未确定。'],
        questions: ['线索提交后由谁接收，多久内跟进？'],
        relatedModuleIds: ['business_goal', 'deliverables'],
      },
      {
        id: 'deliverables',
        title: '交付物与源文件',
        status: '待确认',
        summary: '列清设计稿、代码、部署、培训、账号、素材和维护交接。',
        known: ['希望减少返工和报价争议。'],
        assumptions: ['长期运维不一定包含在首版合同内。'],
        questions: ['上线部署、源文件和培训材料是否都由外包交付？'],
        relatedModuleIds: ['acceptance', 'change_rule'],
      },
      {
        id: 'acceptance',
        title: '里程碑与验收',
        status: '正在梳理',
        summary: '把阶段评审、付款节点、验收标准和不通过处理方式写清楚。',
        known: ['首版 6 周内上线。'],
        assumptions: ['验收应包含页面、表单、移动端和基础性能检查。'],
        questions: ['验收时按页面清单、功能清单还是最终上线效果判断？'],
        relatedModuleIds: ['business_goal', 'deliverables'],
      },
      {
        id: 'change_rule',
        title: '排除项与变更',
        status: '建议复核',
        summary: '提前写清不包含内容、返工边界和新增需求计价方式。',
        known: ['不包含拍摄、品牌重做、长期运维和会员系统。'],
        assumptions: ['返工次数和需求变更流程仍需要合同化。'],
        questions: ['哪些修改算免费调整，哪些算新增需求？'],
        relatedModuleIds: ['content_scope', 'deliverables'],
      },
      commonReport,
    ];
  }

  if (theme === 'collaboration') {
    return [
      {
        id: 'success_criteria',
        title: '答辩成功标准',
        status: '已明确',
        summary: '把可运行演示、工程完整度和答辩说明分开确认。',
        known: ['目标是在答辩时展示可运行系统。'],
        assumptions: ['老师更看重闭环演示和工程完整度。'],
        questions: ['答辩时最不能失败的是演示闭环、创新点还是文档完整度？'],
        relatedModuleIds: ['demo_flow', 'report'],
      },
      {
        id: 'demo_flow',
        title: '模拟面试闭环',
        status: '有方案可选',
        summary: '覆盖模拟面试、回答记录、评分反馈和结果说明。',
        known: ['第一版需要模拟面试、回答记录和评分反馈。'],
        assumptions: ['录音和真实面试数据不进入首版。'],
        questions: ['首版评分反馈更重视可解释性还是体验完整度？'],
        relatedModuleIds: ['scoring', 'privacy'],
      },
      {
        id: 'scoring',
        title: '评分与反馈口径',
        status: '待确认',
        summary: '明确评分维度、提示词责任、解释方式和误导风险。',
        known: ['需要评分反馈。'],
        assumptions: ['评分只能作为练习反馈，不应暗示真实招聘结论。'],
        questions: ['评分维度由课程要求、竞品参考还是老师建议确定？'],
        relatedModuleIds: ['demo_flow', 'privacy'],
      },
      {
        id: 'privacy',
        title: '数据与隐私边界',
        status: '建议复核',
        summary: '处理演示数据、用户回答、脱敏和模型调用成本。',
        known: ['不能采集真实面试数据。'],
        assumptions: ['演示数据需要脱敏或模拟。'],
        questions: ['演示时是否允许保存用户输入，保存多久？'],
        relatedModuleIds: ['demo_flow', 'team_dependency'],
      },
      {
        id: 'team_dependency',
        title: '分工与依赖',
        status: '正在梳理',
        summary: '把前端、后端、模型调用、评分解释和答辩材料责任分清。',
        known: ['多人小组协作推进。'],
        assumptions: ['模型调用和评分解释责任仍需明确。'],
        questions: ['如果模型接口不稳定，谁负责兜底方案？'],
        relatedModuleIds: ['schedule', 'report'],
      },
      {
        id: 'schedule',
        title: '版本节奏',
        status: '待确认',
        summary: '把中期检查、闭环演示、答辩材料和最终演示拆成里程碑。',
        known: ['中期检查前需要完成闭环演示。'],
        assumptions: ['答辩材料应和功能进度同步更新。'],
        questions: ['第一版演示必须在哪一天前冻结范围？'],
        relatedModuleIds: ['team_dependency', 'report'],
      },
      commonReport,
    ];
  }

  if (theme === 'service') {
    return [
      {
        id: 'service_journey',
        title: '用户流程',
        status: '正在梳理',
        summary: '从预约、到场、核验、异常处理到离场记录一条线梳理。',
        known: ['目标是替代纸质登记并保留通行记录。'],
        assumptions: ['现场流程高峰期会影响核验效率。'],
        questions: ['访客从预约到通行，哪一步最容易卡住？'],
        relatedModuleIds: ['roles', 'exception'],
      },
      {
        id: 'roles',
        title: '角色与权限',
        status: '待确认',
        summary: '区分访客、前台、安保、园区运营和系统管理员。',
        known: ['安保需要核验并处理异常。'],
        assumptions: ['前台和运营的确认权限可能不同。'],
        questions: ['谁可以修改预约，谁只能查看或核验？'],
        relatedModuleIds: ['service_journey', 'audit'],
      },
      {
        id: 'exception',
        title: '异常处理',
        status: '有方案可选',
        summary: '处理凭证过期、访客未预约、身份不符和设备不可用。',
        known: ['现场需要处理异常并留下记录。'],
        assumptions: ['第一版不做人脸识别。'],
        questions: ['凭证过期时是重新申请，还是由安保人工放行？'],
        relatedModuleIds: ['audit', 'scope'],
      },
      {
        id: 'scope',
        title: '首版范围',
        status: '已明确',
        summary: '峰会前上线可演示版本，覆盖 3 个出入口。',
        known: ['第一版必须覆盖 3 个出入口。', '人脸识别不进入第一版。'],
        assumptions: ['移动端扫码体验比后台管理更优先。'],
        questions: ['峰会前必须真实上线，还是可演示闭环即可？'],
        relatedModuleIds: ['service_journey', 'risk'],
      },
      {
        id: 'audit',
        title: '记录与追踪',
        status: '待确认',
        summary: '确认通行记录、异常记录、查询权限和保留时间。',
        known: ['需要留下记录。'],
        assumptions: ['记录保留期和查询权限可能涉及管理要求。'],
        questions: ['通行记录需要保存多久，谁可以查询？'],
        relatedModuleIds: ['roles', 'risk'],
      },
      {
        id: 'risk',
        title: '上线风险',
        status: '建议复核',
        summary: '识别高峰排队、设备网络、隐私合规和人工兜底风险。',
        known: ['上线时间受峰会节点约束。'],
        assumptions: ['现场必须保留人工兜底方案。'],
        questions: ['如果扫码设备不可用，现场如何继续通行？'],
        relatedModuleIds: ['scope', 'exception'],
      },
      commonReport,
    ];
  }

  if (theme === 'academic') {
    return [
      {
        id: 'assignment_rules',
        title: '任务要求',
        status: '待确认',
        summary: '整理字数、格式、截止时间、引用数量和评分口径。',
        known: ['需要形成课程论文或研究写作任务。'],
        assumptions: ['老师更看重明确问题和证据支撑。'],
        questions: ['课程对字数、格式和引用数量有什么硬性要求？'],
        relatedModuleIds: ['research_question', 'evidence'],
      },
      {
        id: 'research_question',
        title: '研究问题',
        status: '正在梳理',
        summary: '把宽泛主题收窄为可论证、可收集证据的问题。',
        known: ['当前主题需要进一步收窄。'],
        assumptions: ['过宽的主题会削弱论文论证力度。'],
        questions: ['这篇论文最想回答的一个具体问题是什么？'],
        relatedModuleIds: ['evidence', 'structure'],
      },
      {
        id: 'evidence',
        title: '证据范围',
        status: '待确认',
        summary: '确认可用文献、政策、案例、数据和引用限制。',
        known: ['需要证据支撑。'],
        assumptions: ['英文文献和案例材料是否允许仍需确认。'],
        questions: ['老师是否允许英文文献、政策案例或实证数据？'],
        relatedModuleIds: ['research_question', 'structure'],
      },
      {
        id: 'structure',
        title: '章节结构',
        status: '有方案可选',
        summary: '根据研究问题生成论证链，而不是套固定模板。',
        known: ['需要有清晰章节和论证顺序。'],
        assumptions: ['结构应服务研究问题，不先定死标题。'],
        questions: ['更适合问题导向结构，还是案例比较结构？'],
        relatedModuleIds: ['research_question', 'schedule'],
      },
      {
        id: 'schedule',
        title: '写作计划',
        status: '正在梳理',
        summary: '拆分资料收集、初稿、修改和提交节点。',
        known: ['截止时间会影响写作深度。'],
        assumptions: ['资料不足时应先缩小问题范围。'],
        questions: ['距离截止还有多久，是否需要先做最小可交稿版本？'],
        relatedModuleIds: ['evidence', 'report'],
      },
      commonReport,
    ];
  }

  if (theme === 'activity') {
    return [
      {
        id: 'activity_goal',
        title: '活动目标',
        status: '正在梳理',
        summary: '确认活动要带来报名、转化、品牌声量还是内部共识。',
        known: ['需要形成活动策划案。'],
        assumptions: ['不同目标会改变流程、预算和指标。'],
        questions: ['这次活动最核心的成功结果是什么？'],
        relatedModuleIds: ['audience', 'metrics'],
      },
      {
        id: 'audience',
        title: '目标人群',
        status: '待确认',
        summary: '说明活动面向谁、为什么会参与、用什么渠道触达。',
        known: ['目标人群尚未完全明确。'],
        assumptions: ['参与动机会影响主题和传播话术。'],
        questions: ['最希望吸引哪类人参加？他们为什么愿意来？'],
        relatedModuleIds: ['format', 'promotion'],
      },
      {
        id: 'format',
        title: '活动形式与流程',
        status: '有方案可选',
        summary: '设计线上、线下或混合形式，以及签到、互动、转化流程。',
        known: ['需要一个可执行流程。'],
        assumptions: ['流程复杂度受场地、人力和预算影响。'],
        questions: ['活动更适合讲座、工作坊、展位体验还是沙龙？'],
        relatedModuleIds: ['resources', 'risk'],
      },
      {
        id: 'resources',
        title: '资源与分工',
        status: '待确认',
        summary: '明确预算、场地、人员、物料、嘉宾和供应商责任。',
        known: ['资源配置会影响活动规模。'],
        assumptions: ['部分资源需要提前锁定。'],
        questions: ['目前已确定哪些预算、人力或场地资源？'],
        relatedModuleIds: ['format', 'schedule'],
      },
      {
        id: 'promotion',
        title: '宣发计划',
        status: '正在梳理',
        summary: '安排渠道、节奏、素材、报名入口和提醒机制。',
        known: ['宣发会影响报名和到场。'],
        assumptions: ['不同渠道需要不同素材规格。'],
        questions: ['主要靠哪些渠道触达目标人群？'],
        relatedModuleIds: ['audience', 'metrics'],
      },
      {
        id: 'risk',
        title: '风险预案',
        status: '建议复核',
        summary: '处理报名不足、嘉宾变动、天气、设备和现场秩序风险。',
        known: ['活动执行存在现场不确定性。'],
        assumptions: ['需要至少保留关键风险兜底。'],
        questions: ['最需要提前准备哪类兜底方案？'],
        relatedModuleIds: ['format', 'resources'],
      },
      {
        id: 'metrics',
        title: '成功指标与复盘',
        status: '待确认',
        summary: '定义报名、到场、转化、反馈和复盘方式。',
        known: ['成功标准需要可观察。'],
        assumptions: ['复盘指标应和活动目标一致。'],
        questions: ['活动结束后用哪些指标判断做得好不好？'],
        relatedModuleIds: ['activity_goal', 'promotion'],
      },
      commonReport,
    ];
  }

  return [
    {
      id: 'intake_sources',
      title: '项目起点与材料',
      status: '正在梳理',
      summary: '把项目描述、已有材料和来源整理成后续分析的候选依据。',
      known: ['已经记录项目描述。', '已有材料会作为候选来源进入地图。'],
      assumptions: ['部分材料可能还需要确认来源。'],
      questions: ['哪些材料可以作为正式依据？'],
      relatedModuleIds: ['roles', 'scope'],
    },
    {
      id: 'roles',
      title: '相关角色与确认人',
      status: '待确认',
      summary: '确认谁使用、谁受影响、谁有权确认目标、范围和报告。',
      known: ['已记录当前填写的人员或角色候选。'],
      assumptions: ['并非所有参与者都能最终拍板。'],
      questions: ['最终由谁判断这个项目可以交付？'],
      relatedModuleIds: ['scope', 'report'],
    },
    {
      id: 'scope',
      title: '目标、范围与边界',
      status: '有方案可选',
      summary: '明确要达成什么、本次包含什么、不包含什么，以及变化会影响哪里。',
      known: ['已有项目目标候选。'],
      assumptions: ['范围边界仍需要按责任人确认。'],
      questions: ['第一版必须包含哪些结果？哪些明确不做？'],
      options: [
        {
          id: 'scope_first_version',
          title: '先定首版范围',
          fit: '适合先降低不确定性，快速形成可执行版本。',
          tradeoff: '部分长期能力需要进入后续版本。',
          recommended: true,
        },
        {
          id: 'scope_full_picture',
          title: '先画完整蓝图',
          fit: '适合多人协作和长期路线较复杂的项目。',
          tradeoff: '前期确认成本更高。',
        },
      ],
      relatedModuleIds: ['requirements', 'risks'],
    },
    {
      id: 'requirements',
      title: '需求与完成标准',
      status: '待确认',
      summary: '把目标和范围转成可执行、可检查的需求候选。',
      known: ['可以从当前项目目标生成需求候选。'],
      assumptions: ['完成标准需要能被观察或检查。'],
      questions: ['怎样判断这件事已经做到位？'],
      relatedModuleIds: ['scope', 'report'],
    },
    {
      id: 'risks',
      title: '风险、取舍与影响',
      status: '建议复核',
      summary: '把风险、冲突、方案取舍和影响关系集中显示，避免被写成确定事实。',
      known: ['约束和风险会影响方案选择。'],
      assumptions: ['部分风险需要具体责任人确认。'],
      questions: ['哪些风险会影响成本、时间或交付承诺？'],
      relatedModuleIds: ['scope', 'report'],
    },
    commonReport,
  ];
}

function buildFallbackCanvas(title: string): QuickDemoGuidanceCanvas {
  const modules = buildThemeModules(detectFormalTheme(title));
  return {
    title: `${title || '正式项目'}需求地图`,
    currentModuleId: modules[1]?.id ?? modules[0]?.id ?? 'intake_sources',
    estimatedTime: '按模块继续确认',
    generationSteps: [
      { label: '整理起点', state: 'done' },
      { label: '识别关键模块', state: 'active' },
      { label: '补齐待确认项', state: 'pending' },
      { label: '准备报告预览', state: 'pending' },
    ],
    modules,
  };
}

function getFormalCanvas(title: string): QuickDemoGuidanceCanvas {
  if (isPosterProject(title) && POSTER_CASE?.guidanceCanvas) {
    return POSTER_CASE.guidanceCanvas;
  }
  return buildFallbackCanvas(title);
}

function canvasFromSnapshot(snapshot: FormalMapData): QuickDemoGuidanceCanvas {
  return {
    title: snapshot.title,
    currentModuleId: snapshot.currentModuleId,
    estimatedTime: snapshot.sourceContext,
    generationSteps: snapshot.generationSteps,
    modules: snapshot.modules.map((module) => ({
      id: module.id,
      title: module.title,
      status: module.status,
      summary: module.summary,
      known: module.known ?? [],
      assumptions: module.assumptions ?? [],
      questions: module.questions ?? [],
      options: module.options ?? [],
      relatedModuleIds: module.relatedModuleIds ?? [],
    })),
  };
}

function projectSourceFromRoute(value: string | null): ProjectSourceKind | undefined {
  if (value === 'sample' || value === 'quick_upgrade' || value === 'custom') return value;
  return undefined;
}

export function FormalAnalysisPage({ projectId, routeSource }: FormalAnalysisPageProps) {
  const router = useRouter();
  const routeSourceKind = projectSourceFromRoute(routeSource ?? null);
  const [collapsed, setCollapsed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [externalBinding, setExternalBinding] = useState<ExternalBinding | undefined>();
  const [data, setData] = useState<PageData>(() => buildInitialPageData(projectId));

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      try {
        const api = getApiClient();
        const [project, formalMap, members, sourcesPage, conflicts] = await Promise.all([
          api.getProject(projectId),
          api.getFormalMapSnapshot(projectId).catch(() => null),
          api.listMembers(projectId).catch(() => []),
          api.listSources(projectId, { limit: 50, offset: 0 }).catch(() => ({ items: [] })),
          api.listConflicts(projectId).catch(() => []),
        ]);
        if (cancelled) return;
        setData({
          loading: false,
          error: null,
          project,
          formalMap,
          members,
          sources: sourcesPage.items,
          conflicts,
        });
        if (formalMap?.active_job_id || !formalMap?.snapshot) {
          timer = window.setTimeout(() => {
            if (!cancelled) void load();
          }, formalMap?.active_job_id ? 1600 : 2200);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof ApiClientError ? err.message : '加载失败';
        setData((s) => (
          s.project
            ? { ...s, loading: false, error: null }
            : { ...s, loading: false, error: msg }
        ));
      }
    }
    load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [projectId, refreshKey]);

  if (data.loading) {
    return (
      <div style={{ position: 'relative', minHeight: '100vh' }}>
        <AppBackground />
        <div className="app-content app-state-box" style={{ minHeight: '100vh' }}>
          <span className="desc">正在加载项目...</span>
        </div>
      </div>
    );
  }

  if (data.error || !data.project) {
    return (
      <div style={{ position: 'relative', minHeight: '100vh' }}>
        <AppBackground />
        <div className="app-content app-state-box" style={{ minHeight: '100vh' }}>
          <div className="title" style={{ color: 'var(--aurora-rose)' }}>项目加载失败</div>
          <div className="desc">{data.error ?? '项目不存在'}</div>
          <div className="state-actions">
            <button
              className="aurora-button secondary"
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              重试
            </button>
            <button
              className="aurora-button primary"
              type="button"
              onClick={() => router.push('/formal/new')}
            >
              返回正式项目入口
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <FormalMapShell
      project={data.project}
      formalMap={data.formalMap}
      members={data.members}
      conflicts={data.conflicts}
      routeSourceKind={routeSourceKind}
      collapsed={collapsed}
      onTogglePanel={setCollapsed}
      externalBinding={externalBinding}
      onRefresh={() => setRefreshKey((value) => value + 1)}
      onAddBinding={(binding) => {
        setExternalBinding({ ...binding, nonce: Date.now() });
      }}
    />
  );
}

function FormalMapShell({
  project,
  formalMap,
  members,
  conflicts,
  routeSourceKind,
  collapsed,
  onTogglePanel,
  externalBinding,
  onRefresh,
  onAddBinding,
}: {
  project: Project;
  formalMap: FormalMapResponse | null;
  members: ProjectMember[];
  conflicts: Conflict[];
  routeSourceKind?: ProjectSourceKind;
  collapsed: boolean;
  onTogglePanel: (collapsed: boolean) => void;
  externalBinding?: ExternalBinding;
  onRefresh: () => void;
  onAddBinding: (binding: FormalBinding) => void;
}) {
  const canvas = useMemo(
    () => formalMap?.snapshot?.data ? canvasFromSnapshot(formalMap.snapshot.data) : getFormalCanvas(project.title),
    [formalMap?.snapshot?.data, project.title],
  );
  const [activeModuleId, setActiveModuleId] = useState(canvas.currentModuleId);

  useEffect(() => {
    setActiveModuleId(canvas.currentModuleId);
  }, [canvas.currentModuleId]);

  const activeModule =
    canvas.modules.find((module) => module.id === activeModuleId) ??
    canvas.modules.find((module) => module.id === canvas.currentModuleId) ??
    canvas.modules[0];

  const memberInitials = members.map((m) => m.initials);
  const ownerInitials = members
    .filter((m) => m.role === 'owner' || m.role === 'reviewer')
    .map((m) => m.initials);
  const organizedCount = canvas.modules.reduce(
    (sum, module) => sum + module.known.length,
    0,
  );
  const pendingQuestionCount = canvas.modules.reduce(
    (sum, module) => sum + module.questions.length,
    0,
  );
  const hasUserMessage = formalMap?.messages.some((message) => message.role === 'user') ?? false;
  const sourceKind = project.source_kind ?? routeSourceKind;
  const isSampleProject = sourceKind === 'sample';

  return (
    <div className="formal-analysis-shell" style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      <AppBackground />
      <div
        className="app-content"
        style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <FormalTopbar
          projectTitle={project.title}
          organizedCount={organizedCount}
          mapNodeCount={canvas.modules.length}
          pendingQuestionCount={pendingQuestionCount}
          unresolvedConflictCount={conflicts.filter((c) => c.status === 'open').length}
          ownerInitials={ownerInitials.length > 0 ? ownerInitials : memberInitials}
          sourceKind={sourceKind}
        />
        <div
          className="formal-analysis-main"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <FormalAiPanel
            side="left"
            collapsed={collapsed}
            onToggle={onTogglePanel}
            projectTitle={project.title}
            projectId={project.id}
            activeModule={activeModule}
            externalBinding={externalBinding}
            messages={formalMap?.messages ?? []}
            activeJobId={formalMap?.active_job_id ?? null}
            onSubmitted={onRefresh}
          />
          <main className="formal-map-workbench-main">
            <FormalMapWorkspace
              projectTitle={project.title}
              canvas={canvas}
              mapSnapshot={formalMap?.snapshot?.data ?? null}
              isSampleProject={isSampleProject}
              activeJobId={formalMap?.active_job_id ?? null}
              hasUserMessage={hasUserMessage}
              activeModule={activeModule}
              activeModuleId={activeModule.id}
              onSelectModule={setActiveModuleId}
              onAddBinding={onAddBinding}
            />
          </main>
        </div>
      </div>
    </div>
  );
}

function FormalMapWorkspace({
  projectTitle,
  canvas,
  mapSnapshot,
  isSampleProject,
  activeJobId,
  hasUserMessage,
  activeModule,
  activeModuleId,
  onSelectModule,
  onAddBinding,
}: {
  projectTitle: string;
  canvas: QuickDemoGuidanceCanvas;
  mapSnapshot?: FormalMapData | null;
  isSampleProject?: boolean;
  activeJobId?: string | null;
  hasUserMessage: boolean;
  activeModule: QuickDemoGuidanceModule;
  activeModuleId: string;
  onSelectModule: (id: string) => void;
  onAddBinding: (binding: FormalBinding) => void;
}) {
  const rootTitle = canvas.title.replace(/详细指导$/, '').replace(/需求地图$/, '');
  const knownCount = canvas.modules.reduce((sum, module) => sum + module.known.length, 0);
  const optionCount = canvas.modules.reduce((sum, module) => sum + (module.options?.length ?? 0), 0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTab, setReportTab] = useState<FormalReportTab>('overview');
  const [mobilePanel, setMobilePanel] = useState<FormalMobilePanel>('current');
  const reportProjection = mapSnapshot?.reportProjection ?? null;
  const exportDocument = useMemo(
    () => buildFormalExportDocument(projectTitle, canvas, mapSnapshot),
    [projectTitle, canvas, mapSnapshot],
  );
  const relatedModules =
    activeModule.relatedModuleIds
      ?.map((id) => canvas.modules.find((module) => module.id === id))
      .filter((module): module is QuickDemoGuidanceModule => Boolean(module)) ?? [];

  return (
    <section className="formal-map-workbench" aria-label="正式项目需求地图">
      <div className="formal-map-mobile-tabs" role="tablist" aria-label="正式项目工作台视图">
        <button
          type="button"
          className={mobilePanel === 'current' ? 'is-active' : ''}
          onClick={() => setMobilePanel('current')}
        >
          当前节点
        </button>
        <button
          type="button"
          className={mobilePanel === 'map' ? 'is-active' : ''}
          onClick={() => setMobilePanel('map')}
        >
          地图总览
        </button>
        <button
          type="button"
          className={mobilePanel === 'report' ? 'is-active' : ''}
          onClick={() => setMobilePanel('report')}
        >
          报告预览
        </button>
      </div>

      <header className="formal-map-workbench__head">
        <div>
          <div className="app-label">
            <Layers3 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            需求地图
          </div>
          <h1>{projectTitle}</h1>
          <p>
            问诊助手会按地图节点梳理目标、范围、方案和风险，所有报告都从当前整理结果生成。
          </p>
        </div>
        <div className="formal-map-workbench__stats" aria-label="地图状态">
          <StatTile label="地图节点" value={canvas.modules.length} tone="gold" />
          <StatTile label="已整理" value={knownCount} tone="sage" />
          <StatTile label="待确认" value={canvas.modules.reduce((sum, module) => sum + module.questions.length, 0)} tone="rose" />
          <StatTile label="方案" value={optionCount} tone="muted" />
        </div>
      </header>

      {isSampleProject && (
        <div
          role="status"
          className="app-chip app-chip-muted"
          style={{
            alignSelf: 'flex-start',
            borderRadius: 4,
            padding: '8px 12px',
            lineHeight: 1.55,
          }}
        >
          当前为参考工作台，用于查看需求地图的分析方式；创建自己的项目请回到“项目起点输入”。
        </div>
      )}

      {activeJobId && (
        <LongWaitProgress
          className="formal-map-workbench__pending"
          title={hasUserMessage ? '正在更新需求地图' : '正在生成需求地图'}
          description={
            hasUserMessage
              ? '系统会把最新回答写回相关节点，并同步更新报告预览。'
              : '系统会先拆出地图节点，再整理当前已知内容和待确认问题。'
          }
          steps={
            hasUserMessage
              ? ['读取回答', '定位节点', '更新地图', '同步报告']
              : ['整理起点', '拆分节点', '生成追问', '准备报告']
          }
        />
      )}

      <div className="formal-map-status-row" aria-label="生成状态">
        {canvas.generationSteps.map((step) => (
          <span
            key={step.label}
            className={`formal-map-stage formal-map-stage--${step.state}`}
            title={step.label}
          >
            {step.state === 'done' ? (
              <CheckCircle2 size={12} strokeWidth={1.6} aria-hidden="true" />
            ) : step.state === 'active' ? (
              <Clock3 size={12} strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <CircleDashed size={12} strokeWidth={1.6} aria-hidden="true" />
            )}
            {step.label}
          </span>
        ))}
      </div>

      <div className="formal-map-workspace-grid">
        <div className={`formal-map-mobile-panel formal-map-mobile-panel--map ${mobilePanel === 'map' ? 'is-active' : ''}`}>
        <div className="formal-map-left-column">
          <div className="formal-map-main-canvas" aria-label="项目模块地图">
            <div className="formal-map-main-root">
              <span>项目核心</span>
              <strong>{rootTitle}</strong>
              <small>当前内容只是整理结果，重要结论会在各节点里继续确认。</small>
            </div>
            <div className="formal-map-main-branches">
              {canvas.modules.map((module, index) => (
                <button
                  key={module.id}
                  type="button"
                  className={`formal-map-main-node ${module.id === activeModuleId ? 'formal-map-main-node--active' : ''}`}
                  onClick={() => onSelectModule(module.id)}
                >
                  <span className="formal-map-main-node__index">{index + 1}</span>
                  <span className="formal-map-main-node__body">
                    <span className="formal-map-main-node__title">{module.title}</span>
                    <span className="formal-map-main-node__summary">{module.summary}</span>
                  </span>
                  <span className={`formal-map-status formal-map-status--${statusTone(module.status)}`}>
                    {displayModuleStatus(module.status)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="formal-map-map-notes" aria-label="地图操作">
            {['点击节点切换当前问题', '把节点或方案加入对话', '报告按当前地图生成'].map((item, index) => (
              <div key={item}>
                <span>{index + 1}</span>
                <strong>{item}</strong>
              </div>
            ))}
          </div>
        </div>
        </div>

        <div className={`formal-map-mobile-panel formal-map-mobile-panel--current ${mobilePanel === 'current' ? 'is-active' : ''}`}>
        <div className="formal-map-current-node" aria-label="当前节点工作区">
          <div className="formal-map-current-node__title">
            <div>
              <div className="app-label">当前节点</div>
              <h2>{activeModule.title}</h2>
            </div>
            <button type="button" onClick={() => onAddBinding(moduleToBinding(activeModule))}>
              <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
              加入对话
            </button>
          </div>
          <p>{activeModule.summary}</p>

          <div className="formal-map-node-facts">
            <MapFactGroup title="已明确" items={activeModule.known} tone="sage" />
            <MapFactGroup title="初步判断" items={activeModule.assumptions} tone="gold" />
            <MapFactGroup title="待确认" items={activeModule.questions} tone="rose" />
          </div>

          {activeModule.options && activeModule.options.length > 0 && (
            <div className="formal-map-node-options">
              <div className="formal-map-node-options__label">可选方案</div>
              {activeModule.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`formal-map-node-option ${option.recommended ? 'formal-map-node-option--recommended' : ''}`}
                  onClick={() => onAddBinding(optionToBinding(activeModule, option))}
                >
                  <span>
                    <strong>{option.title}</strong>
                    {option.recommended && <em>建议优先</em>}
                  </span>
                  <small>{option.fit}</small>
                  <small>取舍：{option.tradeoff}</small>
                </button>
              ))}
            </div>
          )}

          <div className="formal-map-related">
            <span>
              <Link2 size={12} strokeWidth={1.5} aria-hidden="true" />
              改这里会影响
            </span>
            {relatedModules.length > 0 ? (
              relatedModules.map((module) => (
                <button key={module.id} type="button" onClick={() => onSelectModule(module.id)}>
                  {module.title}
                </button>
              ))
            ) : (
              <em>暂无直接影响节点</em>
            )}
          </div>
        </div>
        </div>
      </div>

      <footer className={`formal-map-workbench__foot formal-map-mobile-panel formal-map-mobile-panel--report ${mobilePanel === 'report' ? 'is-active' : ''}`}>
        <div>
          <div className="app-label">
            <Target className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            报告预览
          </div>
          <span>报告会按当前地图生成；还没确认的内容会继续保留为待确认。</span>
          {reportProjection?.overview && (
            <small>{reportProjection.overview.slice(0, 96)}</small>
          )}
          <button
            type="button"
            className="formal-report-open"
            disabled={!reportProjection}
            onClick={() => setReportOpen(true)}
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            查看报告
          </button>
        </div>
        <div>
          <div className="app-label">
            <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            确认与版本
          </div>
          <span>重要确认、版本记录和后续变化会保留处理记录，避免把待确认内容写成最终结论。</span>
          {mapSnapshot?.qualityNotes?.[0] && <small>{mapSnapshot.qualityNotes[0]}</small>}
        </div>
      </footer>

      {reportOpen && reportProjection && (
        <div className="formal-report-modal" role="dialog" aria-modal="true" aria-label="正式项目报告">
          <div className="formal-report-modal__panel">
            <header className="formal-report-modal__head">
              <div>
                <div className="app-label">
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  正式项目报告
                </div>
                <h2>{projectTitle}</h2>
              </div>
              <button type="button" aria-label="关闭报告" onClick={() => setReportOpen(false)}>
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </header>
            <div className="formal-report-modal__tabs" role="tablist" aria-label="报告视图">
              <button
                type="button"
                className={reportTab === 'overview' ? 'is-active' : ''}
                onClick={() => setReportTab('overview')}
              >
                普通概述
              </button>
              <button
                type="button"
                className={reportTab === 'detail' ? 'is-active' : ''}
                onClick={() => setReportTab('detail')}
              >
                专业报告
              </button>
              <button
                type="button"
                className={reportTab === 'export' ? 'is-active' : ''}
                onClick={() => setReportTab('export')}
              >
                导出专业报告
              </button>
            </div>
            <section className="formal-report-modal__body">
              {reportTab === 'export' ? (
                <article className="brief-export-document">
                  <header className="brief-export-document__head">
                    <div className="app-label">
                      <Download className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      导出专业报告
                    </div>
                    <h3>可复制的正式项目需求文档</h3>
                    <p>
                      内容与专业报告来自同一份需求地图，适合复制到协作文档或后续排版。
                    </p>
                  </header>
                  <MarkdownBriefContent content={exportDocument} variant="exec" />
                </article>
              ) : (
                <MarkdownBriefContent
                  content={reportTab === 'overview' ? reportProjection.overview : reportProjection.detailedReport}
                  variant={reportTab === 'overview' ? 'simple' : 'exec'}
                />
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

function buildFormalExportDocument(
  projectTitle: string,
  canvas: QuickDemoGuidanceCanvas,
  mapSnapshot?: FormalMapData | null,
): string {
  const report = mapSnapshot?.reportProjection?.detailedReport?.trim();
  const knownItems = canvas.modules.flatMap((module) =>
    module.known.map((item) => `- ${module.title}：${item}`),
  );
  const pendingItems = canvas.modules.flatMap((module) =>
    module.questions.map((item) => `- ${module.title}：${item}`),
  );
  const optionItems = canvas.modules.flatMap((module) =>
    (module.options ?? []).map((option) => (
      `- ${module.title} / ${option.title}：${option.fit}；取舍：${option.tradeoff}`
    )),
  );

  if (report) {
    return [
      `# ${projectTitle}需求分析文档`,
      '',
      report,
      '',
      '## 版本来源',
      '',
      `- 来源：当前需求地图（${canvas.modules.length} 个节点）`,
      '- 说明：未确认内容仅作为待确认项，不应直接写成最终承诺。',
    ].join('\n');
  }

  return [
    `# ${projectTitle}需求分析文档`,
    '',
    '## 项目概述',
    '',
    mapSnapshot?.summary || '当前项目已进入需求地图整理阶段。',
    '',
    '## 已明确内容',
    '',
    ...(knownItems.length > 0 ? knownItems : ['- 暂无已确认内容。']),
    '',
    '## 方案与取舍',
    '',
    ...(optionItems.length > 0 ? optionItems : ['- 暂无可选方案。']),
    '',
    '## 待确认内容',
    '',
    ...(pendingItems.length > 0 ? pendingItems : ['- 暂无待确认内容。']),
    '',
    '## 版本来源',
    '',
    `- 来源：当前需求地图（${canvas.modules.length} 个节点）`,
    '- 说明：该文档只能反映当前版本地图，不替代人工确认。',
  ].join('\n');
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'sage' | 'gold' | 'rose' | 'muted';
}) {
  return (
    <div className={`formal-map-stat formal-map-stat--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function MapFactGroup({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'sage' | 'gold' | 'rose';
}) {
  return (
    <div className={`formal-map-fact formal-map-fact--${tone}`}>
      <span>{title}</span>
      <ul>
        {(items.length > 0 ? items : ['暂时没有内容']).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function statusTone(status: QuickDemoGuidanceStatus): 'sage' | 'gold' | 'rose' | 'muted' {
  if (status === '已明确' || status === '已整理') return 'sage';
  if (status === '待确认' || status === '建议复核' || status === '建议确认' || status === '待补充') return 'rose';
  if (status === '有方案可选' || status === '正在梳理') return 'gold';
  return 'muted';
}

function displayModuleStatus(status: QuickDemoGuidanceStatus): string {
  if (status === '正在梳理') return '当前关注';
  if (status === '建议复核') return '建议确认';
  return status;
}

function moduleToBinding(module: QuickDemoGuidanceModule): FormalBinding {
  return {
    id: `formal-map:${module.id}`,
    title: module.title,
    detail: module.summary,
  };
}

function optionToBinding(
  module: QuickDemoGuidanceModule,
  option: QuickDemoGuidanceOption,
): FormalBinding {
  return {
    id: `formal-map:${module.id}:${option.id}`,
    title: option.title,
    detail: `${module.title}：${option.fit}`,
  };
}
