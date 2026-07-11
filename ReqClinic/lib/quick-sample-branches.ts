import { getQuickDemoCase } from '@/lib/quick-demo-cases';

export interface QuickSampleBranchOption {
  id: string;
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  effort: 'low' | 'medium' | 'high';
  reversible: boolean;
  is_recommended: boolean;
}

export interface QuickSampleBranchChoice {
  id: string;
  title: string;
  routeLabel: string;
  answer: string;
  matchers: RegExp[];
  nextQuestion: string;
  nextAnswer: string;
  updateMarks: string[];
  summary: string;
  option: Omit<QuickSampleBranchOption, 'is_recommended'>;
}

export interface QuickSampleBranchScenario {
  caseId: string;
  prompt: string;
  choices: [QuickSampleBranchChoice, QuickSampleBranchChoice];
}

const QUICK_SAMPLE_BRANCH_SCENARIOS: Record<string, QuickSampleBranchScenario> = {
  'ai-poster-website': {
    caseId: 'ai-poster-website',
    prompt: '先确定海报的交付形态，这会改变后续生成与发布流程。',
    choices: [
      {
        id: 'poster_web_page',
        title: '生成可访问网页',
        routeLabel: '网页海报',
        answer: '希望生成可以在线访问的网页，手机扫码就能看，不需要先下载图片。',
        matchers: [/网页|在线访问|扫码|链接|h5/i],
        nextQuestion: '网页海报主要给团队宣传岗批量使用，还是给个人创作者自助生成？',
        nextAnswer: '主要给团队宣传岗使用，个人创作者可以作为后续用户。',
        updateMarks: [
          'expected_outcome=生成可在线访问、适配手机扫码查看的网页海报',
          'core_scenario=输入一句话后生成网页链接并在手机端打开',
        ],
        summary: '先做面向团队宣传岗的网页海报生成，核心是快速生成、在线访问和移动端展示。',
        option: {
          id: 'poster_option_web',
          title: '网页海报生成',
          description: '一句话生成可访问网页，优先保证移动端展示和分享链路。',
          pros: ['分享路径短', '可承载交互与动态内容'],
          cons: ['需要托管与访问稳定性'],
          effort: 'medium',
          reversible: true,
        },
      },
      {
        id: 'poster_download_image',
        title: '生成可下载图片',
        routeLabel: '图片海报',
        answer: '希望直接生成可以下载的图片，方便发朋友圈和社交平台，暂时不需要网页链接。',
        matchers: [/图片|下载|朋友圈|社交平台|png|jpg/i],
        nextQuestion: '图片首版只做一个通用尺寸，还是需要同时导出多个常用渠道尺寸？',
        nextAnswer: '首版先支持一个通用竖版和一个方形尺寸，不做复杂排版编辑器。',
        updateMarks: [
          'expected_outcome=生成可下载并用于社交平台发布的图片海报',
          'core_scenario=输入一句话后生成图片并下载发布',
        ],
        summary: '先做社交发布用的图片海报生成，核心是常用尺寸导出和稳定下载，不承担网页托管。',
        option: {
          id: 'poster_option_image',
          title: '图片海报导出',
          description: '生成常用尺寸图片并下载发布，首版不建设网页托管链路。',
          pros: ['用户习惯成熟', '发布渠道兼容性高'],
          cons: ['缺少网页交互能力'],
          effort: 'low',
          reversible: true,
        },
      },
    ],
  },
  'campus-marketplace': {
    caseId: 'campus-marketplace',
    prompt: '先决定平台是否承担交易闭环，范围会完全不同。',
    choices: [
      {
        id: 'marketplace_information',
        title: '先做发布与联系',
        routeLabel: '信息平台',
        answer: '第一版先做校内发布、搜索和联系，不直接做支付与担保交易。',
        matchers: [/发布|搜索|联系|信息平台|不.*支付|线下/],
        nextQuestion: '首批只允许本校学生使用，还是允许周边学校一起加入？',
        nextAnswer: '先只允许本校学生，用校园邮箱或学号完成身份确认。',
        updateMarks: [
          'expected_outcome=校内闲置信息发布、搜索与联系',
          'scope_boundary=首版不做支付、物流、担保交易和纠纷仲裁',
        ],
        summary: '首版定位为校内闲置信息平台，用身份确认、举报和下架控制风险，不承担交易履约。',
        option: {
          id: 'marketplace_option_information',
          title: '校内信息撮合',
          description: '平台负责发布、搜索、联系和举报，交易在线下完成。',
          pros: ['首版范围可控', '上线速度快'],
          cons: ['交易状态和纠纷难以闭环'],
          effort: 'low',
          reversible: true,
        },
      },
      {
        id: 'marketplace_transaction',
        title: '覆盖担保交易',
        routeLabel: '交易平台',
        answer: '希望平台内完成下单和担保支付，校内交接确认后再把款项给卖家。',
        matchers: [/支付|下单|担保|款项|订单|交易闭环/],
        nextQuestion: '发生货不对板或未交付时，平台负责仲裁，还是只冻结订单并提供举证记录？',
        nextAnswer: '首版先冻结争议订单并保留聊天和交接记录，由管理员线下处理，不承诺复杂仲裁。',
        updateMarks: [
          'expected_outcome=校内二手商品担保交易闭环',
          'constraints_risks=需要处理支付合规、争议冻结、退款和管理员责任',
        ],
        summary: '首版尝试校内担保交易，需要把支付、争议冻结、退款和管理员责任作为核心范围。',
        option: {
          id: 'marketplace_option_transaction',
          title: '校内担保交易',
          description: '平台内完成下单、担保支付和交接确认，并保留争议证据。',
          pros: ['交易闭环完整', '可沉淀履约数据'],
          cons: ['合规与纠纷处理成本明显增加'],
          effort: 'high',
          reversible: false,
        },
      },
    ],
  },
  'aigc-education-paper': {
    caseId: 'aigc-education-paper',
    prompt: '先确定从课程规则还是研究问题切入。',
    choices: [
      {
        id: 'paper_course_rules',
        title: '先满足课程规则',
        routeLabel: '作业规范',
        answer: '先按课程要求收敛，论文约 3000 字、两周后提交，必须有明确问题和文献引用。',
        matchers: [/课程|作业|3000|字数|两周|提交|引用|格式/],
        nextQuestion: '在课程允许的范围里，你准备聚焦哪个教育阶段或写作场景？',
        nextAnswer: '聚焦高校学生写作，不讨论所有教育阶段。',
        updateMarks: [
          'completion_criteria=两周内完成约3000字、有明确问题和文献引用的课程论文',
          'scope_boundary=选题必须适配课程字数和证据要求',
        ],
        summary: '先按课程规则确定字数、截止时间和证据要求，再把主题收窄到高校写作场景。',
        option: {
          id: 'paper_option_rules',
          title: '课程规范优先',
          description: '先锁定作业规则和可用材料，再形成能在期限内完成的研究问题。',
          pros: ['交付风险低', '结构更容易验收'],
          cons: ['研究探索空间较小'],
          effort: 'low',
          reversible: true,
        },
      },
      {
        id: 'paper_research_question',
        title: '先打磨研究问题',
        routeLabel: '问题意识',
        answer: '老师更看重问题意识，我想先把生成式智能对教育的影响收敛成一个有争议、能论证的问题。',
        matchers: [/研究问题|问题意识|论证|争议|原创|公平|教育影响/],
        nextQuestion: '你更想讨论学习效率、内容原创性，还是教师评价公平？',
        nextAnswer: '先讨论它提高写作效率，但也冲击原创性和评价公平。',
        updateMarks: [
          'expected_outcome=形成围绕原创性与评价公平的可论证研究问题',
          'scope_boundary=聚焦高校写作与教师评价场景',
        ],
        summary: '先从原创性与评价公平形成研究问题，再反向补齐课程规则和证据范围。',
        option: {
          id: 'paper_option_question',
          title: '研究问题优先',
          description: '先形成有争议的论证主线，再筛选课程允许的证据与结构。',
          pros: ['问题意识更强', '论证主线更鲜明'],
          cons: ['后续可能受字数和材料限制'],
          effort: 'medium',
          reversible: true,
        },
      },
    ],
  },
  'gym-renewal-service': {
    caseId: 'gym-renewal-service',
    prompt: '先确认本轮更重视业务结果还是员工流程。',
    choices: [
      {
        id: 'gym_renewal_rate',
        title: '先提高续费率',
        routeLabel: '续费结果',
        answer: '核心先看续费率，员工跟进效率是支持指标。',
        matchers: [/续费率|续费结果|转化|收入|业务结果/],
        nextQuestion: '目前续费流失主要发生在提醒、顾问跟进，还是会员体验阶段？',
        nextAnswer: '主要是到期前没有有效提醒，顾问跟进也不稳定。',
        updateMarks: [
          'expected_outcome=提高到期会员续费率',
          'completion_criteria=用续费率和漏跟进数量共同判断改善',
        ],
        summary: '以续费率为主目标，先定位到期提醒和顾问跟进中的关键流失点。',
        option: {
          id: 'gym_option_conversion',
          title: '续费转化优先',
          description: '围绕到期会员建立提醒、回访和转化追踪。',
          pros: ['直接连接业务结果', '便于设定试运行指标'],
          cons: ['员工流程问题可能只得到局部改善'],
          effort: 'medium',
          reversible: true,
        },
      },
      {
        id: 'gym_followup_process',
        title: '先减少漏跟进',
        routeLabel: '流程治理',
        answer: '先解决顾问漏跟进、重复沟通和店长无法复盘的问题，再观察续费率变化。',
        matchers: [/漏跟进|重复沟通|复盘|员工效率|流程|记录/],
        nextQuestion: '第一版最需要先减少漏跟进、重复沟通，还是无法追踪责任？',
        nextAnswer: '先减少漏跟进，并让店长看到每位顾问的回访状态。',
        updateMarks: [
          'expected_outcome=减少续费服务中的漏跟进并提高流程透明度',
          'core_scenario=顾问记录回访状态、教练补充反馈、店长查看进度',
        ],
        summary: '先治理顾问回访流程和记录透明度，再用续费率验证流程改造是否有效。',
        option: {
          id: 'gym_option_process',
          title: '跟进流程优先',
          description: '先统一提醒、回访记录和责任状态，再评估续费结果。',
          pros: ['责任链清晰', '便于发现流程断点'],
          cons: ['业务结果改善需要更长观察期'],
          effort: 'low',
          reversible: true,
        },
      },
    ],
  },
  'corporate-website-outsourcing': {
    caseId: 'corporate-website-outsourcing',
    prompt: '先确定官网最优先承担的业务任务。',
    choices: [
      {
        id: 'website_leads',
        title: '先跑通获客线索',
        routeLabel: '线索转化',
        answer: '首版优先跑通获客线索，品牌展示先满足可信表达。',
        matchers: [/获客|线索|表单|销售|咨询|转化/],
        nextQuestion: '线索提交后，首版只通知负责人，还是直接进入现有客户系统？',
        nextAnswer: '首版先入库并通知销售负责人，不做复杂客户系统集成。',
        updateMarks: [
          'expected_outcome=官网稳定收集有效咨询线索',
          'core_scenario=访客了解服务后提交表单并通知销售跟进',
        ],
        summary: '首版以线索闭环为核心，优先保证表单、通知和跟进责任，品牌内容满足可信展示。',
        option: {
          id: 'website_option_leads',
          title: '线索闭环首版',
          description: '先完成服务展示、咨询表单、入库和负责人通知。',
          pros: ['业务价值容易验证', '首版范围可控'],
          cons: ['品牌内容深度有限'],
          effort: 'medium',
          reversible: true,
        },
      },
      {
        id: 'website_brand',
        title: '先建立品牌可信度',
        routeLabel: '品牌内容',
        answer: '首版优先建立品牌与案例可信度，线索表单保持简单即可。',
        matchers: [/品牌|案例|可信|内容|形象|专业/],
        nextQuestion: '首版最需要先完成产品能力、客户案例，还是公司与团队内容？',
        nextAnswer: '先完成产品能力和三个代表案例，公司介绍保持精简。',
        updateMarks: [
          'expected_outcome=通过产品与案例内容建立品牌可信度',
          'core_scenario=访客快速理解能力并通过代表案例建立信任',
        ],
        summary: '首版以产品能力和代表案例建立可信度，线索表单只保留基础联系能力。',
        option: {
          id: 'website_option_brand',
          title: '品牌内容首版',
          description: '优先打磨产品能力、代表案例和品牌一致性。',
          pros: ['品牌表达完整', '适合高客单决策'],
          cons: ['内容准备和审稿成本较高'],
          effort: 'medium',
          reversible: true,
        },
      },
    ],
  },
  'ai-interview-assistant-capstone': {
    caseId: 'ai-interview-assistant-capstone',
    prompt: '先决定答辩最优先证明稳定闭环还是创新能力。',
    choices: [
      {
        id: 'capstone_stability',
        title: '先保证演示稳定',
        routeLabel: '稳定闭环',
        answer: '首版优先保证答辩现场能稳定跑通模拟面试和评分反馈。',
        matchers: [/稳定|跑通|演示闭环|可运行|接口异常|兜底/],
        nextQuestion: '模型接口异常时，演示切换本地预置结果，还是准备备用模型？',
        nextAnswer: '先准备本地预置结果兜底，保证页面流程和答辩说明不中断。',
        updateMarks: [
          'expected_outcome=答辩现场稳定跑通模拟面试到评分反馈',
          'constraints_risks=模型异常时使用本地预置结果继续演示',
        ],
        summary: '首版以稳定演示闭环为主，模型异常时有本地兜底，并清楚说明真实调用边界。',
        option: {
          id: 'capstone_option_stability',
          title: '稳定答辩版本',
          description: '固定主案例并准备本地兜底，保证完整流程可演示。',
          pros: ['答辩风险低', '工程完整度容易展示'],
          cons: ['现场生成的创新感较弱'],
          effort: 'medium',
          reversible: true,
        },
      },
      {
        id: 'capstone_innovation',
        title: '先展示智能差异',
        routeLabel: '创新展示',
        answer: '首版优先让评委看到不同回答会产生不同追问和评分证据。',
        matchers: [/创新|不同追问|评分证据|解释|智能差异|现场输入/],
        nextQuestion: '创新展示更偏向动态追问，还是偏向可解释评分？',
        nextAnswer: '先展示动态追问，同时保留回答证据说明为什么这样追问。',
        updateMarks: [
          'expected_outcome=现场展示回答变化如何影响追问与反馈',
          'core_scenario=输入不同回答并对比生成的追问与证据解释',
        ],
        summary: '首版以动态追问和证据解释展示创新，同时为不可预测输入准备失败说明。',
        option: {
          id: 'capstone_option_innovation',
          title: '动态智能演示',
          description: '允许现场输入并展示不同回答产生的追问和证据解释。',
          pros: ['创新点直观', '互动性强'],
          cons: ['现场不确定性更高'],
          effort: 'high',
          reversible: true,
        },
      },
    ],
  },
  'social-anxiety-coach': {
    caseId: 'social-anxiety-coach',
    prompt: '先选择最值得验证的具体练习时刻。',
    choices: [
      {
        id: 'coach_structured_scenes',
        title: '面试与汇报练习',
        routeLabel: '明确场景',
        answer: '先做面试和汇报这类目标明确、能复盘的沟通练习。',
        matchers: [/面试|汇报|答辩|演讲|明确场景/],
        nextQuestion: '第一批主要面向学生，还是刚进入职场的新人？',
        nextAnswer: '先面向学生和职场新人，不进入医疗或心理治疗方向。',
        updateMarks: [
          'core_scenario=面试和汇报前的结构化沟通练习',
          'target_user=学生与职场新人',
        ],
        summary: '先验证面试与汇报中的结构化陪练，目标用户是学生和职场新人。',
        option: {
          id: 'coach_option_structured',
          title: '结构化场景陪练',
          description: '围绕面试与汇报提供可复盘的练习和反馈。',
          pros: ['目标明确', '效果更容易比较'],
          cons: ['覆盖的日常沟通较少'],
          effort: 'medium',
          reversible: true,
        },
      },
      {
        id: 'coach_daily_conversation',
        title: '日常破冰与回复',
        routeLabel: '日常沟通',
        answer: '先做破冰聊天和日常消息回复，帮助用户降低不知道怎么开口的压力。',
        matchers: [/破冰|聊天|日常|消息|回复|开口/],
        nextQuestion: '第一批更适合从校园社交，还是职场同事沟通切入？',
        nextAnswer: '先从校园社交切入，场景更集中，也便于招募首批体验者。',
        updateMarks: [
          'core_scenario=校园社交中的破冰聊天与消息回复练习',
          'target_user=有日常沟通压力的学生',
        ],
        summary: '先验证校园社交中的破冰与消息回复陪练，不延伸到心理诊断或治疗。',
        option: {
          id: 'coach_option_daily',
          title: '日常沟通陪练',
          description: '围绕校园破冰和消息回复提供低压力练习。',
          pros: ['使用频率高', '更贴近日常困难'],
          cons: ['效果标准较难量化'],
          effort: 'medium',
          reversible: true,
        },
      },
    ],
  },
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function matcherHitCount(matcher: RegExp, value: string): number {
  const flags = matcher.flags.includes('g') ? matcher.flags : `${matcher.flags}g`;
  return value.match(new RegExp(matcher.source, flags))?.length ?? 0;
}

export function getQuickSampleBranchScenario(sourceCaseId?: string | null): QuickSampleBranchScenario | null {
  if (!sourceCaseId) return null;
  return QUICK_SAMPLE_BRANCH_SCENARIOS[sourceCaseId] ?? null;
}

export function getQuickSampleBranchChoice(
  sourceCaseId?: string | null,
  choiceId?: string | null,
): QuickSampleBranchChoice | null {
  const scenario = getQuickSampleBranchScenario(sourceCaseId);
  if (!scenario || !choiceId) return null;
  return scenario.choices.find((choice) => choice.id === choiceId) ?? null;
}

export function resolveQuickSampleBranch(
  sourceCaseId: string | null | undefined,
  answer: string,
): QuickSampleBranchChoice | null {
  const scenario = getQuickSampleBranchScenario(sourceCaseId);
  if (!scenario) return null;
  const normalizedAnswer = normalize(answer);
  const ranked = scenario.choices
    .map((choice, index) => ({
      choice,
      index,
      score:
        (normalize(choice.answer) === normalizedAnswer ? 10 : 0) +
        choice.matchers.reduce((total, matcher) => total + matcherHitCount(matcher, answer), 0) * 3,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.choice ?? scenario.choices[0];
}

export function getQuickSampleSuggestedAnswer(
  sourceCaseId: string | null | undefined,
  answerIndex: number,
  priorAnswers: string[],
): string | undefined {
  const scenario = getQuickSampleBranchScenario(sourceCaseId);
  if (!scenario) return getQuickDemoCase(sourceCaseId)?.steps[answerIndex]?.answer;
  if (answerIndex === 0) return scenario.choices[0].answer;
  const route = resolveQuickSampleBranch(sourceCaseId, priorAnswers[0] ?? '');
  if (answerIndex === 1 && route) return route.nextAnswer;
  return getQuickDemoCase(sourceCaseId)?.steps[answerIndex]?.answer;
}

export function getQuickSampleRouteOptions(
  sourceCaseId: string | null | undefined,
  selectedChoiceId?: string | null,
): QuickSampleBranchOption[] {
  const scenario = getQuickSampleBranchScenario(sourceCaseId);
  if (!scenario) return [];
  const selectedId = selectedChoiceId ?? scenario.choices[0].id;
  return scenario.choices.map((choice) => ({
    ...choice.option,
    is_recommended: choice.id === selectedId,
  }));
}
