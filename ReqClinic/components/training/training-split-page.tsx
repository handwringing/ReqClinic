'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Send,
  Sparkles,
} from 'lucide-react';
import { getApiClient } from '@/lib/api';
import type {
  AiJob,
  TrainingAttempt,
  TrainingAttemptMessage,
  TrainingCase,
  TrainingFeedback,
} from '@/lib/api/types';
import {
  Avatar,
  LongWaitProgress,
  Splitter,
} from '@/components/ui';
import { generateUUID } from '@/lib/utils/id';

interface StructuredContent {
  paragraphs?: string[];
  bullets?: string[];
  highlights?: string[];
}

interface TrainingBinding {
  id: string;
  title: string;
  detail: string;
}

interface TrainingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  bindings?: TrainingBinding[];
  speaker?: TrainingAttemptMessage['speaker'];
  structured_content?: StructuredContent;
  created_at: string;
}

const GUIDED_QUESTIONS = [
  '这件事最想先解决的具体问题是什么？',
  '谁会使用或确认这个结果，谁会受到影响？',
  '如果第一版只能覆盖一个场景，最应该先覆盖哪一个？',
  '什么结果出现时，你们会认为这件事已经做好？',
];

interface TrainingProfile {
  focus: string;
  questions: string[];
}

interface SampleFeedbackProfile {
  scoreBase: number;
  missing: string[];
  suggestions: string[];
  examples: TrainingFeedback['improvement_examples'];
  dimensionNotes: Partial<Record<'目标' | '对象' | '边界' | '验收', { evidence: string; comment: string }>>;
}

const SAMPLE_ROLE_ANSWERS: Record<string, string[]> = {
  需求访谈: [
    '我最关心高峰时段访客排队和异常来访处理，不能只看登记是否方便。',
    '主要使用的是门岗安保，前台会发起部分预约，运营要看记录和统计。',
    '最常见的异常是访客忘带证件、预约信息不一致，或者临时来访没有提前登记。',
    '如果高峰期核验更快、异常处理有记录、事后能查到责任链，我们就认为第一版有价值。',
  ],
  范围边界: [
    '第一版先解决校内同学发布和联系，不想一开始就承担完整交易平台责任。',
    '买卖双方主要通过平台看到信息，后续沟通可以先跳到微信或线下。',
    '支付、物流、担保交易和纠纷仲裁暂时不做，最多做举报和下架。',
    '首版能稳定发布、搜索、联系和举报，管理员能处理违规信息，就算达成。',
  ],
  运营指标: [
    '我们说的转化率主要是从商品详情页到下单的转化，不包含老客复购。',
    '希望在双十一前两周看到提升，目标是从现在的 2.8% 提到 3.5% 左右。',
    '运营负责人确认目标，商品、投放和客服都需要配合。',
    '统计时要排除异常流量、刷单订单和售后取消订单。',
  ],
  创意简报: [
    '这组海报主要用于双十一前的拉新转化，希望突出首单优惠和套装折扣。',
    '主要面向 20 到 28 岁的一二线城市女性用户，她们更在意成分安全、价格和上脸效果。',
    '需要小红书封面、朋友圈长图和门店立牌三个版本。',
    '不能使用医疗功效词，不能暗示永久效果，也不能使用未授权明星图。',
  ],
  学术任务: [
    '课程要求 4000 字左右，至少 8 篇参考文献，下周五前提交。',
    '我想聚焦大学课堂，而不是所有教育阶段。',
    '研究问题可以是生成式智能如何改变学生写作反馈和教师评价方式。',
    '老师允许英文文献，也可以引用政策文件和课堂案例。',
  ],
  服务流程: [
    '目前主要看到期会员的续费率，最近三个月从 42% 降到 34%。',
    '会员最常在课程结束后的回访阶段停止回应。',
    '顾问负责回访，教练提供训练建议，店长只看最终续费数据。',
    '第一版应该先改到期前 14 天到到期后 7 天这段流程。',
  ],
  外包采购: [
    '官网主要目标是品牌展示和获取咨询线索。',
    '首版必须有首页、服务介绍、案例、关于我们和咨询表单。',
    '暂时不包含会员系统、在线支付、多语言和复杂后台。',
    '验收标准是页面能上线、移动端可用、咨询表单能正常收到。',
  ],
  协作项目: [
    '答辩最重要的是能跑通演示，同时说明数据边界和创新点。',
    '一个人负责前端，一个人负责模型和数据，一个人负责文档和答辩材料。',
    '最大的依赖是训练数据、模型接口稳定性和学校答辩设备环境。',
    '第一版必须有演示流程、核心分析结果和答辩说明，个性化配置可以放后面。',
  ],
  早期想法: [
    '最想练习的是用户不知道怎么把模糊想法说清楚的时刻。',
    '第一批可以先面向学生和刚开始做项目的职场新人。',
    '助手更像陪练教练，先追问，再指出表达哪里不清楚。',
    '第一版最需要验证用户是否愿意连续练习，以及反馈是否真的能改进表达。',
  ],
};

const TRAINING_PROFILES: Record<string, TrainingProfile> = {
  需求访谈: {
    focus: '访谈目标、现场角色、关键场景、异常处理和验收口径',
    questions: [
      '这套访客系统最想先解决门岗现场的哪个问题？',
      '谁会实际使用系统，安保、前台、访客和运营分别要做什么？',
      '访客到现场但预约信息异常时，现在希望怎么处理？',
      '第一版上线后，用什么现场结果判断它确实更安全或更高效？',
    ],
  },
  范围边界: {
    focus: '首版范围、交易路径、不做事项、平台责任和验收标准',
    questions: [
      '第一版到底只做信息发布和联系，还是要覆盖支付、物流和担保交易？',
      '买家看到商品后，下一步是在平台内沟通，还是跳转到微信或线下交易？',
      '哪些事情明确不做，比如支付、物流、担保、纠纷仲裁或实名认证？',
      '首版上线后，用什么标准判断这个小程序已经可用？',
    ],
  },
  运营指标: {
    focus: '指标口径、目标幅度、责任分工、适用场景和验收周期',
    questions: [
      '你们说提升转化率时，具体用哪个指标判断？',
      '这个目标需要在什么时间范围内提升到多少？',
      '这个目标主要由谁确认，哪些团队需要配合？',
      '统计这个指标时，哪些流量或订单需要排除？',
    ],
  },
  创意简报: {
    focus: '目标受众、渠道规格、核心信息、素材和审核边界',
    questions: [
      '这次海报最核心的投放目标是什么，拉新、转化还是品牌印象？',
      '目标受众具体是哪类人，她们最在意的卖点是什么？',
      '投放渠道和尺寸版本有哪些硬性要求？',
      '有哪些功效表达、素材或风格是必须避开的？',
    ],
  },
  学术任务: {
    focus: '任务要求、评分标准、研究问题、证据范围和结构计划',
    questions: [
      '课程对字数、格式、截止时间和引用数量有什么要求？',
      '你准备聚焦哪个教育阶段或具体场景？',
      '这篇论文最想回答的研究问题是什么？',
      '老师是否允许英文文献、政策案例或实证数据？',
    ],
  },
  服务流程: {
    focus: '服务流程、关键触点、问题环节、前后台分工和指标',
    questions: [
      '你们现在用哪个指标判断续费流程是否改善？',
      '会员最常在哪个触点流失或停止回应？',
      '前台、顾问、教练和店长分别承担什么动作？',
      '如果第一版只改一段流程，最应该先改哪里？',
    ],
  },
  外包采购: {
    focus: '工作范围、交付物、排除项、验收、里程碑和变更机制',
    questions: [
      '官网的主要业务目标是什么，品牌展示还是获客线索？',
      '首版必须交付哪些栏目、功能和文件？',
      '哪些内容明确不包含在外包范围里？',
      '验收时用什么标准判断外包已经完成？',
    ],
  },
  协作项目: {
    focus: '共同目标、角色分工、依赖关系、数据风险和版本节点',
    questions: [
      '答辩时最重要的成功标准是什么，可运行演示还是研究创新？',
      '三个人分别负责哪些模块和材料？',
      '哪些数据、模型或设备依赖会影响进度？',
      '哪些功能必须进第一版，哪些可以放到答辩后？',
    ],
  },
  早期想法: {
    focus: '问题假设、用户假设、使用时刻、可能方向和验证目标',
    questions: [
      '用户最需要练习的是哪个具体时刻，而不是泛泛的沟通？',
      '先面向哪类人群，学生、职场新人还是长期社交焦虑者？',
      '智能助手更像陪练对象、反馈教练，还是脚本生成器？',
      '第一版最需要验证的是持续练习意愿、反馈有效性还是付费意愿？',
    ],
  },
};

const SAMPLE_FEEDBACK_PROFILES: Record<string, SampleFeedbackProfile> = {
  需求访谈: {
    scoreBase: 0.47,
    missing: ['异常处理', '现场核验标准'],
    suggestions: [
      '继续追问高峰时段、异常来访和安保核验动作。',
      '把“更安全”拆成可观察的核验结果，例如漏放、误拦和处理时长。',
    ],
    examples: [
      {
        before: '访客系统要怎么做？',
        after: '在访客到门岗但预约信息异常时，安保希望先看到哪些信息、能做哪些处理？',
        reason: '把泛泛功能追问改成现场异常场景追问。',
      },
      {
        before: '要不要提高效率？',
        after: '高峰时段一名安保每分钟需要核验多少访客，超过多久算不可接受？',
        reason: '把效率诉求改成可判断的现场标准。',
      },
    ],
    dimensionNotes: {
      目标: { evidence: '已开始围绕安保访谈目标追问。', comment: '下一步要把安全和效率拆成具体场景。' },
      对象: { evidence: '安保主管已经明确，但前台、访客和运营角色还可补问。', comment: '访客系统通常涉及多角色协同。' },
      边界: { evidence: '还没充分确认异常来访、权限和人工兜底。', comment: '边界会直接影响门岗处置责任。' },
      验收: { evidence: '还缺少通行速度、误拦漏放等验收口径。', comment: '验收要能对应现场管理结果。' },
    },
  },
  范围边界: {
    scoreBase: 0.5,
    missing: ['交易闭环', '不做事项'],
    suggestions: [
      '继续追问第一版到底只做信息发布，还是包含担保、支付和纠纷处理。',
      '把“更安全”改成具体机制，例如校内身份、举报、黑名单或线下交易提醒。',
    ],
    examples: [
      {
        before: '交易要安全吗？',
        after: '第一版是否只负责发布和联系，支付、物流、担保和纠纷处理哪些明确不做？',
        reason: '先划清范围，避免把平台责任无限扩大。',
      },
      {
        before: '有哪些功能？',
        after: '买家看到商品后，下一步是在平台内沟通，还是跳转到微信/线下交易？',
        reason: '用真实交易路径倒推必要功能。',
      },
    ],
    dimensionNotes: {
      目标: { evidence: '已开始追问发布信息与交易闭环的优先级。', comment: '目标不同会决定是否需要支付和纠纷处理。' },
      对象: { evidence: '对象是校内学生，但管理员、卖家和买家责任还可补问。', comment: '角色边界会影响规则设计。' },
      边界: { evidence: '担保、物流、支付等不做项还需确认。', comment: '这是本案例最关键的追问方向。' },
      验收: { evidence: '还缺少首版上线后怎么判断安全和活跃的标准。', comment: '验收可从发布量、举报率和成交路径观察。' },
    },
  },
  创意简报: {
    scoreBase: 0.56,
    missing: ['审核红线', '渠道规格'],
    suggestions: [
      '继续追问投放渠道、尺寸版本、必须出现的卖点和禁用表达。',
      '把“高级感”改成可执行的视觉约束，例如色调、素材、留白和品牌禁区。',
    ],
    examples: [
      {
        before: '你想做什么风格？',
        after: '这组海报主要投放在哪里，必须避开哪些功效、人物或素材表达？',
        reason: '从泛泛偏好转成渠道和审核边界追问。',
      },
      {
        before: '要突出转化吗？',
        after: '用户在几秒内必须看到哪个利益点，首单优惠、套装折扣还是成分安全？',
        reason: '把转化目标改成画面优先级。',
      },
    ],
    dimensionNotes: {
      目标: { evidence: '已围绕转化目标开始追问。', comment: '创意 Brief 还要把目标翻译成画面优先级。' },
      对象: { evidence: '目标受众仍需年龄、渠道和购买动机补充。', comment: '受众不清会导致风格判断失真。' },
      边界: { evidence: '审核红线、禁用词和素材限制还没充分确认。', comment: '美妆海报尤其需要先问合规边界。' },
      验收: { evidence: '还缺少审核通过、点击率或卖点可读性的判断标准。', comment: '验收应连接投放目标。' },
    },
  },
  学术任务: {
    scoreBase: 0.54,
    missing: ['评分标准', '证据范围'],
    suggestions: [
      '继续追问课程要求、引用数量、老师偏好的论文结构和允许的数据来源。',
      '把“大主题”收窄成一个可以在字数内回答的研究问题。',
    ],
    examples: [
      {
        before: '你想写什么方向？',
        after: '这门课要求多少字、几篇文献、是否需要实证材料，老师更看重观点还是规范？',
        reason: '先确认任务规则，避免选题超出课程要求。',
      },
      {
        before: 'AI 对教育有什么影响？',
        after: '你准备聚焦大学课堂中的写作反馈、教师评价，还是学生作弊治理？',
        reason: '把大主题收敛成可论证问题。',
      },
    ],
    dimensionNotes: {
      目标: { evidence: '已开始从论文主题转向研究问题。', comment: '目标应落到课程可评分的研究问题。' },
      对象: { evidence: '课程老师和作业要求还可补问。', comment: '学术任务的确认对象通常是评分规则。' },
      边界: { evidence: '教育阶段、材料来源和论文字数边界还需确认。', comment: '边界决定论文是否可写完。' },
      验收: { evidence: '还缺少评分标准、引用要求和结构标准。', comment: '验收要对应课程评分要求。' },
    },
  },
  服务流程: {
    scoreBase: 0.52,
    missing: ['触点失效', '前后台分工'],
    suggestions: [
      '继续追问会员在哪个触点流失，以及顾问、教练、店长分别做什么。',
      '把“提高续费”拆成续费率、到店率、回访完成率等可观察指标。',
    ],
    examples: [
      {
        before: '为什么会员不续费？',
        after: '会员从到期前 14 天到到期后 7 天，在哪个提醒或回访触点最容易断掉？',
        reason: '把原因追问放回服务流程时间线。',
      },
      {
        before: '员工怎么跟进？',
        after: '顾问、教练和店长在续费前后分别负责哪一步，哪一步现在没有记录？',
        reason: '明确前后台分工和责任断点。',
      },
    ],
    dimensionNotes: {
      目标: { evidence: '已开始围绕续费率和流程改善追问。', comment: '还要确认主指标和辅助指标。' },
      对象: { evidence: '会员是核心对象，顾问、教练和店长还可继续拆分。', comment: '服务流程必须覆盖前台和后台角色。' },
      边界: { evidence: '到期前后哪些阶段纳入首版还需确认。', comment: '流程边界决定改造成本。' },
      验收: { evidence: '还缺少续费率、回访率或投诉减少的目标值。', comment: '服务优化需要可追踪指标。' },
    },
  },
  外包采购: {
    scoreBase: 0.55,
    missing: ['交付物清单', '变更机制'],
    suggestions: [
      '继续追问首版栏目、素材归属、验收标准、里程碑和变更收费方式。',
      '把“做官网”拆成页面、内容、后台、表单、上线和维护边界。',
    ],
    examples: [
      {
        before: '官网要哪些功能？',
        after: '首版必须交付哪些栏目、页面、文案、图片和表单，哪些明确不包含？',
        reason: '把功能追问改成可签约的交付范围。',
      },
      {
        before: '多久能做完？',
        after: '希望按哪些里程碑验收，原型、视觉、开发、上线分别由谁确认？',
        reason: '补上外包协作中的确认机制。',
      },
    ],
    dimensionNotes: {
      目标: { evidence: '已开始确认品牌展示或获客目标。', comment: '目标会影响栏目和转化表单设计。' },
      对象: { evidence: '甲方、外包方和最终访客角色还可补问。', comment: '外包采购要明确确认人。' },
      边界: { evidence: '后台、多语言、维护、素材等边界还需追问。', comment: '边界不清会导致返工和加价。' },
      验收: { evidence: '还缺少上线、移动端、表单和交付文件的验收口径。', comment: '验收要能写进合同或需求书。' },
    },
  },
  协作项目: {
    scoreBase: 0.51,
    missing: ['分工依赖', '答辩标准'],
    suggestions: [
      '继续追问三个人的分工、共同目标、数据边界和答辩版本节点。',
      '把“做完整”改成可演示流程、创新点说明和材料交付清单。',
    ],
    examples: [
      {
        before: '你们想做哪些功能？',
        after: '答辩时必须演示哪一条完整流程，三个人分别负责哪一段？',
        reason: '把功能列表转成协作和答辩约束。',
      },
      {
        before: '模型怎么做？',
        after: '训练数据、模型接口和学校答辩设备有哪些风险，谁负责兜底？',
        reason: '提前暴露关键依赖和风险责任。',
      },
    ],
    dimensionNotes: {
      目标: { evidence: '已开始追问答辩成功标准。', comment: '毕业设计目标要兼顾演示、创新和文档。' },
      对象: { evidence: '小组成员明确，但老师和答辩评委标准还可补问。', comment: '评审对象决定取舍优先级。' },
      边界: { evidence: '数据、模型接口和个性化功能边界还需确认。', comment: '协作项目最容易在边界上失控。' },
      验收: { evidence: '还缺少可运行演示和答辩材料的完成口径。', comment: '验收要对应学校评分。' },
    },
  },
  早期想法: {
    scoreBase: 0.5,
    missing: ['用户假设', '验证方式'],
    suggestions: [
      '继续追问具体使用时刻、第一批用户和想验证的关键假设。',
      '不要过早问功能清单，先问用户为什么需要持续练习。',
    ],
    examples: [
      {
        before: '要做什么功能？',
        after: '用户最需要练习的是面试、汇报、破冰聊天，还是日常消息回复？',
        reason: '早期想法先找具体使用时刻。',
      },
      {
        before: '用户会喜欢吗？',
        after: '第一版要验证用户愿不愿意连续练习，还是验证反馈是否真的能改善表达？',
        reason: '把主观判断改成可验证假设。',
      },
    ],
    dimensionNotes: {
      目标: { evidence: '已开始追问产品想验证的问题。', comment: '早期想法的目标不应过早写成完整功能。' },
      对象: { evidence: '潜在用户还需要按使用时刻和痛点继续细分。', comment: '用户假设越具体，验证越有效。' },
      边界: { evidence: '陪练、教练、脚本生成等方向边界还需确认。', comment: '方向边界决定原型形态。' },
      验收: { evidence: '还缺少愿意持续练习、反馈有效性的验证标准。', comment: '验收应落到试用反馈。' },
    },
  },
};

function getTrainingProfile(trainingCase: TrainingCase): TrainingProfile {
  return TRAINING_PROFILES[trainingCase.category] ?? {
    focus: '目标、角色、场景、边界和验收',
    questions: GUIDED_QUESTIONS,
  };
}

function getSampleRoleAnswer(trainingCase: TrainingCase, questionIndex: number, question: string): string {
  const answers = SAMPLE_ROLE_ANSWERS[trainingCase.category] ?? SAMPLE_ROLE_ANSWERS.运营指标;
  const direct = answers[questionIndex % answers.length];
  if (direct) return direct;
  return `这个问题需要进一步确认。你刚才问的是“${question}”，可以继续追问目标、对象、边界或验收标准。`;
}

function buildAutoSummary(trainingCase: TrainingCase, messages: TrainingMessage[]): string {
  const userQuestions = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-4);
  if (!userQuestions.length) {
    return `本轮围绕《${trainingCase.title}》开始练习，还需要先提出一个能让对方回答的追问。`;
  }
  return [
    `本轮练习案例：${trainingCase.title}`,
    `已追问：${userQuestions.join('；')}`,
    '系统将根据这些追问判断目标、对象、场景、边界和验收口径的覆盖情况。',
  ].join('\n');
}

function buildSampleFeedback(trainingCase: TrainingCase, questionCount: number): TrainingFeedback {
  const profile = SAMPLE_FEEDBACK_PROFILES[trainingCase.category] ?? SAMPLE_FEEDBACK_PROFILES.需求访谈;
  const covered = Math.min(0.9, profile.scoreBase + questionCount * 0.12);
  const objectStatus = questionCount >= 2 ? 'covered' : 'partial';
  const boundaryStatus = questionCount >= 4 ? 'covered' : 'missing';
  const acceptanceStatus = questionCount >= 3 ? 'partial' : 'missing';
  return {
    coverage_score: covered,
    missing_dimensions:
      questionCount >= 4
        ? ['后续变化处理']
        : profile.missing,
    improvement_suggestions: profile.suggestions,
    dimension_breakdown: [
      {
        dimension: '目标',
        status: questionCount >= 1 ? 'covered' : 'partial',
        evidence:
          questionCount >= 1
            ? profile.dimensionNotes.目标?.evidence ?? '已开始追问目标或用途。'
            : '还需要先确认目标。',
        comment: profile.dimensionNotes.目标?.comment ?? '先确认为什么要做，后续范围才不会发散。',
      },
      {
        dimension: '对象',
        status: objectStatus,
        evidence:
          objectStatus === 'covered'
            ? '已继续追问目标用户、确认人或协作角色。'
            : profile.dimensionNotes.对象?.evidence ?? '对象和确认人还不够清楚。',
        comment: profile.dimensionNotes.对象?.comment ?? '对象不同，方案和验收标准会明显不同。',
      },
      {
        dimension: '边界',
        status: boundaryStatus,
        evidence:
          boundaryStatus === 'covered'
            ? '已追问限制、禁用项或范围。'
            : profile.dimensionNotes.边界?.evidence ?? '还没有充分追问限制条件。',
        comment: profile.dimensionNotes.边界?.comment ?? '边界决定哪些承诺不能轻易写进需求。',
      },
      {
        dimension: '验收',
        status: acceptanceStatus,
        evidence:
          acceptanceStatus === 'partial'
            ? '已有完成口径线索，但还可更量化。'
            : profile.dimensionNotes.验收?.evidence ?? '还缺少可判断完成的标准。',
        comment: profile.dimensionNotes.验收?.comment ?? '验收标准越具体，后续沟通成本越低。',
      },
    ],
    improvement_examples: profile.examples,
  };
}

function createInitialAssistantMessage(
  trainingCase: TrainingCase,
  trainingProfile: TrainingProfile,
): TrainingMessage {
  return {
    id: `ai-init-${generateUUID()}`,
    role: 'assistant',
    speaker: 'coach',
    content: trainingCase.description,
    structured_content: {
      paragraphs: [
        trainingCase.description,
        `先围绕${trainingProfile.focus}追问。下方会给出当前建议追问，可以直接填入并发送。`,
      ],
      highlights: ['当前建议追问'],
    },
    created_at: new Date().toISOString(),
  };
}

function normalizeBinding(input: unknown): TrainingBinding | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  const title = typeof record.title === 'string' ? record.title : '';
  const detail = typeof record.detail === 'string' ? record.detail : '';
  if (!id || !title) return null;
  return { id, title, detail };
}

function mapAttemptMessages(
  attempt: TrainingAttempt | null,
  trainingCase: TrainingCase,
  trainingProfile: TrainingProfile,
): TrainingMessage[] {
  const rows = attempt?.messages ?? [];
  if (!rows.length) return [createInitialAssistantMessage(trainingCase, trainingProfile)];
  return rows.map((message) => ({
    id: message.id,
    role: message.role,
    speaker: message.speaker,
    content: message.content,
    bindings: (message.bindings ?? [])
      .map(normalizeBinding)
      .filter((item): item is TrainingBinding => item !== null),
    created_at: message.created_at,
  }));
}

function extractRoleAnswerFromJob(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const keys = ['role_answer', 'answer', 'content', 'message', 'text', 'response'];
  for (const key of keys) {
    const v = r[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
    // role_answer may be an object like { content: string, tone: string, ... }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const inner = obj.content ?? obj.answer ?? obj.text ?? obj.message;
      if (typeof inner === 'string' && inner.trim().length > 0) return inner;
    }
  }
  const data = r.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of keys) {
      const v = d[key];
      if (typeof v === 'string' && v.trim().length > 0) return v;
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        const inner = obj.content ?? obj.answer ?? obj.text ?? obj.message;
        if (typeof inner === 'string' && inner.trim().length > 0) return inner;
      }
    }
  }
  const nested = findRoleAnswerDeep(result, 0);
  if (nested) return nested;
  return null;
}

function findRoleAnswerDeep(value: unknown, depth: number): string | null {
  if (depth > 4 || !value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['role_answer', 'answer', 'content', 'message', 'text', 'response']) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (item && typeof item === 'object') {
      const nested = findRoleAnswerDeep(item, depth + 1);
      if (nested) return nested;
    }
  }
  for (const item of Object.values(record)) {
    if (item && typeof item === 'object') {
      const nested = findRoleAnswerDeep(item, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function extractNextHintFromAttempt(attempt: TrainingAttempt | null): string | null {
  if (!attempt) return null;
  const hint = attempt.coach_projection?.next_hint;
  if (typeof hint === 'string' && hint.trim().length > 0) return cleanVisibleHint(hint);
  return null;
}

function extractNextHintFromJob(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const cp = r.coach_projection;
  if (cp && typeof cp === 'object') {
      const hint = (cp as Record<string, unknown>).next_hint;
    if (typeof hint === 'string' && hint.trim().length > 0) return cleanVisibleHint(hint);
  }
  const data = r.data;
  if (data && typeof data === 'object') {
    const cp2 = (data as Record<string, unknown>).coach_projection;
    if (cp2 && typeof cp2 === 'object') {
      const hint = (cp2 as Record<string, unknown>).next_hint;
      if (typeof hint === 'string' && hint.trim().length > 0) return cleanVisibleHint(hint);
    }
  }
  return null;
}

function cleanVisibleHint(hint: string): string {
  return hint
    .replace(/用户输入了无意义内容[，,]?\s*/g, '刚才这句还不像一个可回答的问题，')
    .replace(/无意义内容/g, '不完整表达')
    .replace(/请重新提出/g, '请换成');
}

function looksLikeTrainingQuestion(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^[\d\s.,，。:：;；!?！？_-]+$/.test(text)) return false;
  const compact = text.replace(/\s+/g, '');
  if (/^[a-zA-Z0-9_-]+$/.test(compact) && !/[一-龥]/.test(compact)) return false;
  if (/[?？]/.test(text)) return true;
  if (/[一-龥]/.test(text) && /什么|谁|哪里|哪个|哪些|多少|多久|如何|怎么|是否|能不能|有没有|为什么|确认|判断|标准|目标|范围|角色|场景|验收/.test(text)) {
    return true;
  }
  return false;
}

const POLL_INTERVAL_MS = 650;
const POLL_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 轮询 job 状态直到 succeeded/failed/cancelled 或超时（60s）。
async function pollJobUntilDone(jobId: string): Promise<AiJob | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    try {
      const job = await getApiClient().getJobStatus(jobId);
      if (
        job.status === 'succeeded' ||
        job.status === 'failed' ||
        job.status === 'cancelled'
      ) {
        return job;
      }
    } catch {
      // 单次失败不中断轮询
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

function useSplitPct(storageKey: string, defaultPct: number, min = 25, max = 75) {
  const [pct, setPct] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(storageKey);
      if (stored !== null) {
        const n = Number(stored);
        if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
      }
    }
    return Math.min(max, Math.max(min, defaultPct));
  });
  return [pct, setPct] as const;
}

export interface TrainingSplitPageProps {
  attempt: TrainingAttempt;
  trainingCase: TrainingCase;
  onSummarySubmitted: (jobId: string, localFeedback?: TrainingFeedback) => void;
}

export function TrainingSplitPage({
  attempt,
  trainingCase,
  onSummarySubmitted,
}: TrainingSplitPageProps) {
  const router = useRouter();
  const trainingProfile = useMemo(
    () => getTrainingProfile(trainingCase),
    [trainingCase],
  );
  const isSampleAttempt =
    attempt.source_kind === 'sample' ||
    trainingCase.version === 'demo' ||
    trainingCase.id.startsWith('demo-training');
  const [messages, setMessages] = useState<TrainingMessage[]>(() =>
    mapAttemptMessages(attempt, trainingCase, trainingProfile),
  );
  const [input, setInput] = useState('');
  const [bindings, setBindings] = useState<TrainingBinding[]>([]);
  const [questionCount, setQuestionCount] = useState(attempt.question_count);
  const [briefOpen, setBriefOpen] = useState(true);
  const [submittingQuestion, setSubmittingQuestion] = useState(false);
  const [submittingSummary, setSubmittingSummary] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [summaryReady, setSummaryReady] = useState(attempt.question_count > 0);

  // 新增：等待回答 / 失败提示 / job 轮询相关状态
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [isWaitingAnswer, setIsWaitingAnswer] = useState(false);
  const [footerNotice, setFooterNotice] = useState<string | null>(null);
  const [nextHint, setNextHint] = useState<string | null>(null);
  // 移动端双 tab
  const [activeTab, setActiveTab] = useState<'dialogue' | 'panel'>('dialogue');

  const [pct, setPct] = useSplitPct('training-split-pct', 55);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setHydrated(true);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    setMessages(mapAttemptMessages(attempt, trainingCase, trainingProfile));
    setQuestionCount(attempt.question_count);
    setNextHint(extractNextHintFromAttempt(attempt));
  }, [attempt, trainingCase, trainingProfile]);

  // 优先使用后端返回的 coach_projection.next_hint；否则回退到本地建议追问。
  const suggestedQuestion =
    nextHint ?? trainingProfile.questions[questionCount % trainingProfile.questions.length];
  const isLocked = submittingSummary || !hydrated;
  const isWaiting = isWaitingAnswer || submittingQuestion;
  const canSendQuestion = input.trim().length > 0 && !isWaiting && !isLocked;
  const autoSummary = useMemo(
    () => buildAutoSummary(trainingCase, messages),
    [trainingCase, messages],
  );
  const canSubmitSummary = summaryReady && !isWaiting && !submittingSummary;

  useEffect(() => {
    if (questionCount <= 0 || isWaiting || submittingSummary) {
      setSummaryReady(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSummaryReady(true);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [questionCount, isWaiting, submittingSummary]);

  const fillSuggestedQuestion = () => {
    if (isWaiting || isLocked) return;
    setInput(suggestedQuestion);
  };

  const handleSendQuestion = async () => {
    const text = input.trim();
    if (!text || isWaiting || isLocked) return;
    if (!looksLikeTrainingQuestion(text)) {
      setFooterNotice('这句还不像一个追问。请换成一个能让对方回答的问题，例如“这个目标由谁确认？”');
      return;
    }

    const currentQuestionIndex = questionCount;
    const userMsg: TrainingMessage = {
      id: `user-${generateUUID()}`,
      role: 'user',
      content: text,
      bindings,
      created_at: new Date().toISOString(),
    };
    const waitingId = `ai-waiting-${generateUUID()}`;
    const waitingMsg: TrainingMessage = {
      id: waitingId,
      role: 'assistant',
      content: '对方正在回答。',
      created_at: new Date().toISOString(),
    };

    setSubmittingQuestion(true);
    setIsWaitingAnswer(true);
    setFooterNotice(null);
    setNextHint(null);
    setPendingJobId(null);
    setMessages((prev) => [...prev, userMsg, waitingMsg]);
    setInput('');
    setBindings([]);
    setQuestionCount((count) => count + 1);

    let finalJob: AiJob | null = null;
    try {
      if (isSampleAttempt) {
        await sleep(120);
        if (!mountedRef.current) return;
        const roleAnswer = getSampleRoleAnswer(trainingCase, currentQuestionIndex, text);
        const answerMsg: TrainingMessage = {
          id: `ai-${generateUUID()}`,
          role: 'assistant',
          speaker: 'role',
          content: roleAnswer,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => prev.map((m) => (m.id === waitingId ? answerMsg : m)));
        setNextHint(trainingProfile.questions[(currentQuestionIndex + 1) % trainingProfile.questions.length]);
        setFooterNotice(null);
        return;
      }

      const accepted = await getApiClient().postTrainingQuestion({
        attempt_id: attempt.attempt_id,
        question: text,
        bound_refs: bindings.map((binding) => ({
          ...binding,
          kind: 'training_case',
        })),
      });
      if (!mountedRef.current) return;
      setPendingJobId(accepted.job_id);

      finalJob = await pollJobUntilDone(accepted.job_id);
      if (!mountedRef.current) return;

      if (finalJob && finalJob.status === 'succeeded') {
        // 以服务端消息为准，保证刷新、返回重进和同一 job 结果完全一致。
        let refreshedAttempt: TrainingAttempt | null = null;
        try {
          refreshedAttempt = await getApiClient().getTrainingAttempt(attempt.attempt_id);
          if (!mountedRef.current) return;
        } catch {
          // 拉取失败时回退到 job.result
        }

        if (refreshedAttempt?.messages?.length) {
          setMessages(mapAttemptMessages(refreshedAttempt, trainingCase, trainingProfile));
          setQuestionCount(refreshedAttempt.question_count);
          const hint = extractNextHintFromAttempt(refreshedAttempt);
          if (hint) setNextHint(hint);
          setFooterNotice(null);
          return;
        }

        const roleAnswer = extractRoleAnswerFromJob(finalJob.result);
        const hint =
          extractNextHintFromAttempt(refreshedAttempt) ??
          extractNextHintFromJob(finalJob.result);
        if (hint) setNextHint(hint);

        const hasAnswer = !!roleAnswer && roleAnswer.trim().length > 0;
        const answerMsg: TrainingMessage = {
          id: `ai-${generateUUID()}`,
          role: 'assistant',
          content: hasAnswer ? roleAnswer! : '这次没有形成可用回答，请换成一个更具体的问题继续追问。',
          structured_content: hasAnswer
            ? undefined
            : {
                paragraphs: ['这次没有形成可用回答。'],
                bullets: ['可以换成一个更具体的问题', '也可以先使用当前建议追问'],
              },
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => prev.map((m) => (m.id === waitingId ? answerMsg : m)));
        if (refreshedAttempt) setQuestionCount(refreshedAttempt.question_count);
        setFooterNotice(null);
      } else {
        // 失败 / 取消 / 超时：移除等待态消息，保留用户消息，底部提示。
        setMessages((prev) => prev.filter((m) => m.id !== waitingId));
        setFooterNotice('这次回答没有生成成功，请稍后重试或返回练习情境页。');
      }
    } catch {
      if (!mountedRef.current) return;
      setMessages((prev) => prev.filter((m) => m.id !== waitingId));
      setFooterNotice('这次回答没有生成成功，请稍后重试或返回练习情境页。');
    } finally {
      if (mountedRef.current) {
        setSubmittingQuestion(false);
        setIsWaitingAnswer(false);
        setPendingJobId(null);
      }
    }
  };

  const handleSubmitSummary = async () => {
    const text = autoSummary.trim();
    if (!text || !canSubmitSummary) return;
    setSubmittingSummary(true);
    try {
      if (isSampleAttempt) {
        await sleep(120);
        onSummarySubmitted(
          `sample-feedback-${attempt.attempt_id}`,
          buildSampleFeedback(trainingCase, questionCount),
        );
        return;
      }
      const accepted = await getApiClient().postTrainingSummary({
        attempt_id: attempt.attempt_id,
        summary: text,
      });
      onSummarySubmitted(accepted.job_id);
    } catch {
      setSubmittingSummary(false);
    }
  };

  return (
    <div
      className="training-split-shell"
      style={{
        position: 'relative',
        height: '100vh',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header className="app-topbar" style={{ flexShrink: 0 }}>
        <div className="brand-mark" style={{ gap: 12 }}>
          <button
            type="button"
            className="app-nav-back"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            返回
          </button>
          <span
            aria-hidden="true"
            style={{ width: 1, height: 16, background: 'var(--aurora-hair-strong)' }}
          />
          <button
            type="button"
            className="brand-mark brand-home-link"
            onClick={() => router.push('/')}
            aria-label="返回首页"
          >
            <span className="dot" />
            <ProductBrandText />
          </button>
        </div>
        <div className="meta" style={{ gap: 8 }}>
          {isSampleAttempt && (
            <span className="app-chip app-chip-muted">
              参考练习
            </span>
          )}
        </div>
      </header>

      <div className="training-mobile-tabs" aria-label="练习视图切换">
        <button
          type="button"
          className={
            activeTab === 'dialogue'
              ? 'training-mobile-tab training-mobile-tab--active'
              : 'training-mobile-tab'
          }
          onClick={() => setActiveTab('dialogue')}
        >
          对话
        </button>
        <button
          type="button"
          className={
            activeTab === 'panel'
              ? 'training-mobile-tab training-mobile-tab--active'
              : 'training-mobile-tab'
          }
          onClick={() => setActiveTab('panel')}
        >
          练习助手
        </button>
      </div>

      <div
        className="training-split-main flex min-h-0 flex-1"
        style={{ minHeight: 0, overflow: 'hidden' }}
      >
        <section
          className={`training-split-pane training-split-dialogue flex min-w-0 flex-col ${
            activeTab !== 'dialogue' ? 'training-split-pane--mobile-hidden' : ''
          }`}
          style={{ width: `${pct}%`, minHeight: 0 }}
          aria-label="练习对话"
        >
          <header className="app-topbar" style={{ padding: '12px 20px' }}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar variant="ai" size={32} aria-hidden="true">
                助
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="app-label" style={{ marginBottom: 2 }}>
                  <span>{isSampleAttempt ? '参考练习 · 角色回应' : '追问练习 · 角色回应'}</span>
                </div>
                <div
                  className="app-title app-title-sm"
                  title={trainingCase.title}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {trainingCase.title}
                </div>
              </div>
            </div>
            <div
              className="app-chip app-chip-muted"
              aria-label={`已追问 ${questionCount} 次`}
            >
              已问 {questionCount}
            </div>
          </header>

          <div
            className="flex-1 overflow-y-auto px-4 py-4"
            style={{ background: 'transparent' }}
          >
            <div className="flex flex-col gap-3">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <footer
            className="training-split-footer"
            style={{
              borderTop: '1px solid var(--aurora-hair)',
              background: 'rgba(245, 241, 232, 0.72)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              padding: 12,
            }}
          >
            {footerNotice && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginBottom: 8,
                  padding: '6px 10px',
                  border: '1px solid rgba(160,108,108,0.30)',
                  background: 'rgba(160,108,108,0.10)',
                  color: 'var(--aurora-rose)',
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                {footerNotice}
              </div>
            )}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="app-chip app-chip-sage"
                onClick={fillSuggestedQuestion}
                disabled={isLocked || isWaiting}
                aria-busy={isWaiting || undefined}
              >
                填入追问
              </button>
              <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
                当前建议：{suggestedQuestion}
              </span>
            </div>

            <div className="inline-composer-field" style={{ minHeight: 82 }}>
              <textarea
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  if (footerNotice) setFooterNotice(null);
                }}
                placeholder="围绕当前建议追问；不确定时先填入追问。"
                disabled={isLocked}
                rows={2}
                className="app-textarea inline-composer-textarea"
                style={{ minHeight: 60, maxHeight: 160 }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void handleSendQuestion();
                  }
                }}
                aria-label="追问输入框"
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--aurora-muted)',
                }}
              >
                角色只回答已经问到的信息。
              </span>
              <button
                type="button"
                className="app-btn-primary"
                disabled={!canSendQuestion}
                onClick={() => void handleSendQuestion()}
                aria-busy={isWaiting || undefined}
                style={{ padding: '8px 14px', fontSize: 13 }}
              >
                <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                {isWaiting ? '发送中…' : '发送'}
              </button>
            </div>
            <button
              type="button"
              className="app-btn-primary training-mobile-feedback-action"
              disabled={!canSubmitSummary}
              onClick={() => void handleSubmitSummary()}
              aria-busy={submittingSummary || undefined}
            >
              <Sparkles
                className="h-4 w-4"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              {submittingSummary ? '正在生成反馈…' : '查看练习反馈'}
            </button>
          </footer>
        </section>

        <Splitter
          className="app-splitter"
          storageKey="training-split-pct"
          defaultPct={55}
          onChange={setPct}
        />

        <aside
          className={`training-split-pane training-split-panel flex min-w-0 flex-col ${
            activeTab !== 'panel' ? 'training-split-pane--mobile-hidden' : ''
          }`}
          style={{ flex: 1, minHeight: 0, background: 'transparent' }}
          aria-label="练习助手"
        >
          <header
            className="app-topbar"
            style={{ padding: '12px 20px', justifyContent: 'flex-start' }}
          >
            <GraduationCap
              className="h-4 w-4"
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: 'var(--aurora-gold)' }}
            />
            <span className="app-title app-title-sm">
              {isSampleAttempt ? '参考练习与总结' : '练习与总结'}
            </span>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-5">
              <section className="app-card">
                <button
                  type="button"
                  onClick={() => setBriefOpen((value) => !value)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '12px 16px',
                    fontFamily: 'inherit',
                  }}
                  aria-expanded={briefOpen}
                >
                  <span className="app-title app-title-sm">案例背景</span>
                  {briefOpen ? (
                    <ChevronUp
                      className="h-4 w-4"
                      strokeWidth={1.5}
                      aria-hidden="true"
                      style={{ color: 'var(--aurora-muted)' }}
                    />
                  ) : (
                    <ChevronDown
                      className="h-4 w-4"
                      strokeWidth={1.5}
                      aria-hidden="true"
                      style={{ color: 'var(--aurora-muted)' }}
                    />
                  )}
                </button>
                {briefOpen && (
                  <div
                    style={{
                      borderTop: '1px solid var(--aurora-hair)',
                      padding: '12px 16px',
                    }}
                  >
                    <p
                      style={{
                        fontSize: 13,
                        lineHeight: '1.65',
                        color: 'var(--aurora-ink-soft)',
                      }}
                    >
                      {trainingCase.description}
                    </p>
                    <div
                      className="mt-2 flex flex-wrap items-center gap-2"
                      style={{ marginTop: 8 }}
                    >
                      <span className="app-chip app-chip-muted">
                        {trainingCase.category}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-ibm-plex-mono), monospace',
                          fontSize: 11,
                          color: 'var(--aurora-muted)',
                        }}
                      >
                        {trainingCase.version === 'demo'
                          ? '参考案例'
                          : `第 ${trainingCase.version} 版`}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <section className="app-card app-card-pad">
                <div className="app-label" style={{ marginBottom: 8 }}>
                  当前练习目标
                </div>
                <p
                  style={{
                    color: 'var(--aurora-ink)',
                    fontSize: 14,
                    lineHeight: 1.7,
                  }}
                >
                  先用追问确认目标口径，再覆盖角色、场景和验收。你只需要按当前建议一步步练习。
                </p>
              </section>

              <section className="app-card app-card-pad">
                <div className="app-label" style={{ marginBottom: 8 }}>
                  已追问
                </div>
                <div
                  className="app-title app-title-lg"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  aria-label={`已追问 ${questionCount} 次`}
                >
                  {questionCount}
                </div>
                <p
                  style={{
                    marginTop: 6,
                    color: 'var(--aurora-muted)',
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  反馈会根据你问到的信息判断覆盖情况。
                </p>
              </section>

              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="app-title app-title-sm">系统整理</h2>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--aurora-muted)',
                      fontFamily: 'var(--font-ibm-plex-mono), monospace',
                    }}
                  >
                    可直接生成反馈
                  </span>
                </div>
                <div
                  className="app-card app-card-pad"
                  style={{
                    minHeight: 150,
                    background: 'rgba(255,255,255,0.34)',
                    whiteSpace: 'pre-wrap',
                    color: 'var(--aurora-ink-soft)',
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  {autoSummary}
                </div>
              </section>

              <section className="flex flex-col gap-2">
                {submittingSummary && (
                  <LongWaitProgress
                    compact
                    title="正在整理练习反馈"
                    description="会先核对你问到了哪些信息，再给出可改进的追问方式。"
                    steps={['读取追问', '核对覆盖', '整理建议', '生成反馈']}
                  />
                )}
                <button
                  type="button"
                  className="app-btn-primary"
                  style={{ width: '100%' }}
                  disabled={!canSubmitSummary}
                  onClick={() => void handleSubmitSummary()}
                  aria-busy={submittingSummary || undefined}
                >
                  <Sparkles
                    className="h-4 w-4"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  {submittingSummary ? '正在生成反馈…' : '查看练习反馈'}
                </button>
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--aurora-muted)',
                  }}
                >
                  反馈只用于本轮练习，不写入项目工作台。
                </p>
              </section>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: TrainingMessage }) {
  const isUser = message.role === 'user';
  const isWaiting = message.id.startsWith('ai-waiting-');
  const speakerLabel = isUser ? '我' : message.speaker === 'coach' ? '练习教练' : '扮演角色';
  return (
    <div
      className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
      style={{ animation: 'message-slide-in 200ms cubic-bezier(0,0,0.2,1)' }}
    >
      <div className="flex items-center gap-1.5">
        {!isUser && (
          <Avatar variant="ai" size={24} aria-hidden="true">
            助
          </Avatar>
        )}
        <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
          {speakerLabel}
        </span>
        {isUser && (
          <Avatar variant="user" size={24} aria-hidden="true">
            我
          </Avatar>
        )}
      </div>
      <div
        className="max-w-[88%] rounded-lg px-3 py-2"
        style={{
          background: isUser ? 'rgba(168,133,47,0.10)' : 'var(--aurora-card-bg)',
          border: isUser
            ? '1px solid rgba(168,133,47,0.22)'
            : '1px solid var(--aurora-card-border)',
          color: 'var(--aurora-ink)',
          boxShadow: isUser ? undefined : 'var(--aurora-shadow-soft)',
          opacity: isWaiting ? 0.78 : 1,
        }}
      >
        <div
          className={isUser ? 'inline-message-content' : 'flex flex-col gap-1'}
          style={{
            fontSize: 13,
            lineHeight: 1.65,
            color: 'var(--aurora-ink)',
          }}
        >
          {isUser && message.bindings?.map((binding) => (
            <span
              key={binding.id}
              className="inline-message-reference-token"
              title={`${binding.title} · ${binding.detail}`}
            >
              <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className="inline-reference-token__label">{binding.title}</span>
            </span>
          ))}
          {message.structured_content?.paragraphs ? (
            <>
              {message.structured_content.paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
              {message.structured_content.bullets &&
                message.structured_content.bullets.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {message.structured_content.bullets.map((bullet, index) => (
                      <li
                        key={index}
                        className="flex gap-1.5"
                        style={{
                          fontSize: 12,
                          color: 'var(--aurora-ink-soft)',
                        }}
                      >
                        <span aria-hidden="true">·</span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              {message.structured_content.highlights &&
                message.structured_content.highlights.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {message.structured_content.highlights.map((highlight, index) => (
                      <span
                        key={index}
                        className="app-chip"
                        style={{ padding: '2px 8px', fontSize: 11 }}
                      >
                        {highlight}
                      </span>
                    ))}
                  </div>
                )}
            </>
          ) : isWaiting ? (
            <LongWaitProgress
              compact
              title="对方正在回答"
              description="正在根据你的追问生成角色回应，请先不要重复发送。"
              steps={['理解追问', '代入角色', '生成回答', '给出提示']}
            />
          ) : (
            <span className={isUser ? 'inline-message-body' : undefined}>
              {message.content}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

