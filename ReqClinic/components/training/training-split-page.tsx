'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  GraduationCap,
  Send,
  Sparkles,
  X,
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
  '你们说提升转化率时，具体用哪个指标判断？',
  '这个目标主要由谁确认，谁会在日常流程里受到影响？',
  '如果第一版只能做一个场景，最应该覆盖哪一个？',
  '什么结果出现时，你们会认为这个需求已经达成？',
];

interface TrainingProfile {
  focus: string;
  questions: string[];
}

const SAMPLE_ROLE_ANSWERS: Record<string, string[]> = {
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
  const covered = Math.min(0.88, 0.42 + questionCount * 0.14);
  const isCreative = trainingCase.category === '创意简报';
  return {
    coverage_score: covered,
    missing_dimensions:
      questionCount >= 4
        ? ['后续变化处理']
        : ['边界限制', '验收口径'],
    improvement_suggestions: isCreative
      ? [
          '继续追问渠道尺寸、禁用表达和最终审核人。',
          '把“好看”改成可检查的完成标准，例如核心卖点几秒内能读懂。',
        ]
      : [
          '继续追问限制条件和最终确认人。',
          '把模糊目标改成可观察的完成标准。',
        ],
    dimension_breakdown: [
      {
        dimension: '目标',
        status: questionCount >= 1 ? 'covered' : 'partial',
        evidence: questionCount >= 1 ? '已开始追问目标或用途。' : '还需要先确认目标。',
        comment: '先确认为什么要做，后续范围才不会发散。',
      },
      {
        dimension: '对象',
        status: questionCount >= 2 ? 'covered' : 'partial',
        evidence: questionCount >= 2 ? '已追问目标用户或确认人。' : '对象和确认人还不够清楚。',
        comment: '对象不同，方案和验收标准会明显不同。',
      },
      {
        dimension: '边界',
        status: questionCount >= 4 ? 'covered' : 'missing',
        evidence: questionCount >= 4 ? '已追问限制、禁用项或范围。' : '还没有充分追问限制条件。',
        comment: '边界决定哪些承诺不能轻易写进需求。',
      },
      {
        dimension: '验收',
        status: questionCount >= 3 ? 'partial' : 'missing',
        evidence: questionCount >= 3 ? '已有完成口径线索，但还可更量化。' : '还缺少可判断完成的标准。',
        comment: '验收标准越具体，后续沟通成本越低。',
      },
    ],
    improvement_examples: [
      {
        before: '你想做什么风格？',
        after: isCreative
          ? '这组海报主要投放在哪里，必须避开哪些功效或素材表达？'
          : '第一版必须覆盖哪个场景，哪些内容明确不做？',
        reason: '从泛泛偏好转成场景和边界追问。',
      },
      {
        before: '这样可以吗？',
        after: '什么结果出现时，你会认为这次需求已经完成？',
        reason: '把确认式问题改成可验收标准追问。',
      },
    ],
  };
}

function createInitialAssistantMessage(
  trainingCase: TrainingCase,
  trainingProfile: TrainingProfile,
): TrainingMessage {
  return {
    id: `ai-init-${generateUUID()}`,
    role: 'assistant',
    content: trainingCase.description,
    structured_content: {
      paragraphs: [
        trainingCase.description,
        `先围绕${trainingProfile.focus}追问。下方会给出当前建议追问，你也可以引用案例背景后再发送。`,
      ],
      highlights: ['当前建议追问', '案例背景'],
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
  const caseBinding = useMemo<TrainingBinding>(
    () => ({
      id: 'training-case-brief',
      title: '案例背景',
      detail: trainingCase.title,
    }),
    [trainingCase.title],
  );
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
  const isLocked = submittingSummary;
  const isWaiting = isWaitingAnswer || submittingQuestion;
  const canSendQuestion = input.trim().length > 0 && !isWaiting && !isLocked;
  const autoSummary = useMemo(
    () => buildAutoSummary(trainingCase, messages),
    [trainingCase, messages],
  );
  const canSubmitSummary = questionCount > 0 && !isWaiting && !submittingSummary;

  const addBinding = (binding: TrainingBinding) => {
    setBindings((prev) => [...prev.filter((item) => item.id !== binding.id), binding]);
  };

  const removeBinding = (id: string) => {
    setBindings((prev) => prev.filter((item) => item.id !== id));
  };

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
              <button
                type="button"
                className="app-chip"
                onClick={() => addBinding(caseBinding)}
                disabled={isLocked || isWaiting}
                title={caseBinding.detail}
              >
                <FileText className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                引用案例背景
              </button>
              <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
                当前建议：{suggestedQuestion}
              </span>
            </div>

            <div className="inline-composer-field" style={{ minHeight: 82 }}>
              {bindings.map((binding) => (
                <span
                  key={binding.id}
                  className="inline-reference-token"
                  title={`${binding.title} · ${binding.detail}`}
                >
                  <FileText className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  <span className="inline-reference-token__label">{binding.title}</span>
                  <button
                    type="button"
                    className="inline-reference-token__remove"
                    aria-label={`移除 ${binding.title}`}
                    onClick={() => removeBinding(binding.id)}
                  >
                    <X className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </span>
              ))}
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
                      <button
                        type="button"
                        className="app-chip"
                        onClick={() => addBinding(caseBinding)}
                        disabled={isLocked || isWaiting}
                      >
                        引用到输入框
                      </button>
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

