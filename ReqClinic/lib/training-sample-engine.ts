import type {
  TrainingCase,
  TrainingFeedback,
  TrainingFeedbackImprovementExample,
} from '@/lib/api/types';

type VisibleDimension = '目标' | '对象' | '边界' | '验收';
type CoverageStrength = 'covered' | 'partial' | 'missing';

interface TrainingSampleDimension {
  id: string;
  label: string;
  visibleDimension: VisibleDimension;
  question: string;
  answer: string;
  patterns: RegExp[];
  comment: string;
}

interface TrainingSampleScenario {
  focus: string;
  dimensions: TrainingSampleDimension[];
  suggestions: string[];
  examples: TrainingFeedbackImprovementExample[];
}

export interface TrainingSampleProfile {
  focus: string;
  questions: string[];
}

export interface TrainingSampleTurn {
  answer: string;
  nextHint: string;
  dimensionId: string | null;
  dimensionLabel: string | null;
  strength: CoverageStrength;
  repeated: boolean;
  coveredCount: number;
  totalDimensions: number;
}

interface QuestionAssessment {
  question: string;
  dimensionId: string | null;
  strength: CoverageStrength;
  repeated: boolean;
}

const GENERIC_PATTERNS: Record<VisibleDimension, RegExp[]> = {
  目标: [/目标|目的|价值|问题|为什么|优先|最想|希望|改善|提升/],
  对象: [/谁|用户|对象|角色|受众|负责人|确认人|审批|使用者|协作/],
  边界: [/范围|边界|第一版|首版|不做|限制|风险|异常|场景|流程|依赖|数据|预算|时间/],
  验收: [/验收|标准|指标|多少|多久|完成|判断|结果|上线|成功|效果|质量/],
};

const TRAINING_SAMPLE_SCENARIOS: Record<string, TrainingSampleScenario> = {
  需求访谈: {
    focus: '访谈目标、现场角色、关键场景、异常处理和验收口径',
    dimensions: [
      {
        id: 'interview_goal',
        label: '访谈目标',
        visibleDimension: '目标',
        question: '这套访客系统最想先解决门岗现场的哪个问题？',
        answer: '我最关心高峰时段访客排队和异常来访处理，不能只看登记是否方便。',
        patterns: [/最关心|先解决|门岗问题|访客系统.*问题/, /排队|安全|效率|通行/],
        comment: '先把安全、效率或登记便利中的优先级问清楚。',
      },
      {
        id: 'interview_roles',
        label: '现场角色',
        visibleDimension: '对象',
        question: '谁会实际使用系统，安保、前台、访客和运营分别要做什么？',
        answer: '主要使用的是门岗安保，前台会发起部分预约，运营要看记录和统计；预算或例外审批由园区运营负责人确认。',
        patterns: [/安保|前台|访客|运营/, /谁.*使用|谁.*确认|负责人|审批|采购|角色/],
        comment: '访客通行涉及现场操作、预约发起和事后管理三类责任。',
      },
      {
        id: 'interview_exception',
        label: '异常场景',
        visibleDimension: '边界',
        question: '访客到现场但预约信息异常时，现在希望怎么处理？',
        answer: '最常见的是忘带证件、预约信息不一致和临时来访。门岗需要先核验身份，再由有权限的人决定补录、重发凭证或拒绝放行。',
        patterns: [/忘带|证件|预约.*不一致|临时来访/, /异常|核验|放行|补录|凭证|怎么处理/],
        comment: '异常处置决定现场速度、权限边界和追责记录。',
      },
      {
        id: 'interview_acceptance',
        label: '现场验收',
        visibleDimension: '验收',
        question: '第一版上线后，用什么现场结果判断它确实更安全或更高效？',
        answer: '如果高峰核验更快、异常处理有记录、事后能还原责任链，并且没有出现误放和大面积误拦，我们就认为第一版有价值。',
        patterns: [/误放|误拦|处理时长|核验速度|责任链/, /怎么判断|什么结果|验收|标准|更安全|更高效/],
        comment: '验收应落到速度、误放误拦和可追溯性。',
      },
    ],
    suggestions: [
      '继续追问高峰时段、异常来访和安保核验动作。',
      '把“更安全”拆成误放、误拦、处理时长和可追溯记录。',
    ],
    examples: [
      {
        before: '访客系统要怎么做？',
        after: '访客到门岗但预约信息异常时，安保先看到什么、能做哪些处理？',
        reason: '把泛泛功能追问改成现场异常场景。',
      },
      {
        before: '要不要提高效率？',
        after: '高峰时段一名安保每分钟需要核验多少访客，超过多久算不可接受？',
        reason: '把效率诉求改成可判断标准。',
      },
    ],
  },
  范围边界: {
    focus: '首版范围、交易路径、不做事项、平台责任和验收标准',
    dimensions: [
      {
        id: 'scope_goal',
        label: '首版目标',
        visibleDimension: '目标',
        question: '第一版到底只做信息发布和联系，还是要覆盖支付、物流和担保交易？',
        answer: '第一版先解决校内同学发布和联系，不承担完整交易平台责任。',
        patterns: [/第一版|首版|先解决/, /发布|联系|交易平台|支付|物流|担保/],
        comment: '先确认产品是信息平台还是交易平台。',
      },
      {
        id: 'scope_path',
        label: '对象与交易路径',
        visibleDimension: '对象',
        question: '买家看到商品后，下一步是在平台内沟通，还是跳转到微信或线下交易？',
        answer: '买卖双方主要通过平台看到信息，后续沟通可以先跳到微信或线下，管理员只处理发布和举报。',
        patterns: [/买家|卖家|管理员|买卖双方/, /沟通|微信|线下|交易路径|下一步/],
        comment: '真实交易路径决定平台角色和必要功能。',
      },
      {
        id: 'scope_boundary',
        label: '范围边界',
        visibleDimension: '边界',
        question: '哪些事情明确不做，比如支付、物流、担保、纠纷仲裁或实名认证？',
        answer: '支付、物流、担保交易和纠纷仲裁暂时不做，首版只保留校内身份、举报和违规下架。',
        patterns: [/不做|不包含|暂时不|排除/, /支付|物流|担保|仲裁|实名|举报|下架/],
        comment: '不做项决定平台责任不会无限扩大。',
      },
      {
        id: 'scope_acceptance',
        label: '可用标准',
        visibleDimension: '验收',
        question: '首版上线后，用什么标准判断这个小程序已经可用？',
        answer: '能稳定发布、分类搜索、联系和举报，管理员可以处理违规信息，就算首版可用。',
        patterns: [/稳定发布|分类搜索|联系|举报|违规信息/, /可用|上线后|验收|判断|标准/],
        comment: '范围边界最终要落到可验证的首版闭环。',
      },
    ],
    suggestions: [
      '继续追问首版是否承担支付、担保和纠纷责任。',
      '把“更安全”改成身份、举报、黑名单或线下交易提醒。',
    ],
    examples: [
      {
        before: '交易要安全吗？',
        after: '第一版只负责发布和联系时，支付、物流、担保和纠纷处理哪些明确不做？',
        reason: '先划清平台责任。',
      },
      {
        before: '有哪些功能？',
        after: '买家看到商品后，是在平台内沟通，还是转到微信或线下？',
        reason: '用真实路径倒推必要功能。',
      },
    ],
  },
  创意简报: {
    focus: '目标受众、渠道规格、核心信息、素材和审核边界',
    dimensions: [
      {
        id: 'creative_goal',
        label: '投放目标',
        visibleDimension: '目标',
        question: '这次海报最核心的投放目标是什么，拉新、转化还是品牌印象？',
        answer: '这组海报用于双十一前拉新转化，需要突出首单优惠和套装折扣。',
        patterns: [/投放目标|拉新|转化|品牌印象/, /双十一|首单|优惠|折扣|核心信息/],
        comment: '创意优先级必须连接业务目标。',
      },
      {
        id: 'creative_audience',
        label: '目标受众',
        visibleDimension: '对象',
        question: '目标受众具体是哪类人，她们最在意的卖点是什么？',
        answer: '主要面向 20 到 28 岁的一二线城市女性，她们更在意成分安全、价格和上脸效果。',
        patterns: [/受众|人群|年龄|女性|用户/, /卖点|在意|购买动机|成分|价格|效果/],
        comment: '受众和购买动机决定画面信息层级。',
      },
      {
        id: 'creative_channels',
        label: '渠道与规格边界',
        visibleDimension: '边界',
        question: '投放渠道和尺寸版本有哪些硬性要求？',
        answer: '需要小红书封面、朋友圈长图和门店立牌三个版本，尺寸和信息密度分别适配。',
        patterns: [/小红书|朋友圈|门店|立牌/, /渠道|尺寸|规格|版本|素材/],
        comment: '渠道规格直接决定交付物和排版边界。',
      },
      {
        id: 'creative_review',
        label: '审核与验收',
        visibleDimension: '验收',
        question: '有哪些功效表达、素材或风格是必须避开的？',
        answer: '不能使用医疗功效词、永久效果暗示和未授权明星图；最终要通过品牌与法务审核。',
        patterns: [/医疗功效|永久效果|明星|授权|禁用词/, /审核|法务|避开|不能使用|合规|验收/],
        comment: '审核红线也是创意交付的完成标准。',
      },
    ],
    suggestions: [
      '继续追问渠道、尺寸、卖点和禁用表达。',
      '把“高级感”改成可执行的素材与信息优先级。',
    ],
    examples: [
      {
        before: '想做什么风格？',
        after: '海报投放在哪里，必须避开哪些功效、人物或素材表达？',
        reason: '从泛泛风格转成渠道和审核边界。',
      },
      {
        before: '要突出转化吗？',
        after: '用户几秒内必须看到首单优惠、套装折扣还是成分安全？',
        reason: '把转化目标改成画面优先级。',
      },
    ],
  },
  学术任务: {
    focus: '任务要求、评分标准、研究问题、证据范围和结构计划',
    dimensions: [
      {
        id: 'academic_goal',
        label: '课程目标',
        visibleDimension: '目标',
        question: '课程对字数、格式、截止时间和引用数量有什么要求？',
        answer: '课程要求约 4000 字、至少 8 篇参考文献，下周五提交，重点看问题是否清晰和引用是否规范。',
        patterns: [/课程要求|作业要求|字数|截止|引用数量/, /格式|规范|老师要求|评分/],
        comment: '先确认任务规则，才能判断选题是否可完成。',
      },
      {
        id: 'academic_subject',
        label: '研究对象',
        visibleDimension: '对象',
        question: '你准备聚焦哪个教育阶段或具体场景？',
        answer: '我想聚焦大学课堂中的学生写作和教师反馈，不讨论所有教育阶段。',
        patterns: [/教育阶段|大学|高校|课堂|学生|教师/, /研究对象|聚焦谁|具体场景/],
        comment: '研究对象越清楚，证据选择越可靠。',
      },
      {
        id: 'academic_scope',
        label: '研究边界',
        visibleDimension: '边界',
        question: '这篇论文最想回答的研究问题是什么？',
        answer: '我想回答生成式智能如何改变大学课堂中的学生写作反馈和教师评价方式。',
        patterns: [/研究问题|最想回答|论点|主题/, /生成式|写作反馈|教师评价|教育影响/],
        comment: '把大主题收敛成字数内可回答的问题。',
      },
      {
        id: 'academic_evidence',
        label: '评分与证据标准',
        visibleDimension: '验收',
        question: '老师是否允许英文文献、政策案例或实证数据？',
        answer: '允许英文文献，也可以引用政策文件和课堂案例；最终按论点、结构、证据和引用规范评分。',
        patterns: [/英文文献|政策|案例|实证|数据来源/, /证据|评分标准|引用规范|怎样算好/],
        comment: '证据范围和评分规则共同决定完成标准。',
      },
    ],
    suggestions: [
      '继续追问课程规则、评分标准和允许的证据来源。',
      '把大主题收窄成一个能在规定字数内回答的问题。',
    ],
    examples: [
      {
        before: '你想写什么方向？',
        after: '课程要求多少字、几篇文献，老师更看重观点还是规范？',
        reason: '先确认任务规则。',
      },
      {
        before: 'AI 对教育有什么影响？',
        after: '你聚焦大学课堂中的写作反馈、教师评价，还是作弊治理？',
        reason: '把大主题收敛成研究问题。',
      },
    ],
  },
  服务流程: {
    focus: '服务流程、关键触点、问题环节、前后台分工和指标',
    dimensions: [
      {
        id: 'service_goal',
        label: '改善目标',
        visibleDimension: '目标',
        question: '你们现在用哪个指标判断续费流程是否改善？',
        answer: '目前主要看到期会员续费率，最近三个月从 42% 降到了 34%。',
        patterns: [/续费率|指标|改善目标|提升多少/, /42%|34%|到期会员/],
        comment: '先确定主指标，避免把流程优化写成泛泛目标。',
      },
      {
        id: 'service_people',
        label: '会员与服务角色',
        visibleDimension: '对象',
        question: '顾问、教练和店长分别承担什么动作？',
        answer: '顾问负责回访，教练提供训练建议，店长查看续费结果；会员是被服务的核心对象。',
        patterns: [/顾问|教练|店长|会员/, /谁负责|角色|分工|承担什么/],
        comment: '服务流程必须同时覆盖前台体验和后台责任。',
      },
      {
        id: 'service_flow',
        label: '服务流程边界',
        visibleDimension: '边界',
        question: '会员最常在哪个触点流失，第一版先改哪一段流程？',
        answer: '会员最常在课程结束后的回访阶段停止回应，第一版先改到期前 14 天到到期后 7 天。',
        patterns: [/触点|流失|停止回应|回访/, /第一版|哪一段|到期前|到期后|流程边界/],
        comment: '明确时间线边界才能定位失效点。',
      },
      {
        id: 'service_acceptance',
        label: '效果标准',
        visibleDimension: '验收',
        question: '试运行后，用哪些结果判断续费流程真的改善？',
        answer: '先看续费率、回访完成率和漏跟进数量，按 8 周试运行比较前后变化。',
        patterns: [/续费率|回访完成率|漏跟进|8 周/, /试运行|前后变化|判断.*改善|效果标准/],
        comment: '流程优化要用可持续追踪的指标验收。',
      },
    ],
    suggestions: [
      '继续追问会员流失触点和顾问、教练、店长的分工。',
      '把“提高续费”拆成续费率、回访率和漏跟进数量。',
    ],
    examples: [
      {
        before: '为什么会员不续费？',
        after: '到期前 14 天到到期后 7 天，哪个提醒或回访触点最容易断掉？',
        reason: '把原因追问放回服务时间线。',
      },
      {
        before: '员工怎么跟进？',
        after: '顾问、教练和店长分别负责哪一步，哪一步没有记录？',
        reason: '明确前后台责任断点。',
      },
    ],
  },
  外包采购: {
    focus: '工作范围、交付物、排除项、验收、里程碑和变更机制',
    dimensions: [
      {
        id: 'outsourcing_goal',
        label: '业务目标',
        visibleDimension: '目标',
        question: '官网的主要业务目标是什么，品牌展示还是获客线索？',
        answer: '官网主要目标是品牌展示和获取咨询线索，首版先跑通可信展示与联系。',
        patterns: [/官网.*目标|品牌展示|获客|咨询线索/, /业务目标|主要价值|先证明/],
        comment: '业务目标会改变栏目和转化功能优先级。',
      },
      {
        id: 'outsourcing_people',
        label: '协作角色',
        visibleDimension: '对象',
        question: '甲方、外包方和最终访客分别由谁确认内容与结果？',
        answer: '甲方市场负责人确认内容，外包项目经理负责交付，销售确认线索表单，最终访客负责使用。',
        patterns: [/甲方|乙方|外包方|市场|销售|访客/, /谁确认|负责人|协作角色|审批/],
        comment: '外包项目需要明确每类交付物的确认人。',
      },
      {
        id: 'outsourcing_scope',
        label: '交付范围',
        visibleDimension: '边界',
        question: '首版必须交付什么，哪些内容明确不包含？',
        answer: '首版交付首页、服务、案例、关于我们、咨询表单和部署；不包含会员、支付、多语言和复杂后台。',
        patterns: [/交付物|首版|栏目|页面|文件|部署/, /不包含|排除|会员|支付|多语言|后台|范围/],
        comment: '交付与排除项应能直接进入合同附件。',
      },
      {
        id: 'outsourcing_acceptance',
        label: '验收与变更',
        visibleDimension: '验收',
        question: '验收和需求变更分别按什么规则处理？',
        answer: '页面上线、移动端可用、表单可收到线索并交齐源文件后验收；清单外调整进入变更报价。',
        patterns: [/验收|移动端|表单|上线|源文件/, /变更|报价|里程碑|付款|什么标准/],
        comment: '验收与变更规则决定返工和报价争议。',
      },
    ],
    suggestions: [
      '继续追问栏目、素材归属、验收、里程碑和变更收费。',
      '把“做官网”拆成页面、内容、后台、表单、上线和维护边界。',
    ],
    examples: [
      {
        before: '官网要哪些功能？',
        after: '首版交付哪些页面、文案、图片和表单，哪些明确不包含？',
        reason: '把功能追问改成可签约范围。',
      },
      {
        before: '多久能做完？',
        after: '原型、视觉、开发和上线分别由谁确认，清单外调整怎么计价？',
        reason: '补上外包确认与变更机制。',
      },
    ],
  },
  协作项目: {
    focus: '共同目标、角色分工、依赖关系、数据风险和版本节点',
    dimensions: [
      {
        id: 'collaboration_goal',
        label: '答辩目标',
        visibleDimension: '目标',
        question: '答辩时最重要的成功标准是什么，可运行演示还是研究创新？',
        answer: '答辩最重要的是跑通演示，同时要说明数据边界和创新点。',
        patterns: [/答辩|成功标准|演示|创新/, /最重要|共同目标|评分/],
        comment: '共同目标决定团队如何做取舍。',
      },
      {
        id: 'collaboration_roles',
        label: '角色分工',
        visibleDimension: '对象',
        question: '三个人分别负责哪些模块和材料？',
        answer: '一人负责前端，一人负责模型和数据，一人负责文档与答辩材料；关键取舍由组长和指导老师确认。',
        patterns: [/三个人|前端|模型|数据|文档|答辩材料/, /谁负责|分工|组长|老师|角色/],
        comment: '模块、材料和决策权需要同时明确。',
      },
      {
        id: 'collaboration_dependencies',
        label: '依赖与范围',
        visibleDimension: '边界',
        question: '哪些数据、模型或设备依赖会影响进度，谁负责兜底？',
        answer: '关键依赖是演示数据、模型接口和学校答辩设备；首版只保证核心演示流程，个性化配置后置。',
        patterns: [/数据|模型接口|设备|依赖|兜底/, /第一版|首版|风险|范围|后置/],
        comment: '协作项目最容易因依赖和范围失控。',
      },
      {
        id: 'collaboration_acceptance',
        label: '完成标准',
        visibleDimension: '验收',
        question: '中期和最终答辩分别要完成什么？',
        answer: '中期前跑通模拟面试到评分反馈，最终答辩补齐稳定演示、创新说明和完整材料。',
        patterns: [/中期|最终答辩|第.*周|版本节点/, /完成什么|验收|可运行|材料清单/],
        comment: '版本节点必须对应可检查的系统和材料。',
      },
    ],
    suggestions: [
      '继续追问分工、共同目标、数据边界和答辩节点。',
      '把“做完整”改成演示流程、创新说明和材料清单。',
    ],
    examples: [
      {
        before: '你们想做哪些功能？',
        after: '答辩必须演示哪条完整流程，三个人分别负责哪一段？',
        reason: '把功能列表转成协作约束。',
      },
      {
        before: '模型怎么做？',
        after: '数据、模型接口和答辩设备有哪些风险，谁负责兜底？',
        reason: '提前暴露关键依赖。',
      },
    ],
  },
  早期想法: {
    focus: '问题假设、用户假设、使用时刻、可能方向和验证目标',
    dimensions: [
      {
        id: 'idea_goal',
        label: '验证目标',
        visibleDimension: '目标',
        question: '第一版最需要验证的是持续练习意愿、反馈有效性还是付费意愿？',
        answer: '第一版先验证用户是否愿意连续练习，以及反馈能否真正改进表达，暂时不急着验证付费。',
        patterns: [/第一版|验证目标|持续练习|反馈有效|付费意愿/, /最需要验证|假设|价值/],
        comment: '早期想法先验证问题和行为，不要过早扩成完整产品。',
      },
      {
        id: 'idea_audience',
        label: '目标用户',
        visibleDimension: '对象',
        question: '先面向哪类人群，学生、职场新人还是长期社交焦虑者？',
        answer: '第一批先面向学生和刚开始做项目的职场新人，不进入医疗或心理治疗人群。',
        patterns: [/学生|职场新人|社交焦虑|人群/, /目标用户|先面向|第一批|谁用/],
        comment: '用户假设越具体，验证结果越有意义。',
      },
      {
        id: 'idea_scenario',
        label: '使用场景与边界',
        visibleDimension: '边界',
        question: '用户最需要练习的是哪个时刻，助手更像陪练还是脚本生成器？',
        answer: '先聚焦面试和汇报前的练习，助手更像陪练和反馈教练；脚本生成只是辅助，也不提供心理诊断。',
        patterns: [/面试|汇报|破冰|消息回复|使用时刻/, /陪练|教练|脚本|心理诊断|场景|边界/],
        comment: '使用时刻和产品角色共同决定原型边界。',
      },
      {
        id: 'idea_acceptance',
        label: '验证标准',
        visibleDimension: '验收',
        question: '用什么行为证明用户愿意持续练习、反馈也确实有帮助？',
        answer: '首轮看用户 7 天内是否至少练习两次，并在第二次练习中改进上一轮指出的问题。',
        patterns: [/7 天|两次|持续练习|改进|行为/, /证明|验证标准|有帮助|怎样判断|指标/],
        comment: '验收应落到可观察的使用行为和改善证据。',
      },
    ],
    suggestions: [
      '继续追问具体使用时刻、第一批用户和验证假设。',
      '不要过早问功能清单，先问为什么需要持续练习。',
    ],
    examples: [
      {
        before: '要做什么功能？',
        after: '用户最需要练习的是面试、汇报、破冰还是消息回复？',
        reason: '早期想法先找具体使用时刻。',
      },
      {
        before: '用户会喜欢吗？',
        after: '第一版先验证持续练习意愿，还是验证反馈能否改善表达？',
        reason: '把主观判断改成可验证假设。',
      },
    ],
  },
};

const FALLBACK_SCENARIO: TrainingSampleScenario = {
  focus: '目标、角色、场景、边界和验收',
  dimensions: [
    {
      id: 'generic_goal',
      label: '目标',
      visibleDimension: '目标',
      question: '这件事最想先解决的具体问题是什么？',
      answer: '最重要的是先把当前问题和期望结果说明清楚。',
      patterns: GENERIC_PATTERNS.目标,
      comment: '目标决定后续追问方向。',
    },
    {
      id: 'generic_people',
      label: '对象',
      visibleDimension: '对象',
      question: '谁会使用或确认这个结果，谁会受到影响？',
      answer: '需要区分实际使用者、结果确认人和受到影响的人。',
      patterns: GENERIC_PATTERNS.对象,
      comment: '不同角色对结果的要求可能不同。',
    },
    {
      id: 'generic_boundary',
      label: '范围边界',
      visibleDimension: '边界',
      question: '第一版先覆盖哪个场景，哪些内容明确不做？',
      answer: '第一版只覆盖最关键场景，其他内容先列为后续范围。',
      patterns: GENERIC_PATTERNS.边界,
      comment: '边界用于控制承诺和工作量。',
    },
    {
      id: 'generic_acceptance',
      label: '验收标准',
      visibleDimension: '验收',
      question: '什么结果出现时，可以判断这件事已经做好？',
      answer: '需要用可观察的结果判断是否完成。',
      patterns: GENERIC_PATTERNS.验收,
      comment: '完成标准应可观察、可复核。',
    },
  ],
  suggestions: ['继续追问目标、对象、边界和完成标准。'],
  examples: [],
};

function getScenario(trainingCase: TrainingCase): TrainingSampleScenario {
  return TRAINING_SAMPLE_SCENARIOS[trainingCase.category] ?? FALLBACK_SCENARIO;
}

function normalizeQuestion(value: string): string {
  return value.toLowerCase().replace(/[\s，。,.！!？?：:；;、"'“”‘’（）()【】\[\]]/g, '');
}

function charBigrams(value: string): Set<string> {
  const normalized = normalizeQuestion(value);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function isNearDuplicate(left: string, right: string): boolean {
  const a = normalizeQuestion(left);
  const b = normalizeQuestion(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aGrams = charBigrams(a);
  const bGrams = charBigrams(b);
  if (aGrams.size === 0 || bGrams.size === 0) return false;
  let overlap = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) overlap += 1;
  }
  return overlap / Math.max(aGrams.size, bGrams.size) >= 0.72;
}

function dimensionScore(question: string, dimension: TrainingSampleDimension): number {
  const directHits = dimension.patterns.filter((pattern) => pattern.test(question)).length;
  const genericHits = GENERIC_PATTERNS[dimension.visibleDimension].filter((pattern) => pattern.test(question)).length;
  return directHits * 3 + genericHits;
}

function strengthFor(question: string, score: number): CoverageStrength {
  if (score <= 0) return 'missing';
  const concrete = /多少|多久|谁|哪个|哪些|如何|怎么|如果|第一版|首版|异常|标准|指标|时间|负责人/.test(question);
  if (score >= 4 || (score >= 3 && (question.trim().length >= 10 || concrete))) return 'covered';
  if (score >= 2 && question.trim().length >= 14) return 'covered';
  return 'partial';
}

function assessQuestion(
  scenario: TrainingSampleScenario,
  question: string,
  previousQuestions: string[] = [],
): QuestionAssessment {
  const ranked = scenario.dimensions
    .map((dimension) => ({ dimension, score: dimensionScore(question, dimension) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score <= 0) {
    return {
      question,
      dimensionId: null,
      strength: 'missing',
      repeated: previousQuestions.some((previous) => isNearDuplicate(previous, question)),
    };
  }
  return {
    question,
    dimensionId: best.dimension.id,
    strength: strengthFor(question, best.score),
    repeated: previousQuestions.some((previous) => isNearDuplicate(previous, question)),
  };
}

function coveredDimensionIds(scenario: TrainingSampleScenario, questions: string[]): Set<string> {
  const covered = new Set<string>();
  const previous: string[] = [];
  for (const question of questions) {
    const assessment = assessQuestion(scenario, question, previous);
    if (assessment.dimensionId && !assessment.repeated && assessment.strength === 'covered') {
      covered.add(assessment.dimensionId);
    }
    previous.push(question);
  }
  return covered;
}

function nextQuestionFor(scenario: TrainingSampleScenario, questions: string[]): string {
  const covered = coveredDimensionIds(scenario, questions);
  const next = scenario.dimensions.find((dimension) => !covered.has(dimension.id));
  return next?.question ?? '主要方向已经覆盖，可以再追问一个量化标准、失败例外或责任人。';
}

export function getTrainingSampleProfile(trainingCase: TrainingCase): TrainingSampleProfile {
  const scenario = getScenario(trainingCase);
  return {
    focus: scenario.focus,
    questions: scenario.dimensions.map((dimension) => dimension.question),
  };
}

export function getTrainingSampleNextHint(trainingCase: TrainingCase, questions: string[]): string {
  return nextQuestionFor(getScenario(trainingCase), questions);
}

export function resolveTrainingSampleTurn(
  trainingCase: TrainingCase,
  question: string,
  previousQuestions: string[],
): TrainingSampleTurn {
  const scenario = getScenario(trainingCase);
  const assessment = assessQuestion(scenario, question, previousQuestions);
  const dimension = scenario.dimensions.find((item) => item.id === assessment.dimensionId) ?? null;
  const allQuestions = [...previousQuestions, question];
  const covered = coveredDimensionIds(scenario, allQuestions);
  const nextHint = nextQuestionFor(scenario, allQuestions);

  if (!dimension) {
    return {
      answer: `这个问题和当前练习情境还没有直接连上。先从案例中的目标、角色、边界或完成标准继续追问，例如：“${nextHint}”`,
      nextHint,
      dimensionId: null,
      dimensionLabel: null,
      strength: 'missing',
      repeated: assessment.repeated,
      coveredCount: covered.size,
      totalDimensions: scenario.dimensions.length,
    };
  }

  const answer = assessment.repeated
    ? `这个问题和刚才的问法基本重复，这个方向已经说明过：${dimension.answer} 可以换一个尚未覆盖的方向继续问。`
    : assessment.strength === 'partial' && trainingCase.difficulty === 'hard'
      ? `这个问题还比较宽，我先说能确认的部分：${dimension.answer} 继续追问时可以再具体到责任人、时间或判断标准。`
      : dimension.answer;

  return {
    answer,
    nextHint,
    dimensionId: dimension.id,
    dimensionLabel: dimension.label,
    strength: assessment.strength,
    repeated: assessment.repeated,
    coveredCount: covered.size,
    totalDimensions: scenario.dimensions.length,
  };
}

export function buildTrainingSampleSummary(trainingCase: TrainingCase, questions: string[]): string {
  if (questions.length === 0) {
    return `本轮围绕《${trainingCase.title}》开始练习，还需要先选择一条预设追问。`;
  }
  const scenario = getScenario(trainingCase);
  const covered = coveredDimensionIds(scenario, questions);
  const coveredLabels = scenario.dimensions
    .filter((dimension) => covered.has(dimension.id))
    .map((dimension) => dimension.label);
  return [
    `本轮练习案例：${trainingCase.title}`,
    `已追问：${questions.slice(-4).join('；')}`,
    `已有效覆盖：${coveredLabels.length > 0 ? coveredLabels.join('、') : '暂未形成明确覆盖'}`,
  ].join('\n');
}

export function buildTrainingSampleFeedback(
  trainingCase: TrainingCase,
  questions: string[],
): TrainingFeedback {
  const scenario = getScenario(trainingCase);
  const byDimension = new Map<string, QuestionAssessment[]>();
  const previous: string[] = [];

  for (const question of questions) {
    const assessment = assessQuestion(scenario, question, previous);
    if (assessment.dimensionId) {
      const rows = byDimension.get(assessment.dimensionId) ?? [];
      rows.push(assessment);
      byDimension.set(assessment.dimensionId, rows);
    }
    previous.push(question);
  }

  let score = 0;
  const dimensionBreakdown = scenario.dimensions.map((dimension) => {
    const assessments = byDimension.get(dimension.id) ?? [];
    const uniqueAssessments = assessments.filter((assessment) => !assessment.repeated);
    const coveredAssessment = uniqueAssessments.find((assessment) => assessment.strength === 'covered');
    const partialAssessment = uniqueAssessments.find((assessment) => assessment.strength === 'partial');
    const best = coveredAssessment ?? partialAssessment;
    const status: CoverageStrength = coveredAssessment ? 'covered' : partialAssessment ? 'partial' : 'missing';
    score += status === 'covered' ? 0.22 : status === 'partial' ? 0.11 : 0;
    const repeatedCount = assessments.filter((assessment) => assessment.repeated).length;
    return {
      dimension: dimension.label,
      status,
      evidence: best
        ? `已追问：“${best.question}”${repeatedCount > 0 ? `；另有 ${repeatedCount} 次相近重复追问未重复计分。` : ''}`
        : `本轮还没有问到${dimension.label}。`,
      comment: dimension.comment,
    };
  });

  if (dimensionBreakdown.every((dimension) => dimension.status === 'covered')) score += 0.02;
  const missingDimensions = dimensionBreakdown
    .filter((dimension) => dimension.status !== 'covered')
    .map((dimension) => dimension.dimension);
  const dynamicSuggestion = missingDimensions[0]
    ? `下一轮优先补问“${missingDimensions[0]}”，不要用重复问题代替新的覆盖。`
    : '主要方向已经覆盖，下一轮可以继续追问量化标准、失败例外和责任归属。';

  return {
    coverage_score: Math.min(0.9, Number(score.toFixed(2))),
    missing_dimensions: missingDimensions,
    improvement_suggestions: [dynamicSuggestion, ...scenario.suggestions].slice(0, 3),
    dimension_breakdown: dimensionBreakdown,
    improvement_examples: scenario.examples,
  };
}
