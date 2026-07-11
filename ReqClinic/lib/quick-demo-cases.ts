export type QuickDemoTemplateKind =
  | 'software'
  | 'creative'
  | 'academic'
  | 'service'
  | 'outsourcing'
  | 'collaboration'
  | 'early_idea';

export interface QuickDemoSelection {
  sourceCaseId: string;
  title: string;
  originalInput: string;
  templateLabel: string;
}

export interface QuickDemoTemplate {
  kind: QuickDemoTemplateKind;
  label: string;
  summary: string;
  priorityDimensions: string[];
  rightPanelCards: Array<{
    title: string;
    detail: string;
  }>;
}

export interface QuickDemoStep {
  question: string;
  questionHighlights: string[];
  answer: string;
  answerHighlights: string[];
  updateMarks: string[];
  followUp: string;
}

export type QuickDemoCardId =
  | 'expected_outcome'
  | 'target_user'
  | 'core_scenario'
  | 'scope_boundary'
  | 'completion_criteria'
  | 'constraints_risks'
  | 'unknowns';

export interface QuickDemoCardUpdate {
  cardId: QuickDemoCardId;
  answer: string;
  answerHighlights: string[];
  updateMarks: string[];
  resolvedNote: string;
}

export type QuickDemoGuidanceStatus =
  | '已明确'
  | '已整理'
  | '正在梳理'
  | '有方案可选'
  | '待确认'
  | '建议复核'
  | '建议确认'
  | '待补充';

export interface QuickDemoGuidanceOption {
  id: string;
  title: string;
  fit: string;
  tradeoff: string;
  recommended?: boolean;
}

export interface QuickDemoGuidanceModule {
  id: string;
  title: string;
  status: QuickDemoGuidanceStatus;
  summary: string;
  known: string[];
  assumptions: string[];
  questions: string[];
  options?: QuickDemoGuidanceOption[];
  relatedModuleIds?: string[];
}

export interface QuickDemoGuidanceCanvas {
  title: string;
  currentModuleId: string;
  estimatedTime: string;
  generationSteps: Array<{
    label: string;
    state: 'done' | 'active' | 'pending';
  }>;
  modules: QuickDemoGuidanceModule[];
}

export interface QuickDemoCase {
  sourceCaseId: string;
  title: string;
  originalInput: string;
  template: QuickDemoTemplate;
  steps: QuickDemoStep[];
  finalUnderstanding: {
    summary: string;
    slots: {
      expected_outcome?: string;
      target_user?: string;
      core_scenario?: string;
      scope_boundary?: string;
      completion_criteria?: string;
      constraints_risks?: string;
    };
  };
  review: QuickDemoCardUpdate;
  unknowns: Array<{
    id: string;
    question: string;
    is_blocking: boolean;
    impact: string;
    suggested_owner?: string;
  }>;
  supplement: QuickDemoCardUpdate;
  options: Array<{
    id: string;
    title: string;
    description: string;
    pros: string[];
    cons: string[];
    effort: 'low' | 'medium' | 'high';
    reversible: boolean;
    is_recommended: boolean;
  }>;
  guidanceCanvas?: QuickDemoGuidanceCanvas;
}

export interface QuickDemoTurn {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  structured_content?: {
    paragraphs?: string[];
    bullets?: string[];
    highlights?: string[];
  };
  source_refs?: string[];
  update_marks?: string[];
  follow_ups?: string[];
  created_at?: string;
}

const templates: Record<QuickDemoTemplateKind, QuickDemoTemplate> = {
  software: {
    kind: 'software',
    label: '软件 / 应用',
    summary: '优先分清角色、场景、功能边界、质量约束和可验证标准。',
    priorityDimensions: ['角色权限', '核心场景', '功能范围', '质量标准', '验收标准'],
    rightPanelCards: [
      { title: '用户与角色', detail: '谁使用、谁审核、谁承担异常处理。' },
      { title: '场景与流程', detail: '主流程、异常流程、触发条件和数据流。' },
      { title: '功能范围', detail: '首版必须做什么，哪些明确不做。' },
      { title: '质量标准', detail: '性能、安全、可用性和完成判断口径。' },
    ],
  },
  creative: {
    kind: 'creative',
    label: '创意设计',
    summary: '优先澄清目标受众、传播渠道、核心信息、素材约束和审核风险。',
    priorityDimensions: ['目标受众', '渠道规格', '核心信息', '风格参考', '审核风险'],
    rightPanelCards: [
      { title: '创意简报', detail: '目标、受众、主张、语气和版本矩阵。' },
      { title: '素材与规格', detail: '现有素材、尺寸、平台、交付格式。' },
      { title: '制作范围', detail: '参考图、禁用元素、二次修改和版本范围。' },
      { title: '效果判断', detail: '拉新、转化、点击或内部审稿标准。' },
    ],
  },
  academic: {
    kind: 'academic',
    label: '课程论文',
    summary: '先锁定任务要求、评分口径、研究问题和证据范围，再讨论结构。',
    priorityDimensions: ['任务要求', '研究问题', '评分标准', '证据范围', '时间计划'],
    rightPanelCards: [
      { title: '作业要求', detail: '字数、格式、评分标准、截止时间。' },
      { title: '研究问题', detail: '讨论对象、教育阶段、论证边界。' },
      { title: '材料证据', detail: '可用文献、数据、案例和引用限制。' },
      { title: '结构计划', detail: '章节、论证链路、里程碑。' },
    ],
  },
  service: {
    kind: 'service',
    label: '服务流程',
    summary: '把用户流程、内部支持、容易出问题的环节、责任和指标放在同一张过程地图里。',
    priorityDimensions: ['服务流程', '关键触点', '问题环节', '前后台分工', '指标'],
    rightPanelCards: [
      { title: '服务流程', detail: '用户从触发到完成的每个触点。' },
      { title: '前后台分工', detail: '用户可见动作与内部支持动作。' },
      { title: '问题环节', detail: '排队、遗漏、重复沟通和人工兜底。' },
      { title: '运营指标', detail: '续费率、转化、投诉、处理时长。' },
    ],
  },
  outsourcing: {
    kind: 'outsourcing',
    label: '外包采购',
    summary: '重点不是灵感发散，而是范围、交付物、责任、验收和变更机制。',
    priorityDimensions: ['工作范围', '交付物', '排除项', '验收', '变更机制'],
    rightPanelCards: [
      { title: '工作范围', detail: '栏目、功能、服务内容、排除项。' },
      { title: '交付物', detail: '源文件、部署、培训、文案、素材。' },
      { title: '里程碑', detail: '阶段、付款、评审和交付节奏。' },
      { title: '验收与变更', detail: '通过标准、返工边界、变更流程。' },
    ],
  },
  collaboration: {
    kind: 'collaboration',
    label: '多人协作',
    summary: '整理区要承担共享工件职责，明确角色、依赖、版本和决策记录。',
    priorityDimensions: ['共同目标', '角色分工', '依赖关系', '决策记录', '版本节点'],
    rightPanelCards: [
      { title: '分工责任', detail: '谁负责产品、技术、资料、验收和答辩。' },
      { title: '共享目标', detail: '共同交付物、演示对象、评审口径。' },
      { title: '依赖与风险', detail: '数据、模型、设备、伦理和时间风险。' },
      { title: '决策记录', detail: '选择了什么、不选什么、理由是什么。' },
    ],
  },
  early_idea: {
    kind: 'early_idea',
    label: '早期想法',
    summary: '不要过早写正式需求文档，先保护问题假设、用户猜测和待验证方向。',
    priorityDimensions: ['问题假设', '用户假设', '使用时刻', '可能方向', '待验证问题'],
    rightPanelCards: [
      { title: '问题假设', detail: '用户到底在什么时刻遇到什么困难。' },
      { title: '用户假设', detail: '先列候选人群，不急着定死画像。' },
      { title: '可能方向', detail: '陪练、反馈、课程、社群或工具。' },
      { title: '待验证问题', detail: '选择最能降低不确定性的追问。' },
    ],
  },
};

const TEMPLATE_CARD_SLOT_MAP: Record<QuickDemoTemplateKind, Exclude<QuickDemoCardId, 'unknowns'>[]> = {
  software: ['target_user', 'core_scenario', 'scope_boundary', 'completion_criteria'],
  creative: ['expected_outcome', 'core_scenario', 'scope_boundary', 'completion_criteria'],
  academic: ['completion_criteria', 'scope_boundary', 'constraints_risks', 'core_scenario'],
  service: ['core_scenario', 'target_user', 'constraints_risks', 'completion_criteria'],
  outsourcing: ['scope_boundary', 'completion_criteria', 'target_user', 'constraints_risks'],
  collaboration: ['target_user', 'expected_outcome', 'constraints_risks', 'scope_boundary'],
  early_idea: ['expected_outcome', 'target_user', 'core_scenario', 'constraints_risks'],
};

const DEFAULT_CARD_TITLES: Record<QuickDemoCardId, string> = {
  expected_outcome: '期望结果',
  target_user: '目标用户',
  core_scenario: '核心场景',
  scope_boundary: '范围说明',
  completion_criteria: '完成标准',
  constraints_risks: '风险与约束',
  unknowns: '待确认信息',
};

export const QUICK_DEMO_CASES: QuickDemoCase[] = [
  {
    sourceCaseId: 'ai-poster-website',
    title: '智能海报生成网站',
    originalInput:
      '我想做一个智能海报生成网站，用户输入一句话就能生成可在线访问的海报网页，最好手机上也能看，30 秒内能出结果。',
    template: templates.creative,
    steps: [
      {
        question: '我先确认一下你说的“海报”指什么。你希望生成的是一个可以在线访问的网页，还是一张可供下载的图片文件？',
        questionHighlights: ['网页', '图片文件'],
        answer: '是网页，扫码就能看，不用下载图片。',
        answerHighlights: ['网页'],
        updateMarks: ['expected_outcome=网页海报'],
        followUp: '确认海报交付形态',
      },
      {
        question: '明白，交付物是网页。那么这个网站主要给谁用？是团队内部宣传岗同事批量出海报，还是面向个人创作者自助生成？',
        questionHighlights: ['团队内部宣传岗', '个人创作者'],
        answer: '主要是团队宣传岗的同事，个人创作者是次要的。',
        answerHighlights: ['团队宣传岗为主'],
        updateMarks: ['target_user=团队宣传岗为主'],
        followUp: '确认主要使用者',
      },
      {
        question: '你提到“30秒内能出结果”，这个30秒是指从输入到海报生成完成的时间，还是指生成完后在手机上首次打开看到画面的时间？',
        questionHighlights: ['生成时间', '访问时间'],
        answer: '是生成时间，从输入完那句话到海报出来不超过30秒。',
        answerHighlights: ['生成时间', '30秒'],
        updateMarks: ['completion_criteria=生成时间≤30秒'],
        followUp: '确认完成判断口径',
      },
      {
        question: '最后一个问题：生成出来的海报，是否需要支持多人协作编辑或二次修改？这会影响是否要做编辑器和权限体系。',
        questionHighlights: ['协作编辑', '二次修改', '权限体系'],
        answer: '暂时不需要，能一次生成够用就行。',
        answerHighlights: ['暂时不需要'],
        updateMarks: ['scope_boundary=不做协作与二次修改'],
        followUp: '确认协作与二次修改约束',
      },
    ],
    finalUnderstanding: {
      summary:
        '为小团队宣传岗，在输入一句话快速生成的场景下，解决没有设计能力也能产出海报的问题，达到30秒内得到可移动端访问的网页海报。',
      slots: {
        expected_outcome: '30秒内得到可移动端访问的网页海报',
        target_user: '小团队宣传岗（主要）、个人创作者（次要）',
        core_scenario: '输入一句话 → 系统生成 → 手机扫码访问',
        scope_boundary: '本次只做单页海报生成，不做多页排版和团队协作',
        completion_criteria: '绝大多数生成请求不超过30秒，移动端首屏不超过1秒',
        constraints_risks: '需考虑版权和内容审核，成本控制在每次生成0.5元以内',
      },
    },
    review: {
      cardId: 'scope_boundary',
      answer: '把制作范围改成：首版只做单页网页海报生成，不做编辑器、团队协作和图片导出。',
      answerHighlights: ['单页网页海报', '不做编辑器', '不做图片导出'],
      updateMarks: ['scope_boundary=首版只做单页网页海报生成，不做编辑器、团队协作和图片导出'],
      resolvedNote: '已把制作范围收窄到单页网页海报生成。',
    },
    unknowns: [
      {
        id: 'apw_unknown_001',
        question: '智能生成失败时是否需要兜底方案',
        is_blocking: true,
        impact: '影响可用性承诺、错误处理和首版验收。',
        suggested_owner: '产品负责人',
      },
      {
        id: 'apw_unknown_002',
        question: '是否需要导出图片或文档',
        is_blocking: false,
        impact: '影响交付物形态与后端工作量',
        suggested_owner: '产品负责人',
      },
    ],
    supplement: {
      cardId: 'unknowns',
      answer: '如果智能生成失败，先返回一套模板海报并提示稍后重试；本期不做复杂人工修复。',
      answerHighlights: ['模板海报', '稍后重试', '不做复杂人工修复'],
      updateMarks: ['constraints_risks=生成失败时返回模板兜底'],
      resolvedNote: '已补充生成失败时的兜底策略，首版可按模板回退方案验收。',
    },
    options: [
      {
        id: 'apw_option_b',
        title: '智能生成布局与文案',
        description: '首版聚焦一句话生成网页海报，暂不做复杂编辑器。',
        pros: ['生成链路短', '范围可控'],
        cons: ['后期编辑能力弱'],
        effort: 'medium',
        reversible: true,
        is_recommended: true,
      },
    ],
    guidanceCanvas: {
      title: '网页海报生成工具详细指导',
      currentModuleId: 'generation_flow',
      estimatedTime: '预计还需 1-3 分钟',
      generationSteps: [
        { label: '整理已确认内容', state: 'done' },
        { label: '判断项目类型', state: 'done' },
        { label: '生成模块计划', state: 'active' },
        { label: '撰写章节内容', state: 'pending' },
        { label: '检查前后一致性', state: 'pending' },
      ],
      modules: [
        {
          id: 'positioning',
          title: '目标与成功标准',
          status: '已明确',
          summary: '首版目标是让宣传岗输入一句话后，快速得到可手机访问的网页海报。',
          known: [
            '主要对象是小团队宣传岗，个人创作者是次要对象。',
            '生成耗时以不超过 30 秒作为当前判断口径。',
          ],
          assumptions: [
            '用户更在意快速生成和手机查看，不追求复杂设计编辑。',
          ],
          questions: [
            '30 秒标准后续是否要按平均值、P90 还是 P95 统计？',
          ],
          relatedModuleIds: ['generation_flow', 'risk_fallback'],
        },
        {
          id: 'generation_flow',
          title: '生成流程与交付形态',
          status: '有方案可选',
          summary: '当前模块决定首版从输入、生成、预览到访问的完整闭环。',
          known: [
            '交付物是网页海报，不是单纯图片下载。',
            '用户需要手机扫码查看。',
            '首版不做编辑器、团队协作和图片导出。',
          ],
          assumptions: [
            '可以先用模板结构保证稳定，再让生成模型负责文案和视觉变化。',
          ],
          questions: [
            '生成失败时是否立刻给模板兜底，还是只提示用户稍后重试？',
            '海报网页链接是否需要设置过期时间？',
          ],
          options: [
            {
              id: 'flow_template_first',
              title: '模板兜底优先',
              fit: '适合先验证速度和稳定性，视觉变化不追求极致。',
              tradeoff: '创意空间较小，但更容易控制成本和生成时间。',
              recommended: true,
            },
            {
              id: 'flow_ai_first',
              title: '智能生成优先',
              fit: '适合强调视觉差异化和新鲜感。',
              tradeoff: '成本、审核和超时风险更高，需要更强兜底。',
            },
            {
              id: 'flow_hybrid',
              title: '混合方案',
              fit: '适合首版就希望兼顾稳定和变化。',
              tradeoff: '实现复杂度中等，需要维护模板、模型和审核三条链路。',
            },
          ],
          relatedModuleIds: ['positioning', 'risk_fallback'],
        },
        {
          id: 'risk_fallback',
          title: '风险与兜底策略',
          status: '待确认',
          summary: '版权、内容审核、生成失败和成本控制会影响首版是否可用。',
          known: [
            '当前已经识别版权、内容审核和生成速度风险。',
          ],
          assumptions: [
            '首版需要基础审核，但不做复杂人工复核后台。',
            '生成失败时可以先返回模板海报作为兜底。',
          ],
          questions: [
            '内容审核要覆盖哪些明显不能展示的内容？',
            '单次生成成本是否有上限？',
          ],
          relatedModuleIds: ['generation_flow'],
        },
        {
          id: 'report_structure',
          title: '详细报告结构',
          status: '正在梳理',
          summary: '报告会按模块生成，而不是把软件规格模板直接套到创意交付项目上。',
          known: [
            '需要覆盖目标、用户、流程、范围、成功标准、风险和后续问题。',
            '概述使用普通表达，详细报告使用专业结构。',
          ],
          assumptions: [
            '报告应保留未确认事项，不把初步判断写成事实。',
          ],
          questions: [
            '是否需要把报告导出为给外包方或团队评审使用的版本？',
          ],
          relatedModuleIds: ['positioning', 'generation_flow'],
        },
      ],
    },
  },
  {
    sourceCaseId: 'campus-marketplace',
    title: '校园二手交易小程序',
    originalInput: '我想做一个校园二手交易小程序，让同学可以发布闲置物品，也能更安全地联系和交易。',
    template: templates.software,
    steps: [
      {
        question: '这个小程序第一版更想解决“发布信息”还是“完成交易闭环”？两者会影响支付、聊天和纠纷处理范围。',
        questionHighlights: ['发布信息', '交易闭环'],
        answer: '第一版先做校内发布和联系，不直接做支付闭环。',
        answerHighlights: ['校内发布', '不直接做支付'],
        updateMarks: ['expected_outcome=校内闲置信息发布与联系'],
        followUp: '区分信息发布和交易闭环',
      },
      {
        question: '目标用户是否只限本校学生？如果是，需要什么方式确认身份？',
        questionHighlights: ['本校学生', '确认身份'],
        answer: '只限本校学生，先用校园邮箱或学号认证。',
        answerHighlights: ['本校学生', '校园邮箱'],
        updateMarks: ['target_user=本校学生'],
        followUp: '确认用户范围与身份机制',
      },
      {
        question: '首版最关键的使用场景是什么：发布、搜索、私聊、举报，还是线下交接记录？',
        questionHighlights: ['发布', '搜索', '私聊', '举报'],
        answer: '发布、分类搜索和私聊最关键，举报也要有。',
        answerHighlights: ['发布', '分类搜索', '私聊'],
        updateMarks: ['core_scenario=发布闲置、搜索筛选、私聊约线下交接'],
        followUp: '确认主流程',
      },
      {
        question: '为了控制范围，第一版是否明确不做支付、物流和担保交易？',
        questionHighlights: ['支付', '物流', '担保交易'],
        answer: '对，第一版不做支付、物流和担保交易。',
        answerHighlights: ['不做支付', '不做物流'],
        updateMarks: ['scope_boundary=不做支付、物流、担保交易'],
        followUp: '确认不做项',
      },
    ],
    finalUnderstanding: {
      summary:
        '为本校学生提供安全的闲置信息发布和联系工具，首版聚焦发布、分类搜索、私聊和举报，不进入支付或物流闭环。',
      slots: {
        expected_outcome: '校内闲置发布、搜索、联系更安全',
        target_user: '本校学生，需校园邮箱或学号认证',
        core_scenario: '发布闲置 → 分类搜索 → 私聊约线下交接 → 必要时举报',
        scope_boundary: '首版不做支付、物流、担保交易',
        completion_criteria: '学生能完成发布、搜索、私聊和举报的端到端流程',
        constraints_risks: '身份认证、违规商品、线下纠纷和隐私保护需要明确',
      },
    },
    review: {
      cardId: 'constraints_risks',
      answer: '把风险与约束补成：校内身份认证、违规商品审核、举报处理和线下纠纷规则都要在首版说明清楚。',
      answerHighlights: ['校内身份认证', '违规商品审核', '举报处理'],
      updateMarks: ['constraints_risks=校内身份认证、违规商品审核、举报处理和线下纠纷规则需要首版说明清楚'],
      resolvedNote: '已把首版需要说明的安全与治理规则补到风险与约束里。',
    },
    unknowns: [
      {
        id: 'cmp_unknown_001',
        question: '违规商品清单由谁维护',
        is_blocking: true,
        impact: '影响审核和举报规则',
        suggested_owner: '校方或平台负责人',
      },
    ],
    supplement: {
      cardId: 'unknowns',
      answer: '违规商品清单由学生事务处提供初版，平台管理员每月维护；举报高频项可以随时补充。',
      answerHighlights: ['学生事务处', '平台管理员', '举报高频项'],
      updateMarks: ['constraints_risks=学生事务处与平台管理员共同维护违规清单'],
      resolvedNote: '已明确违规商品清单的责任方和更新节奏。',
    },
    options: [
      {
        id: 'cmp_option_a',
        title: '信息发布优先',
        description: '先验证发布、搜索和私聊需求，再决定是否补交易闭环。',
        pros: ['上线快', '风险低'],
        cons: ['不能沉淀完整交易数据'],
        effort: 'medium',
        reversible: true,
        is_recommended: true,
      },
    ],
  },
  {
    sourceCaseId: 'aigc-education-paper',
    title: '生成式智能教育影响课程论文',
    originalInput: '我要写一篇生成式智能对教育影响的课程论文，但不知道怎么确定主题和结构。',
    template: templates.academic,
    steps: [
      {
        question: '这篇论文的课程要求是什么？先确认字数、截止时间和是否有评分标准。',
        questionHighlights: ['字数', '截止时间', '评分标准'],
        answer: '要求3000字，两周后交，老师强调要有明确问题和文献引用。',
        answerHighlights: ['3000字', '两周后', '文献引用'],
        updateMarks: ['completion_criteria=3000字、两周后提交、需文献引用'],
        followUp: '确认任务要求',
      },
      {
        question: '你更想讨论哪个教育阶段或场景：中小学、高校、教师备课、学生写作，还是评价方式？',
        questionHighlights: ['中小学', '高校', '教师备课', '学生写作'],
        answer: '我想聚焦高校学生写作，不想泛泛讨论全部教育。',
        answerHighlights: ['高校学生写作'],
        updateMarks: ['scope_boundary=聚焦高校学生写作'],
        followUp: '确认研究范围',
      },
      {
        question: '你倾向提出什么核心问题：它提高学习效率，还是削弱原创性与评价公平？',
        questionHighlights: ['学习效率', '原创性', '评价公平'],
        answer: '我想讨论它提高效率但也冲击原创性和评价公平。',
        answerHighlights: ['提高效率', '原创性', '评价公平'],
        updateMarks: ['expected_outcome=形成有取舍的论证主线'],
        followUp: '确认研究问题',
      },
      {
        question: '材料方面，老师是否允许使用英文文献和真实案例？这会影响证据范围。',
        questionHighlights: ['英文文献', '真实案例', '证据范围'],
        answer: '允许英文文献，也可以引用高校政策案例。',
        answerHighlights: ['英文文献', '高校政策案例'],
        updateMarks: ['constraints_risks=允许英文文献和高校政策案例'],
        followUp: '确认证据范围',
      },
    ],
    finalUnderstanding: {
      summary:
        '围绕生成式智能对高校学生写作的影响写一篇课程论文，重点讨论效率提升与原创性、评价公平之间的张力。',
      slots: {
        expected_outcome: '形成一篇有明确研究问题和论证主线的课程论文',
        target_user: '课程教师与学生本人',
        core_scenario: '课程作业，两周内完成 3000 字论文',
        scope_boundary: '聚焦高校学生写作，不泛化到所有教育场景',
        completion_criteria: '3000字、文献引用充分、问题明确、结构清晰',
        constraints_risks: '需平衡效率、原创性和评价公平，引用英文文献与高校政策案例',
      },
    },
    review: {
      cardId: 'completion_criteria',
      answer: '把作业要求改成：两周内完成 3000 字课程论文，至少有清晰论点、章节结构和可引用材料清单。',
      answerHighlights: ['两周内', '3000 字', '可引用材料清单'],
      updateMarks: ['completion_criteria=两周内完成3000字课程论文，具备清晰论点、章节结构和可引用材料清单'],
      resolvedNote: '已把作业要求改成更可检查的交付口径。',
    },
    unknowns: [
      {
        id: 'aep_unknown_001',
        question: '引用格式和最低文献数量是否有要求',
        is_blocking: true,
        impact: '影响论文结构、材料筛选和最终排版。',
        suggested_owner: '学生',
      },
    ],
    supplement: {
      cardId: 'unknowns',
      answer: '课程没有指定格式，但老师建议至少引用 6 篇文献，其中 2 篇英文文献；参考文献按 APA 整理。',
      answerHighlights: ['至少引用 6 篇', '2 篇英文文献', 'APA'],
      updateMarks: ['completion_criteria=至少6篇文献、含2篇英文、APA格式'],
      resolvedNote: '已补齐文献数量与引用格式，论文交付口径可以落到版本计划。',
    },
    options: [
      {
        id: 'aep_option_a',
        title: '问题导向论文',
        description: '围绕“效率与公平的张力”组织章节。',
        pros: ['论点集中', '便于引用文献'],
        cons: ['需要筛选材料'],
        effort: 'medium',
        reversible: true,
        is_recommended: true,
      },
    ],
  },
  {
    sourceCaseId: 'gym-renewal-service',
    title: '健身房会员续费流程',
    originalInput: '帮一家健身房优化会员续费流程，现在很多会员到期后就流失了。',
    template: templates.service,
    steps: [
      {
        question: '这次优化的核心指标是什么：续费率、续费金额、投诉减少，还是员工跟进效率？',
        questionHighlights: ['续费率', '续费金额', '投诉', '跟进效率'],
        answer: '核心是续费率，员工跟进效率也要提升。',
        answerHighlights: ['续费率', '跟进效率'],
        updateMarks: ['expected_outcome=提升续费率和员工跟进效率'],
        followUp: '确认运营指标',
      },
      {
        question: '会员通常在哪个节点流失：到期前无提醒、价格沟通、课程体验，还是续费手续太麻烦？',
        questionHighlights: ['到期前', '价格沟通', '课程体验', '手续'],
        answer: '主要是到期前没有有效提醒，顾问跟进不稳定。',
        answerHighlights: ['提醒', '跟进不稳定'],
        updateMarks: ['core_scenario=到期前提醒与顾问跟进'],
        followUp: '确认流失节点',
      },
      {
        question: '续费流程涉及哪些角色？前台、会籍顾问、教练和店长分别做什么？',
        questionHighlights: ['前台', '会籍顾问', '教练', '店长'],
        answer: '会籍顾问负责跟进，教练提供训练反馈，店长只看转化数据。',
        answerHighlights: ['会籍顾问', '教练', '店长'],
        updateMarks: ['target_user=会员、会籍顾问、教练、店长'],
        followUp: '确认分工责任',
      },
      {
        question: '第一版是先改人工流程，还是要同时接客户管理系统、短信和企业微信？',
        questionHighlights: ['人工流程', '客户管理系统', '短信', '企业微信'],
        answer: '先改人工流程和企业微信提醒，客户管理系统等第二版再接。',
        answerHighlights: ['人工流程', '企业微信提醒'],
        updateMarks: ['scope_boundary=首版优化人工流程与企业微信提醒'],
        followUp: '确认首版边界',
      },
    ],
    finalUnderstanding: {
      summary:
        '围绕健身房会员到期前提醒和顾问跟进流程，首版优化人工协同与企业微信提醒，目标是提升续费率和跟进稳定性。',
      slots: {
        expected_outcome: '提升会员续费率和员工跟进效率',
        target_user: '会员、会籍顾问、教练、店长',
        core_scenario: '到期前提醒 → 顾问跟进 → 教练反馈辅助 → 店长查看数据',
        scope_boundary: '首版改人工流程和企业微信提醒，客户管理系统集成放到第二版',
        completion_criteria: '续费跟进节点可追踪，顾问漏跟进减少',
        constraints_risks: '会员隐私、员工执行一致性、提醒频率打扰感',
      },
    },
    review: {
      cardId: 'core_scenario',
      answer: '把服务流程改成：到期前 14 天提醒、顾问跟进、教练补充训练反馈、店长查看转化结果。',
      answerHighlights: ['到期前 14 天', '顾问跟进', '店长查看转化结果'],
      updateMarks: ['core_scenario=到期前14天提醒、顾问跟进、教练补充训练反馈、店长查看转化结果'],
      resolvedNote: '已把服务流程改成带时间节点和角色动作的版本。',
    },
    unknowns: [
      {
        id: 'grs_unknown_001',
        question: '当前续费率和目标提升幅度是多少',
        is_blocking: true,
        impact: '影响完成标准是否可度量',
        suggested_owner: '店长',
      },
    ],
    supplement: {
      cardId: 'unknowns',
      answer: '当前月续费率大约 42%，第一阶段希望提升到 50%；先按 8 周试运行看漏跟进数量和续费率变化。',
      answerHighlights: ['42%', '50%', '8 周试运行'],
      updateMarks: ['completion_criteria=8周内月续费率从42%提升到50%'],
      resolvedNote: '已补齐当前基线、目标幅度和观察周期。',
    },
    options: [
      {
        id: 'grs_option_a',
        title: '流程先行',
        description: '先统一跟进节点和企业微信提醒，再评估系统集成。',
        pros: ['改动快', '便于验证'],
        cons: ['自动化程度有限'],
        effort: 'low',
        reversible: true,
        is_recommended: true,
      },
    ],
  },
  {
    sourceCaseId: 'corporate-website-outsourcing',
    title: '企业官网外包采购',
    originalInput: '我要找外包做一个企业官网，希望能把需求说清楚，避免后面返工。',
    template: templates.outsourcing,
    steps: [
      {
        question: '官网的主要目的是什么：品牌展示、获客线索、招聘展示，还是投资人/客户背书？',
        questionHighlights: ['品牌展示', '获客线索', '招聘', '背书'],
        answer: '主要是品牌展示和获客线索。',
        answerHighlights: ['品牌展示', '获客线索'],
        updateMarks: ['expected_outcome=品牌展示与获客线索'],
        followUp: '确认官网目标',
      },
      {
        question: '首版需要哪些栏目和功能？例如首页、产品、案例、新闻、表单、内容管理、多语言。',
        questionHighlights: ['栏目', '表单', '内容管理', '多语言'],
        answer: '需要首页、产品、案例、关于我们、联系表单，暂时不要新闻和多语言。',
        answerHighlights: ['联系表单', '不要新闻', '不要多语言'],
        updateMarks: ['core_scenario=访问官网了解产品并提交联系表单'],
        followUp: '确认栏目功能',
      },
      {
        question: '交付物包括哪些：设计稿、前端代码、部署上线、内容管理、文案、图片拍摄，还是只做页面？',
        questionHighlights: ['设计稿', '代码', '部署', '文案'],
        answer: '需要设计稿、前端代码和部署上线，文案我们自己给。',
        answerHighlights: ['设计稿', '前端代码', '部署上线'],
        updateMarks: ['completion_criteria=设计稿、前端代码、部署上线'],
        followUp: '确认交付物',
      },
      {
        question: '为了减少返工，哪些内容要明确排除？例如拍摄、品牌重做、复杂会员系统、长期运维。',
        questionHighlights: ['排除', '拍摄', '品牌重做', '长期运维'],
        answer: '排除拍摄、品牌重做和长期运维，首版不做会员系统。',
        answerHighlights: ['排除拍摄', '不做会员系统'],
        updateMarks: ['scope_boundary=排除拍摄、品牌重做、长期运维、会员系统'],
        followUp: '确认排除项',
      },
    ],
    finalUnderstanding: {
      summary:
        '企业官网外包首版以品牌展示和获客线索为目标，交付设计稿、前端代码和部署上线，明确排除拍摄、品牌重做、长期运维和会员系统。',
      slots: {
        expected_outcome: '品牌展示与获客线索',
        target_user: '潜在客户、合作伙伴和企业市场负责人',
        core_scenario: '访问官网了解产品案例并提交联系表单',
        scope_boundary: '排除拍摄、品牌重做、长期运维和会员系统',
        completion_criteria: '设计稿、前端代码和部署上线完成，联系表单可用',
        constraints_risks: '需明确素材责任、验收标准、里程碑和变更机制',
      },
    },
    review: {
      cardId: 'scope_boundary',
      answer: '把工作范围改成：首版只做企业官网设计、前端开发和上线，排除拍摄、品牌重做、会员系统和长期运维。',
      answerHighlights: ['官网设计', '前端开发和上线', '排除拍摄'],
      updateMarks: ['scope_boundary=首版只做企业官网设计、前端开发和上线，排除拍摄、品牌重做、会员系统和长期运维'],
      resolvedNote: '已把外包范围改成更适合询价和验收的边界说明。',
    },
    unknowns: [
      {
        id: 'cwo_unknown_001',
        question: '是否需要内容管理功能以及谁维护内容',
        is_blocking: true,
        impact: '影响报价、交付和长期责任边界',
        suggested_owner: '甲方负责人',
      },
    ],
    supplement: {
      cardId: 'unknowns',
      answer: '首版不做完整内容管理系统，只保留联系表单后台；产品案例和关于我们内容由甲方市场负责人交付。',
      answerHighlights: ['不做完整内容管理系统', '联系表单后台', '市场负责人'],
      updateMarks: ['scope_boundary=首版不做完整CMS，内容由甲方提供'],
      resolvedNote: '已明确内容管理边界和内容维护责任。',
    },
    options: [
      {
        id: 'cwo_option_a',
        title: '工作范围先明确',
        description: '先产出工作范围、交付物、排除项和验收表，再询价。',
        pros: ['减少返工', '便于比价'],
        cons: ['前期澄清更多'],
        effort: 'medium',
        reversible: true,
        is_recommended: true,
      },
    ],
  },
  {
    sourceCaseId: 'ai-interview-assistant-capstone',
    title: '智能面试助手毕业设计',
    originalInput: '我们三个人要做一个智能面试助手毕业设计，需要明确第一版做什么。',
    template: templates.collaboration,
    steps: [
      {
        question: '这个毕业设计的主要评审对象是谁？老师看重可运行演示、研究创新，还是工程完整度？',
        questionHighlights: ['评审对象', '可运行演示', '研究创新', '工程完整度'],
        answer: '主要给老师答辩演示，老师看重可运行和工程完整度。',
        answerHighlights: ['答辩演示', '工程完整度'],
        updateMarks: ['expected_outcome=可答辩演示的智能面试助手'],
        followUp: '确认共同目标',
      },
      {
        question: '第一版核心能力是生成面试题、模拟面试、评分反馈，还是岗位能力画像？',
        questionHighlights: ['生成面试题', '模拟面试', '评分反馈', '能力画像'],
        answer: '第一版做模拟面试和评分反馈，题目生成可以简单一点。',
        answerHighlights: ['模拟面试', '评分反馈'],
        updateMarks: ['core_scenario=模拟面试后给评分反馈'],
        followUp: '确认核心能力',
      },
      {
        question: '三个人分别负责什么？前端、后端、模型、资料和答辩材料是否有人负责？',
        questionHighlights: ['前端', '后端', '模型', '答辩材料'],
        answer: '一个人前端，一个人后端和数据库，一个人模型调用和答辩材料。',
        answerHighlights: ['前端', '后端', '模型调用'],
        updateMarks: ['target_user=三人小组与答辩老师'],
        followUp: '确认分工',
      },
      {
        question: '有没有必须避开的风险，比如录音隐私、真实面试数据、模型幻觉或学校伦理要求？',
        questionHighlights: ['录音隐私', '真实面试数据', '模型幻觉', '伦理'],
        answer: '不采集真实面试数据，演示用模拟文本，不做录音。',
        answerHighlights: ['不采集真实数据', '不做录音'],
        updateMarks: ['constraints_risks=演示用模拟文本，不采集真实面试数据'],
        followUp: '确认数据与伦理边界',
      },
    ],
    finalUnderstanding: {
      summary:
        '三人毕业设计首版做可运行的智能面试助手演示，核心是模拟面试和评分反馈，分工覆盖前端、后端、模型调用与答辩材料，并避开真实数据和录音风险。',
      slots: {
        expected_outcome: '可答辩演示的智能面试助手',
        target_user: '三人小组、答辩老师、模拟求职者',
        core_scenario: '选择岗位 → 模拟问答 → 生成评分反馈 → 展示答辩材料',
        scope_boundary: '题库生成简化，不采集真实面试数据，不做录音',
        completion_criteria: '端到端演示稳定，评分反馈可解释，答辩材料完整',
        constraints_risks: '模型幻觉、隐私合规、团队分工和时间节点',
      },
    },
    review: {
      cardId: 'target_user',
      answer: '把分工责任改成：服务对象先按三人项目组、答辩老师和演示中的模拟求职者整理，真实求职者不纳入首版。',
      answerHighlights: ['三人项目组', '答辩老师', '真实求职者不纳入'],
      updateMarks: ['target_user=三人项目组、答辩老师和演示中的模拟求职者，真实求职者不纳入首版'],
      resolvedNote: '已把分工责任卡片中的服务对象收敛到演示和答辩语境。',
    },
    unknowns: [
      {
        id: 'aia_unknown_001',
        question: '最终答辩日期和中期检查节点',
        is_blocking: true,
        impact: '影响版本计划和范围裁剪',
        suggested_owner: '项目组',
      },
    ],
    supplement: {
      cardId: 'unknowns',
      answer: '中期检查在第 6 周，最终答辩在第 14 周；第 6 周前必须跑通模拟面试到评分反馈闭环。',
      answerHighlights: ['第 6 周', '第 14 周', '跑通闭环'],
      updateMarks: ['completion_criteria=第6周跑通闭环，第14周完成答辩版本'],
      resolvedNote: '已补齐关键时间节点和中期检查范围。',
    },
    options: [
      {
        id: 'aia_option_a',
        title: '演示闭环优先',
        description: '先保证模拟面试到评分反馈的闭环，再扩展题库和报告。',
        pros: ['适合答辩', '分工清晰'],
        cons: ['研究深度需另补材料'],
        effort: 'medium',
        reversible: true,
        is_recommended: true,
      },
    ],
  },
  {
    sourceCaseId: 'social-anxiety-coach',
    title: '社恐沟通训练智能产品',
    originalInput: '我想做一个帮助社恐的人练沟通的智能产品，但还不确定应该从哪里切入。',
    template: templates.early_idea,
    steps: [
      {
        question: '先不急着定产品形态。你说的“练沟通”更像练什么时刻：破冰聊天、面试、汇报、恋爱社交，还是线下点单问路？',
        questionHighlights: ['破冰聊天', '面试', '汇报', '线下'],
        answer: '我更想先做面试和汇报这种有明确场景的练习。',
        answerHighlights: ['面试', '汇报'],
        updateMarks: ['core_scenario=面试和汇报前的沟通练习'],
        followUp: '确认使用时刻',
      },
      {
        question: '目标用户更偏学生、职场新人，还是长期社交焦虑的人？不同人群需要的反馈强度不一样。',
        questionHighlights: ['学生', '职场新人', '社交焦虑'],
        answer: '先面向学生和职场新人，不做医疗或心理治疗方向。',
        answerHighlights: ['学生', '职场新人', '不做心理治疗'],
        updateMarks: ['target_user=学生与职场新人'],
        followUp: '确认用户边界',
      },
      {
        question: '智能助手的角色更像陪练对象、反馈教练，还是脚本生成器？',
        questionHighlights: ['陪练对象', '反馈教练', '脚本生成器'],
        answer: '更像陪练对象加反馈教练，脚本生成只是辅助。',
        answerHighlights: ['陪练', '反馈教练'],
        updateMarks: ['expected_outcome=陪练并给出沟通反馈'],
        followUp: '确认产品能力假设',
      },
      {
        question: '第一版要验证什么最大不确定性：用户是否愿意练、反馈是否有用，还是付费意愿？',
        questionHighlights: ['愿意练', '反馈有用', '付费意愿'],
        answer: '先验证用户是否愿意持续练，以及反馈是否有帮助。',
        answerHighlights: ['持续练', '反馈有帮助'],
        updateMarks: ['completion_criteria=验证持续练习意愿与反馈价值'],
        followUp: '确认验证目标',
      },
    ],
    finalUnderstanding: {
      summary:
        '这是一个早期想法验证项目，首版聚焦学生和职场新人，在面试和汇报场景中做智能陪练与反馈，暂不进入医疗或心理治疗方向。',
      slots: {
        expected_outcome: '智能陪练并给出沟通反馈',
        target_user: '学生与职场新人',
        core_scenario: '面试和汇报前进行模拟练习，结束后得到反馈',
        scope_boundary: '不做医疗或心理治疗方向，脚本生成只是辅助',
        completion_criteria: '验证用户是否愿意持续练习，以及反馈是否有帮助',
        constraints_risks: '心理健康边界、反馈伤害感、隐私和长期留存',
      },
    },
    review: {
      cardId: 'scope_boundary',
      answer: '把范围说明改成：只做沟通陪练和反馈，不提供心理诊断或治疗建议，并明确隐私保护。',
      answerHighlights: ['沟通陪练和反馈', '不提供心理诊断', '隐私保护'],
      updateMarks: ['scope_boundary=只做沟通陪练和反馈，不提供心理诊断或治疗建议，并明确隐私保护'],
      resolvedNote: '已把早期想法的范围说明改成更清楚的非医疗产品约束。',
    },
    unknowns: [
      {
        id: 'sac_unknown_001',
        question: '用户愿意在什么频率下练习',
        is_blocking: true,
        impact: '影响留存假设和产品节奏',
        suggested_owner: '产品负责人',
      },
    ],
    supplement: {
      cardId: 'unknowns',
      answer: '先假设每周练习 3 次，每次 10 分钟；首轮验证看 7 天内是否完成至少 2 次练习。',
      answerHighlights: ['每周 3 次', '每次 10 分钟', '7 天内至少 2 次'],
      updateMarks: ['completion_criteria=7天内至少完成2次练习'],
      resolvedNote: '已补齐练习频率假设和首轮验证指标。',
    },
    options: [
      {
        id: 'sac_option_a',
        title: '验证型原型',
        description: '先做陪练和反馈的最小闭环，用实际练习意愿决定后续方向。',
        pros: ['避免过早定稿', '能验证真实需求'],
        cons: ['功能完整度较低'],
        effort: 'low',
        reversible: true,
        is_recommended: true,
      },
    ],
  },
];

export function getQuickDemoCase(sourceCaseId?: string | null): QuickDemoCase | undefined {
  if (!sourceCaseId) return undefined;
  return QUICK_DEMO_CASES.find((item) => item.sourceCaseId === sourceCaseId);
}

export function quickDemoSelections(): QuickDemoSelection[] {
  return QUICK_DEMO_CASES.map((item) => ({
    sourceCaseId: item.sourceCaseId,
    title: item.title,
    originalInput: item.originalInput,
    templateLabel: item.template.label,
  }));
}

export function quickDemoGuidedAnswers(sourceCaseId?: string | null): string[] {
  return getQuickDemoCase(sourceCaseId)?.steps.map((step) => step.answer) ?? [];
}

export function quickDemoReview(sourceCaseId?: string | null): QuickDemoCase['review'] | undefined {
  return getQuickDemoCase(sourceCaseId)?.review;
}

export function quickDemoReviewAnswer(sourceCaseId?: string | null): string | undefined {
  return quickDemoReview(sourceCaseId)?.answer;
}

export function quickDemoSupplement(sourceCaseId?: string | null): QuickDemoCase['supplement'] | undefined {
  return getQuickDemoCase(sourceCaseId)?.supplement;
}

export function quickDemoSupplementAnswer(sourceCaseId?: string | null): string | undefined {
  return quickDemoSupplement(sourceCaseId)?.answer;
}

export function quickDemoCardTitle(
  sourceCaseId?: string | null,
  cardId?: QuickDemoCardId | string | null,
): string {
  if (!cardId) return '指定卡片';
  if (cardId === 'unknowns') return DEFAULT_CARD_TITLES.unknowns;
  const demoCase = getQuickDemoCase(sourceCaseId);
  if (demoCase) {
    const slotIndex = TEMPLATE_CARD_SLOT_MAP[demoCase.template.kind].indexOf(cardId as Exclude<QuickDemoCardId, 'unknowns'>);
    const thematicTitle = slotIndex >= 0 ? demoCase.template.rightPanelCards[slotIndex]?.title : undefined;
    if (thematicTitle) return thematicTitle;
  }
  return DEFAULT_CARD_TITLES[cardId as QuickDemoCardId] ?? '指定卡片';
}

export function buildQuickDemoTurns(demoCase: QuickDemoCase): QuickDemoTurn[] {
  const turns: QuickDemoTurn[] = [];
  demoCase.steps.forEach((step, index) => {
    const turnNumber = index + 1;
    turns.push({
      id: `${demoCase.sourceCaseId}_assistant_${turnNumber}`,
      role: 'assistant',
      content: step.question,
      structured_content: {
        paragraphs: [step.question],
        highlights: step.questionHighlights,
      },
      source_refs: index === 0 ? ['scenario#original_input'] : [`${demoCase.sourceCaseId}_user_${index}`],
      update_marks: [],
      follow_ups: [step.followUp],
    });
    turns.push({
      id: `${demoCase.sourceCaseId}_user_${turnNumber}`,
      role: 'user',
      content: step.answer,
      structured_content: {
        paragraphs: [step.answer],
        highlights: step.answerHighlights,
      },
      source_refs: [],
      update_marks: step.updateMarks,
      follow_ups: [],
    });
  });
  return turns;
}

type BriefSection = { title: string; content: string };

function sectionListToMarkdown(title: string, sections: BriefSection[]): string {
  return [
    `# ${title}`,
    ...sections.map((section) => `## ${section.title}\n\n${section.content}`),
  ].join('\n\n');
}

function buildDetailedReportSections(demoCase: QuickDemoCase): BriefSection[] {
  const slots = demoCase.finalUnderstanding.slots;
  const blockingUnknowns = demoCase.unknowns.filter((item) => item.is_blocking);
  const nonBlockingUnknowns = demoCase.unknowns.filter((item) => !item.is_blocking);
  const recommendedOption =
    demoCase.options.find((option) => option.is_recommended) ?? demoCase.options[0];
  const alternatives = demoCase.options.filter((option) => option.id !== recommendedOption?.id);
  const reportStatus =
    blockingUnknowns.length > 0
      ? '未完成草稿：存在需要优先确认的信息，适合内部讨论，不宜直接作为承诺。'
      : '可用版本：核心信息已形成一致口径，可用于沟通、评审或下一步协作。';
  const questionTrace = demoCase.steps
    .map((step, index) => `${index + 1}. ${step.question}\n   回答：${step.answer}\n   写入：${formatUpdateMarks(step.updateMarks)}`)
    .join('\n');

  return [
    {
      title: '报告摘要',
      content: [
        `- 项目名称：${demoCase.title}`,
        `- 需求类型：${demoCase.template.label}`,
        `- 报告状态：${reportStatus}`,
        `- 当前结论：${demoCase.finalUnderstanding.summary}`,
        `- 推荐推进方向：${recommendedOption?.title ?? '继续澄清后再形成推荐方向'}。${recommendedOption?.description ?? ''}`,
        '- 使用边界：本报告基于当前对话整理，用于需求沟通和方案准备，不等同于正式项目基线、合同验收文件或最终决策记录。',
      ].join('\n'),
    },
    {
      title: '原始诉求与分析目标',
      content: [
        '| 项目 | 内容 |',
        '| --- | --- |',
        `| 用户原始表达 | ${demoCase.originalInput} |`,
        `| 需求分析目标 | 把原始表达澄清为可讨论、可评审、可继续补充的需求口径。 |`,
        `| 重点分析维度 | ${demoCase.template.priorityDimensions.join('、')} |`,
        `| 当前适用对象 | 需求方、协作者、执行方、评审人。 |`,
      ].join('\n'),
    },
    {
      title: '已确认理解',
      content: [
        '| 维度 | 当前口径 | 状态 | 来源 |',
        '| --- | --- | --- | --- |',
        `| 期望结果 | ${slots.expected_outcome ?? '待确认'} | 已整理 | 用户原始输入与追问回答 |`,
        `| 目标用户 / 相关角色 | ${slots.target_user ?? '待确认'} | 已整理 | 追问回答 |`,
        `| 核心场景 | ${slots.core_scenario ?? '待确认'} | 已整理 | 追问回答 |`,
        `| 范围说明 | ${slots.scope_boundary ?? '待确认'} | 候选口径 | 追问回答与复核修改 |`,
        `| 完成标准 | ${slots.completion_criteria ?? '待确认'} | 候选口径 | 追问回答 |`,
        `| 风险与约束 | ${slots.constraints_risks ?? '待确认'} | 待持续复核 | 追问回答与系统整理 |`,
      ].join('\n'),
    },
    {
      title: '用户、场景与价值',
      content: [
        '| 项目 | 说明 |',
        '| --- | --- |',
        `| 主要对象 | ${slots.target_user ?? '待确认'} |`,
        `| 使用场景 | ${slots.core_scenario ?? '待确认'} |`,
        `| 期望价值 | ${slots.expected_outcome ?? demoCase.finalUnderstanding.summary} |`,
        `| 价值判断方式 | 以“${slots.completion_criteria ?? '可观察的完成标准'}”作为当前沟通口径。 |`,
      ].join('\n'),
    },
    {
      title: '用户场景与独立验证',
      content: buildUserScenarioTable(demoCase),
    },
    {
      title: '范围定义',
      content: [
        '| 分类 | 当前口径 | 说明 |',
        '| --- | --- | --- |',
        `| 本次包含 | ${extractInScope(slots.scope_boundary)} | 可作为当前版本讨论范围。 |`,
        `| 本次不包含 | ${extractOutOfScope(slots.scope_boundary)} | 防止范围无意识扩大。 |`,
        `| 关键约束 | ${slots.constraints_risks ?? '待确认'} | 后续方案、报价、排期或交付前需要持续检查。 |`,
        `| 范围风险 | ${blockingUnknowns.length > 0 ? blockingUnknowns.map((item) => item.question).join('；') : '暂无必须先确认的信息。'} | 未确认前不能被写成正式承诺。 |`,
      ].join('\n'),
    },
    {
      title: '关键对象',
      content: buildKeyObjectTable(demoCase),
    },
    {
      title: '功能需求清单',
      content: buildRequirementTable(demoCase),
    },
    {
      title: '成功标准与验收口径',
      content: buildAcceptanceTable(demoCase),
    },
    {
      title: '边界情况与异常处理',
      content: buildEdgeCaseTable(demoCase),
    },
    {
      title: '假设与依赖',
      content: buildAssumptionTable(demoCase),
    },
    {
      title: '方案比较与推荐',
      content: buildOptionTable(demoCase),
    },
    {
      title: '风险与待确认事项',
      content: buildRiskTable(demoCase),
    },
    {
      title: '追问依据与记录',
      content: questionTrace,
    },
    {
      title: '版本说明与后续动作',
      content: [
        `- 当前版本定位：${reportStatus}`,
        '- 先确认“风险与待确认事项”中标为“需先确认”的内容。',
        '- 确认后重新生成新版报告，新版应覆盖变更记录并保留旧版历史。',
        '- 若进入正式项目，应补充证据来源、责任人、验收方式、版本基线和变更规则。',
        '- 已导出的旧文件不会被静默改写；需要更正时应使用新版本重新导出。',
      ].join('\n'),
    },
  ];
}

function buildUserScenarioTable(demoCase: QuickDemoCase): string {
  const slots = demoCase.finalUnderstanding.slots;
  return [
    '| 编号 | 用户场景 | 参与对象 | 独立验证方式 | 优先级 |',
    '| --- | --- | --- | --- | --- |',
    `| US-001 | ${slots.core_scenario ?? '完成核心使用场景'} | ${slots.target_user ?? '目标用户'} | 按场景从开始到结束走一遍，检查是否得到“${slots.expected_outcome ?? '期望结果'}”。 | P0 |`,
    `| US-002 | 复核当前范围并排除不做内容 | 需求方 / 执行方 | 对照“范围定义”确认本期包含和不包含内容，没有把待确认内容写成承诺。 | P0 |`,
    `| US-003 | 补齐关键待确认事项后更新报告 | 需求方 / 协作者 | 回到对话补充信息，生成新版本，旧版本仍可追溯。 | P1 |`,
  ].join('\n');
}

function buildKeyObjectTable(demoCase: QuickDemoCase): string {
  const slots = demoCase.finalUnderstanding.slots;
  return [
    '| 对象 | 含义 | 当前记录 | 状态 |',
    '| --- | --- | --- | --- |',
    `| 需求目标 | 本次希望达成的结果 | ${slots.expected_outcome ?? '待确认'} | 已整理 |`,
    `| 目标对象 | 使用、评审或受影响的人 | ${slots.target_user ?? '待确认'} | 已整理 |`,
    `| 核心场景 | 需求发生的上下文和流程 | ${slots.core_scenario ?? '待确认'} | 已整理 |`,
    `| 范围边界 | 本期包含和不包含的内容 | ${slots.scope_boundary ?? '待确认'} | 候选 |`,
    `| 待确认事项 | 会影响方案、成本、风险或承诺的问题 | ${demoCase.unknowns.map((item) => item.question).join('；') || '暂无'} | 待处理 |`,
    `| 候选方案 | 当前可选推进路径 | ${demoCase.options.map((option) => option.title).join('；') || '待形成'} | 候选 |`,
  ].join('\n');
}

function buildRequirementTable(demoCase: QuickDemoCase): string {
  const slots = demoCase.finalUnderstanding.slots;
  const rows = [
    ['FR-001', '交付目标', 'P0', slots.expected_outcome ?? '待确认', '决定报告是否有明确产出方向'],
    ['FR-002', '目标对象', 'P0', slots.target_user ?? '待确认', '决定场景、语言、权限、验收人和优先级'],
    ['FR-003', '核心场景', 'P0', slots.core_scenario ?? '待确认', '决定首版闭环和演示路径'],
    ['FR-004', '范围边界', 'P0', slots.scope_boundary ?? '待确认', '决定本期做什么、不做什么'],
    ['FR-005', '完成标准', 'P0', slots.completion_criteria ?? '待确认', '决定是否可以判断“完成”'],
    ['FR-006', '约束与风险', 'P1', slots.constraints_risks ?? '待确认', '决定方案可行性和后续确认重点'],
  ];

  return [
    '| 编号 | 需求项 | 优先级 | 当前描述 | 影响 |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildAcceptanceTable(demoCase: QuickDemoCase): string {
  const slots = demoCase.finalUnderstanding.slots;
  return [
    '| 编号 | 成功标准 | 验证方式 | 状态 |',
    '| --- | --- | --- | --- |',
    `| SC-001 | ${slots.expected_outcome ?? '期望结果明确'} | 由需求方检查交付物是否符合目标描述 | 候选 |`,
    `| SC-002 | ${slots.core_scenario ?? '核心场景可走通'} | 按核心场景走一遍端到端流程 | 候选 |`,
    `| SC-003 | ${slots.scope_boundary ?? '范围边界清楚'} | 对照范围说明检查是否加入了未确认内容 | 候选 |`,
    `| SC-004 | ${slots.completion_criteria ?? '完成标准可观察'} | 使用可观察标准进行检查 | 候选 |`,
    '| SC-005 | 重大未知必须保留为待确认，不得写成事实 | 查看报告待确认事项与后续动作 | 必须满足 |',
  ].join('\n');
}

function buildEdgeCaseTable(demoCase: QuickDemoCase): string {
  const slots = demoCase.finalUnderstanding.slots;
  const firstBlocking = demoCase.unknowns.find((item) => item.is_blocking);
  return [
    '| 类型 | 情况 | 当前处理口径 | 状态 |',
    '| --- | --- | --- | --- |',
    `| 范围扩张 | 执行中加入“${extractOutOfScope(slots.scope_boundary)}”等未确认内容 | 先作为变更或待确认项，不直接并入本期范围 | 已定义 |`,
    `| 完成标准不清 | 无法判断“${slots.expected_outcome ?? '期望结果'}”是否达成 | 回到完成标准继续追问，直到有可观察判断口径 | 已定义 |`,
    `| 关键未知未补齐 | ${firstBlocking?.question ?? '暂无必须先确认的信息'} | 报告保留未完成草稿状态，提醒先确认影响 | ${firstBlocking ? '待确认' : '暂无'} |`,
    '| 方案偏好变化 | 用户选择非推荐方案或改变偏好 | 保留系统建议、用户偏好和主要取舍，不写成正式决策 | 已定义 |',
  ].join('\n');
}

function buildAssumptionTable(demoCase: QuickDemoCase): string {
  const slots = demoCase.finalUnderstanding.slots;
  return [
    '| 编号 | 假设 / 依赖 | 影响 | 处理方式 |',
    '| --- | --- | --- | --- |',
    `| AS-001 | 当前报告基于用户已回答内容和原始输入，不额外补造事实。 | 保证报告可追溯。 | 未确认内容保留为待确认。 |`,
    `| AS-002 | “${slots.target_user ?? '目标对象'}”是当前版本的主要讨论对象。 | 影响范围、场景和完成标准。 | 若对象变化，需要生成新版本。 |`,
    `| AS-003 | 当前完成标准“${slots.completion_criteria ?? '待确认'}”只作为初步整理口径。 | 不能直接等同正式验收。 | 正式项目中需重新确认责任人和证据。 |`,
    `| AS-004 | 当前约束“${slots.constraints_risks ?? '待确认'}”可能影响成本、周期或风险。 | 影响方案选择。 | 在进入执行前再次复核。 |`,
  ].join('\n');
}

function buildOptionTable(demoCase: QuickDemoCase): string {
  const options = demoCase.options.length > 0 ? demoCase.options : [];
  if (options.length === 0) {
    return '暂未形成方案比较。建议继续澄清范围、完成标准和关键风险后再生成方案。';
  }

  return [
    '| 方案 | 建议 | 说明 | 优势 | 代价 / 风险 | 工作量 | 可调整性 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...options.map((option) =>
      [
        option.title,
        option.is_recommended ? '推荐' : '备选',
        option.description,
        option.pros.join('、') || '待补充',
        option.cons.join('、') || '待补充',
        effortLabel(option.effort),
        option.reversible ? '较容易调整' : '调整成本较高',
      ].join(' | '),
    ).map((row) => `| ${row} |`),
  ].join('\n');
}

function buildRiskTable(demoCase: QuickDemoCase): string {
  const slots = demoCase.finalUnderstanding.slots;
  const rows = [
    {
      level: '约束',
      item: slots.constraints_risks ?? '待确认',
      impact: '影响方案可行性、成本、排期或交付承诺。',
      owner: '需求方 / 执行方',
    },
    ...demoCase.unknowns.map((item) => ({
      level: item.is_blocking ? '需先确认' : '可稍后确认',
      item: item.question,
      impact: item.impact,
      owner: item.suggested_owner ?? '需求方',
    })),
  ].filter((row) => row.item && row.item !== '待确认');

  if (rows.length === 0) {
    return '当前没有记录到明确风险，但正式推进前仍应补充责任人、验收方式和变更规则。';
  }

  return [
    '| 类型 | 事项 | 影响 | 建议确认人 |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.level} | ${row.item} | ${row.impact} | ${row.owner} |`),
  ].join('\n');
}

function formatUpdateMarks(marks: string[]): string {
  if (marks.length === 0) return '对话记录';
  return marks
    .map((mark) => {
      const [rawField, ...rest] = mark.split('=');
      const value = rest.join('=').trim();
      return `${slotLabel(rawField.trim())}${value ? `：${value}` : ''}`;
    })
    .join('；');
}

function slotLabel(field: string): string {
  const labels: Record<string, string> = {
    expected_outcome: '期望结果',
    target_user: '目标用户',
    core_scenario: '核心场景',
    scope_boundary: '范围说明',
    completion_criteria: '完成标准',
    constraints_risks: '风险与约束',
  };
  return labels[field] ?? field;
}

function extractInScope(scope?: string): string {
  if (!scope) return '待确认';
  const markers = ['不做', '不包含', '暂不', '无需', '不需要'];
  const parts = scope
    .split(/[；;，,。]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const inScope = parts.filter((part) => !markers.some((marker) => part.includes(marker)));
  return inScope.length > 0 ? inScope.join('；') : scope;
}

function extractOutOfScope(scope?: string): string {
  if (!scope) return '待确认';
  const markers = ['不做', '不包含', '暂不', '无需', '不需要'];
  const parts = scope
    .split(/[；;，,。]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const outOfScope = parts.filter((part) => markers.some((marker) => part.includes(marker)));
  return outOfScope.length > 0 ? outOfScope.join('；') : '尚未单独列出，需要在正式项目中继续确认。';
}

function effortLabel(effort: QuickDemoCase['options'][number]['effort']): string {
  if (effort === 'low') return '低';
  if (effort === 'high') return '高';
  return '中';
}

export function buildQuickDemoFixture(
  sourceCaseId?: string | null,
  understandingOverride?: {
    summary?: string;
    slots?: QuickDemoCase['finalUnderstanding']['slots'];
  } | null,
  optionsOverride?: QuickDemoCase['options'],
) {
  const originalCase = getQuickDemoCase(sourceCaseId) ?? QUICK_DEMO_CASES[0];
  const baseCase: QuickDemoCase = optionsOverride
    ? { ...originalCase, options: optionsOverride }
    : originalCase;
  const demoCase: QuickDemoCase = understandingOverride
    ? {
        ...baseCase,
        finalUnderstanding: {
          summary: understandingOverride.summary || baseCase.finalUnderstanding.summary,
          slots: {
            ...baseCase.finalUnderstanding.slots,
            ...(understandingOverride.slots ?? {}),
          },
        },
      }
    : baseCase;
  const coverageSlots = [
    { name: 'expected_outcome', label: '期望成果', state: 'covered', is_blocking: true },
    { name: 'target_user', label: '目标用户', state: 'covered', is_blocking: true },
    { name: 'core_scenario', label: '核心场景', state: 'covered', is_blocking: true },
    { name: 'scope_boundary', label: '范围说明', state: 'partial', is_blocking: true },
    { name: 'completion_criteria', label: '完成标准', state: 'partial', is_blocking: true },
    { name: 'constraints_risks', label: '风险与约束', state: 'partial', is_blocking: true },
  ];
  const generatedAt = '2026-07-02T09:05:00+08:00';
  const summary = demoCase.finalUnderstanding.summary;
  const slots = demoCase.finalUnderstanding.slots;
  const recommendedOption = demoCase.options[0]?.description ?? '继续澄清后再选择方案。';
  const blockingUnknowns = demoCase.unknowns.filter((item) => item.is_blocking);
  const nonBlockingUnknowns = demoCase.unknowns.filter((item) => !item.is_blocking);
  const simpleSections = [
    { title: '现在可以这样理解', content: summary },
    {
      title: '目前已经说清楚',
      content: [
        `主要给谁用：${slots.target_user ?? '还没确定'}`,
        `在什么情况下用：${slots.core_scenario ?? '还没确定'}`,
        `这次先做到哪里：${slots.scope_boundary ?? '还没确定'}`,
        `怎样算做好：${slots.completion_criteria ?? '还没确定'}`,
      ].join('；'),
    },
    {
      title: '建议先这样推进',
      content: recommendedOption,
    },
    {
      title: '还没完全确定的事',
      content:
        blockingUnknowns.length > 0
          ? blockingUnknowns.map((item) => item.question).join('；')
          : '目前没有必须先确认的问题。',
    },
  ];
  const detailSections = buildDetailedReportSections(demoCase);
  const detailReportContent = sectionListToMarkdown(`${demoCase.title}需求分析详细报告`, detailSections);
  return {
    case_id: demoCase.sourceCaseId,
    title: demoCase.title,
    original_input: demoCase.originalInput,
    template: demoCase.template,
    messages: buildQuickDemoTurns(demoCase),
    understanding: {
      case_id: demoCase.sourceCaseId,
      session_id: `${demoCase.sourceCaseId}_session`,
      version: 1,
      summary,
      slots: demoCase.finalUnderstanding.slots,
      coverage_slots: coverageSlots,
      updated_at: generatedAt,
    },
    coverage: coverageSlots,
    review: demoCase.review,
    unknowns: demoCase.unknowns,
    supplement: demoCase.supplement,
    options: demoCase.options,
    brief_versions: [
      {
        version: 1,
        session_id: `${demoCase.sourceCaseId}_session`,
        generated_at: generatedAt,
        is_incomplete: demoCase.unknowns.some((item) => item.is_blocking),
        blocking_unknowns_count: demoCase.unknowns.filter((item) => item.is_blocking).length,
        non_blocking_unknowns_count: demoCase.unknowns.filter((item) => !item.is_blocking).length,
      },
    ],
    brief_views: {
      simple: {
        view_type: 'simple',
        brief_version: 1,
        content: `# ${demoCase.title}\n\n${summary}`,
        sections: simpleSections,
      },
      exec: {
        view_type: 'exec',
        brief_version: 1,
        content: detailReportContent,
        sections: detailSections,
      },
    },
  };
}
