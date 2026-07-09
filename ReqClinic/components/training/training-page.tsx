'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiClient } from '@/lib/api';
import trainingCasesFixture from '@/fixtures/training/cases.json';
import { staticTrainingAttemptCase, trainingStaticAttemptId } from '@/lib/static-demo-ids';
import type {
  TrainingAttempt,
  TrainingCase,
  TrainingFeedback,
} from '@/lib/api/types';
import { ErrorState, LongWaitProgress } from '@/components/ui';
import { AppBackground } from '@/components/layout/app-background';
import { TrainingSplitPage } from './training-split-page';
import { TrainingFeedbackPage } from './training-feedback';

export interface TrainingPageProps {
  attemptId: string;
  routeSource?: string;
}

type LoadStatus = 'loading' | 'ready' | 'error';

const SPLIT_STATES: TrainingAttempt['status'][] = [
  'interviewing',
  'summarizing',
  'retrying',
];
const FEEDBACK_STATES: TrainingAttempt['status'][] = [
  'feedback_ready',
  'completed',
];

const TRAINING_FIXTURE_CASES = (trainingCasesFixture as { cases: TrainingCase[] }).cases;

function buildStaticTrainingInitial(attemptId: string): { attempt: TrainingAttempt; trainingCase: TrainingCase } | null {
  const caseId = staticTrainingAttemptCase(attemptId);
  const trainingCase = caseId
    ? TRAINING_FIXTURE_CASES.find((item) => item.id === caseId)
    : null;

  if (!caseId || !trainingCase) return null;

  return {
    attempt: {
      attempt_id: attemptId,
      case_id: trainingCase.id,
      case_version: trainingCase.version,
      source_kind: 'sample',
      status: 'interviewing',
      question_count: 0,
      started_at: '2026-07-07T00:00:00.000Z',
      completed_at: null,
    },
    trainingCase,
  };
}

function trainingSourceFromRoute(value?: string): TrainingAttempt['source_kind'] | undefined {
  if (value === 'sample' || value === 'custom') return value;
  return undefined;
}

export function TrainingPage({ attemptId, routeSource }: TrainingPageProps) {
  const router = useRouter();
  const routeSourceKind = trainingSourceFromRoute(routeSource);
  const staticInitial = buildStaticTrainingInitial(attemptId);
  const [attempt, setAttempt] = useState<TrainingAttempt | null>(staticInitial?.attempt ?? null);
  const [trainingCase, setTrainingCase] = useState<TrainingCase | null>(staticInitial?.trainingCase ?? null);
  const [feedback, setFeedback] = useState<TrainingFeedback | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(staticInitial ? 'ready' : 'loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [summarySubmitted, setSummarySubmitted] = useState(false);
  const [summaryJobId, setSummaryJobId] = useState<string | null>(null);

  // 初次挂载：拉取 attempt 与 case
  useEffect(() => {
    let cancelled = false;
    const staticInitial = buildStaticTrainingInitial(attemptId);
    setLoadStatus(staticInitial ? 'ready' : 'loading');
    setAttempt(staticInitial?.attempt ?? null);
    setTrainingCase(staticInitial?.trainingCase ?? null);
    setFeedback(null);
    setSummarySubmitted(false);
    setSummaryJobId(null);

    if (staticInitial) {
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const a = await getApiClient().getTrainingAttempt(attemptId);
        if (cancelled) return;
        const normalizedAttempt: TrainingAttempt = {
          ...a,
          source_kind: a.source_kind ?? routeSourceKind,
        };
        setAttempt(normalizedAttempt);
        const versionDetail = await getApiClient().getTrainingCaseVersion(normalizedAttempt.case_id, normalizedAttempt.case_version);
        if (cancelled) return;
        // 将版本详情映射为 TrainingCase 以保留展示字段。
        const c: TrainingCase = {
          id: versionDetail.case_id,
          title: versionDetail.title,
          category: versionDetail.category,
          difficulty: versionDetail.difficulty,
          version: versionDetail.case_version,
          description: versionDetail.description,
        };
        setTrainingCase(c);
        if (FEEDBACK_STATES.includes(normalizedAttempt.status)) {
          const fb = await getApiClient().getTrainingFeedback(attemptId);
          if (cancelled) return;
          setFeedback(fb);
        }
        setLoadStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : '加载练习失败');
        setLoadStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attemptId, routeSourceKind]);

  // summarizing 时轮询 job + attempt，直到反馈生成完成或失败。
  useEffect(() => {
    if (!summarySubmitted) return;
    if (!attempt) return;
    if (FEEDBACK_STATES.includes(attempt.status)) {
      // 已是反馈态：拉取反馈并停止轮询
      let cancelled = false;
      getApiClient()
        .getTrainingFeedback(attemptId)
        .then((fb) => {
          if (!cancelled) {
            setFeedback(fb);
            setSummarySubmitted(false);
            setSummaryJobId(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setErrorMsg(err instanceof Error ? err.message : '加载反馈失败');
            setSummarySubmitted(false);
            setSummaryJobId(null);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      try {
        if (summaryJobId) {
          const job = await getApiClient().getJobStatus(summaryJobId);
          if (cancelled) return;
          if (job.status === 'failed' || job.status === 'cancelled') {
            setErrorMsg('这次反馈没有生成成功，请回到练习稍后再试。');
            setSummarySubmitted(false);
            setSummaryJobId(null);
            return;
          }
        }
        const a = await getApiClient().getTrainingAttempt(attemptId);
        if (cancelled) return;
        setAttempt({
          ...a,
          source_kind: a.source_kind ?? routeSourceKind,
        });
      } catch {
        // 单次失败不中断轮询
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [summarySubmitted, attempt, attemptId, routeSourceKind, summaryJobId]);

  const handleSummarySubmitted = useCallback((jobId: string, localFeedback?: TrainingFeedback) => {
    if (localFeedback) {
      setFeedback(localFeedback);
      setAttempt((current) =>
        current ? { ...current, status: 'feedback_ready' } : current,
      );
      setSummarySubmitted(false);
      setSummaryJobId(null);
      return;
    }
    setSummaryJobId(jobId);
    setSummarySubmitted(true);
  }, []);

  const handleRetry = useCallback(async () => {
    if (!attempt) return;
    if (attempt.source_kind === 'sample' || attempt.case_version === 'demo') {
      const resetAttemptId = trainingStaticAttemptId(attempt.case_id);
      const resetInitial = buildStaticTrainingInitial(resetAttemptId);
      setFeedback(null);
      setSummarySubmitted(false);
      setSummaryJobId(null);
      setRetryCount((count) => count + 1);
      if (resetInitial) {
        setAttempt(resetInitial.attempt);
        setTrainingCase(resetInitial.trainingCase);
        setLoadStatus('ready');
      } else {
        setAttempt({
          ...attempt,
          attempt_id: resetAttemptId,
          status: 'interviewing',
          question_count: 0,
          completed_at: null,
        });
      }
      router.replace(`/training/${resetAttemptId}?reset=${Date.now()}`);
      return;
    }
    // 创建同案例的新尝试并跳转
    const created = await getApiClient().createTrainingAttempt({
      case_id: attempt.case_id,
      case_version: attempt.case_version,
      source_kind: attempt.source_kind ?? 'sample',
    });
    router.push(`/training/${created.attempt_id}?source=${attempt.source_kind ?? 'sample'}`);
  }, [attempt, router]);

  const handleComplete = useCallback(async () => {
    if (!attempt) return;
    // 标记当前尝试为已完成，随后返回案例选择页
    await getApiClient().completeTrainingAttempt({
      attempt_id: attempt.attempt_id,
    });
    router.push('/training/cases');
  }, [attempt, router]);

  if (loadStatus === 'loading') {
    return (
      <div className="app-content" style={{ minHeight: '100vh' }}>
        <AppBackground />
        <div className="app-state-box" style={{ minHeight: '100vh' }}>
          <LongWaitProgress
            title="正在打开练习"
            description="正在准备练习情境和训练记录。"
            steps={['读取情境', '恢复对话', '准备建议']}
          />
        </div>
      </div>
    );
  }

  if (loadStatus === 'error' || !attempt || !trainingCase) {
    return (
      <div className="app-content" style={{ minHeight: '100vh' }}>
        <AppBackground />
        <ErrorState
          title="加载失败"
          description={errorMsg ?? undefined}
          onRetry={() => {
            setLoadStatus('loading');
            // 触发重新挂载通过 attemptId 变化或重置状态
            window.location.reload();
          }}
        />
      </div>
    );
  }

  if (FEEDBACK_STATES.includes(attempt.status)) {
    if (!feedback) {
      return (
        <div className="app-content" style={{ minHeight: '100vh' }}>
          <AppBackground />
          <div className="app-state-box" style={{ minHeight: '100vh' }}>
            <LongWaitProgress
              title="正在整理反馈"
              description="教练正在根据本轮追问判断覆盖情况，并准备改写示例。"
              steps={['读取追问', '检查覆盖', '生成建议', '整理反馈']}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="app-content">
        <AppBackground />
        <TrainingFeedbackPage
          attempt={attempt}
          feedback={feedback}
          onRetry={handleRetry}
          onComplete={handleComplete}
        />
      </div>
    );
  }

  if (SPLIT_STATES.includes(attempt.status)) {
    return (
      <div className="app-content">
        <AppBackground />
        <TrainingSplitPage
          key={`split-${attemptId}-${retryCount}`}
          attempt={attempt}
          trainingCase={trainingCase}
          onSummarySubmitted={handleSummarySubmitted}
        />
      </div>
    );
  }

  // 兜底：未知状态
  return (
    <div className="app-content" style={{ minHeight: '100vh' }}>
      <AppBackground />
      <ErrorState
        title="练习状态暂时无法识别"
        description="请返回练习情境页重新选择，或稍后重试。"
      />
    </div>
  );
}
