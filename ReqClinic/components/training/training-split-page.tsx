'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import { ModelUnavailableDialog } from '@/components/common/model-unavailable-dialog';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  ListChecks,
  Send,
  Sparkles,
} from 'lucide-react';
import { getApiClient } from '@/lib/api';
import { useModelApiGate } from '@/lib/use-model-api-gate';
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
import {
  buildTrainingSampleFeedback,
  buildTrainingSampleSummary,
  getTrainingSampleNextHint,
  getTrainingSampleProfile,
  resolveTrainingSampleTurn,
  type TrainingSampleProfile,
} from '@/lib/training-sample-engine';

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






function isTrainingSampleAttempt(
  attempt: TrainingAttempt | null,
  trainingCase: TrainingCase,
): boolean {
  return attempt?.source_kind === 'sample' ||
    trainingCase.version === 'demo' ||
    trainingCase.id.startsWith('demo-training');
}

function createInitialAssistantMessage(
  trainingCase: TrainingCase,
  trainingProfile: TrainingSampleProfile,
  isSampleAttempt: boolean,
): TrainingMessage {
  return {
    id: `ai-init-${generateUUID()}`,
    role: 'assistant',
    speaker: 'coach',
    content: trainingCase.description,
    structured_content: {
      paragraphs: [
        trainingCase.description,
        isSampleAttempt
          ? `这轮重点是${trainingProfile.focus}。请从预设追问中选择一项，角色会按案例信息继续回答。`
          : `这轮重点是${trainingProfile.focus}。可以从建议问题开始，也可以直接问你认为最关键的事。`,
      ],
      highlights: [isSampleAttempt ? '案例演示' : '练习重点'],
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
  trainingProfile: TrainingSampleProfile,
): TrainingMessage[] {
  const rows = attempt?.messages ?? [];
  if (!rows.length) {
    return [
      createInitialAssistantMessage(
        trainingCase,
        trainingProfile,
        isTrainingSampleAttempt(attempt, trainingCase),
      ),
    ];
  }
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
    () => getTrainingSampleProfile(trainingCase),
    [trainingCase],
  );
  const isSampleAttempt = isTrainingSampleAttempt(attempt, trainingCase);
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

  const userQuestions = useMemo(
    () => messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content.trim())
      .filter(Boolean),
    [messages],
  );
  // 优先使用后端返回的 coach_projection.next_hint；示例则根据尚未覆盖的语义维度推荐下一问。
  const suggestedQuestion = nextHint ?? getTrainingSampleNextHint(trainingCase, userQuestions);
  const remainingSampleQuestions = useMemo(
    () => trainingProfile.questions.filter((question) => !userQuestions.includes(question)),
    [trainingProfile.questions, userQuestions],
  );
  const completedSampleQuestionCount = trainingProfile.questions.length - remainingSampleQuestions.length;
  const isLocked = submittingSummary || !hydrated;
  const isWaiting = isWaitingAnswer || submittingQuestion;
  const canSendQuestion = input.trim().length > 0 && !isWaiting && !isLocked;
  const autoSummary = useMemo(
    () => buildTrainingSampleSummary(trainingCase, userQuestions),
    [trainingCase, userQuestions],
  );
  const canSubmitSummary = summaryReady && !isWaiting && !submittingSummary;
  const { modelDialogOpen, requireModelApi, dismissModelDialog } = useModelApiGate({
    skip: isSampleAttempt,
  });

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

  const handleSendQuestion = async (presetQuestion?: string) => {
    const text = (presetQuestion ?? input).trim();
    if (!text || isWaiting || isLocked) return;
    if (isSampleAttempt && (!presetQuestion || !trainingProfile.questions.includes(text))) return;
    if (!looksLikeTrainingQuestion(text)) {
      setFooterNotice('这句还不像一个追问。请换成一个能让对方回答的问题，例如“这个目标由谁确认？”');
      return;
    }
    if (!(await requireModelApi())) return;

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
        const sampleTurn = resolveTrainingSampleTurn(trainingCase, text, userQuestions);
        const answerMsg: TrainingMessage = {
          id: `ai-${generateUUID()}`,
          role: 'assistant',
          speaker: 'role',
          content: sampleTurn.answer,
          structured_content: {
            paragraphs: [sampleTurn.answer],
            highlights: sampleTurn.dimensionLabel
              ? [
                  sampleTurn.dimensionLabel,
                  `已覆盖 ${sampleTurn.coveredCount}/${sampleTurn.totalDimensions}`,
                ]
              : ['需要换一个追问方向'],
          },
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => prev.map((m) => (m.id === waitingId ? answerMsg : m)));
        setNextHint(sampleTurn.nextHint);
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
    if (!(await requireModelApi())) return;
    setSubmittingSummary(true);
    try {
      if (isSampleAttempt) {
        await sleep(120);
        onSummarySubmitted(
          `sample-feedback-${attempt.attempt_id}`,
          buildTrainingSampleFeedback(trainingCase, userQuestions),
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
    <>
    <div
      className="training-split-shell page-motion-shell"
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
              案例演示
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
        className="training-split-main page-motion-stage flex min-h-0 flex-1"
        style={{ minHeight: 0, overflow: 'hidden' }}
      >
        <section
          className={`training-split-pane training-split-dialogue page-motion-panel--left flex min-w-0 flex-col ${
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
                  <span>{isSampleAttempt ? '案例演示 · 角色回应' : '追问练习 · 角色回应'}</span>
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
            {isSampleAttempt ? (
              <div className="training-sample-composer" aria-label="案例预设追问">
                <div className="training-sample-composer__head">
                  <span>
                    <ListChecks size={14} strokeWidth={1.5} aria-hidden="true" />
                    选择下一条追问
                  </span>
                  <small>
                    {completedSampleQuestionCount} / {trainingProfile.questions.length}
                  </small>
                </div>
                {remainingSampleQuestions.length > 0 ? (
                  <div className="training-sample-question-list">
                    {remainingSampleQuestions.slice(0, 3).map((question) => (
                      <button
                        key={question}
                        type="button"
                        className="training-sample-question"
                        disabled={isLocked || isWaiting}
                        onClick={() => void handleSendQuestion(question)}
                        aria-busy={isWaiting || undefined}
                      >
                        <span>{question}</span>
                        <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="training-sample-composer__complete" role="status">
                    <CheckCircle2 size={15} strokeWidth={1.5} aria-hidden="true" />
                    预设追问已完成，可以查看本轮反馈。
                  </div>
                )}
              </div>
            ) : (
              <>
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
                  <span
                    key={`${questionCount}-${suggestedQuestion}`}
                    className="page-motion-question text-[11px]"
                    style={{ color: 'var(--aurora-muted)' }}
                  >
                    可以继续问：{suggestedQuestion}
                  </span>
                </div>

                <div className="inline-composer-field" style={{ minHeight: 82 }}>
                  <textarea
                    value={input}
                    onChange={(event) => {
                      setInput(event.target.value);
                      if (footerNotice) setFooterNotice(null);
                    }}
                    placeholder="直接输入你的追问；拿不准时可以使用上方建议。"
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
              </>
            )}
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
          className={`training-split-pane training-split-panel page-motion-panel--right flex min-w-0 flex-col ${
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
              {isSampleAttempt ? '案例演示与总结' : '练习与总结'}
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
                        {isSampleAttempt ? '演示案例' : `第 ${trainingCase.version} 版`}
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
                  {isSampleAttempt
                    ? '从预设追问中选择下一步。不同选择顺序会形成不同的信息覆盖和反馈。'
                    : '可以从任何关键问题开始。对方只披露你真正问到的信息，反馈按实际覆盖生成。'}
                </p>
              </section>

              <section className="app-card app-card-pad">
                <div className="app-label" style={{ marginBottom: 8 }}>
                  已追问
                </div>
                <div
                  key={`question-count-${questionCount}`}
                  className="app-title app-title-lg page-motion-question"
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
                  key={`${questionCount}-${autoSummary}`}
                  className="app-card app-card-pad page-motion-stage"
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
      <ModelUnavailableDialog
        open={modelDialogOpen}
        title="暂时不能继续训练"
        description="当前模型服务不可用，暂时不能生成新的角色回答或练习反馈。你已输入的内容会保留，服务恢复后可以直接重试。"
        onDismiss={dismissModelDialog}
      />
    </>
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

