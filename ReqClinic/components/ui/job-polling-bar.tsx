'use client';

import { clsx } from 'clsx';
import {
  CheckCircle,
  Clock,
  Loader2,
  MinusCircle,
  User,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './button';

export type JobStatusType =
  | 'queued'
  | 'running'
  | 'validating'
  | 'retry_wait'
  | 'manual_review'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface JobStatusResult {
  status: JobStatusType;
  progress?: number;
  current_step?: string;
  error?: string;
  result?: unknown;
}

export interface JobPollingBarProps {
  jobId: string;
  /** 轮询回调，组件独立于具体 API 客户端 */
  onPoll: (jobId: string) => Promise<JobStatusResult>;
  onComplete?: (result: unknown) => void;
  onCancel?: () => void;
  onFail?: (error: string) => void;
  onRetry?: () => void;
  /** queued/running 时是否显示取消按钮，默认 true */
  cancelable?: boolean;
  className?: string;
}

const BACKOFF = [2000, 4000, 8000, 16000, 30000];

const labelMap: Record<JobStatusType, string> = {
  queued: '排队中',
  running: '处理中…',
  validating: '校验中…',
  retry_wait: '等待重试…',
  manual_review: '需人工处理',
  succeeded: '完成',
  failed: '失败',
  cancelled: '已取消',
};

function StatusIcon({ status }: { status: JobStatusType }) {
  switch (status) {
    case 'queued':
      return <span className="h-2.5 w-2.5 rounded-full bg-[var(--job-queued)]" />;
    case 'running':
      return (
        <Loader2
          className="h-4 w-4 animate-spin text-[var(--job-running)]"
          strokeWidth={1.5}
        />
      );
    case 'validating':
      return (
        <Loader2
          className="h-4 w-4 animate-spin text-[var(--job-validating)]"
          strokeWidth={1.5}
        />
      );
    case 'retry_wait':
      return (
        <Clock
          className="h-4 w-4 text-[var(--job-retry-wait)]"
          strokeWidth={1.5}
        />
      );
    case 'manual_review':
      return (
        <User
          className="h-4 w-4 text-[var(--job-manual-review)]"
          strokeWidth={1.5}
        />
      );
    case 'succeeded':
      return (
        <CheckCircle
          className="h-4 w-4 text-[var(--job-succeeded)]"
          strokeWidth={1.5}
        />
      );
    case 'failed':
      return (
        <XCircle
          className="h-4 w-4 text-[var(--job-failed)]"
          strokeWidth={1.5}
        />
      );
    case 'cancelled':
      return (
        <MinusCircle
          className="h-4 w-4 text-[var(--job-cancelled)]"
          strokeWidth={1.5}
        />
      );
  }
}
export function JobPollingBar({
  jobId,
  onPoll,
  onComplete,
  onCancel,
  onFail,
  onRetry,
  cancelable = true,
  className,
}: JobPollingBarProps) {
  const [status, setStatus] = useState<JobStatusType>('queued');
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [currentStep, setCurrentStep] = useState<string | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);
  const [faded, setFaded] = useState(false);

  const backoffIdx = useRef(0);
  const errorCount = useRef(0);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const completedRef = useRef(false);

  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (cancelledRef.current || completedRef.current) return;
    try {
      const res = await onPollRef.current(jobId);
      if (cancelledRef.current) return;
      errorCount.current = 0;
      setStatus(res.status);
      setProgress(res.progress);
      setCurrentStep(res.current_step);

      if (res.status === 'succeeded') {
        completedRef.current = true;
        onCompleteRef.current?.(res.result);
        window.setTimeout(() => setFaded(true), 1500);
        return;
      }
      if (res.status === 'failed') {
        completedRef.current = true;
        setErrorMsg(res.error);
        onFailRef.current?.(res.error ?? '任务失败');
        return;
      }
      if (res.status === 'cancelled') {
        completedRef.current = true;
        return;
      }
      const delay = BACKOFF[Math.min(backoffIdx.current, BACKOFF.length - 1)];
      backoffIdx.current = Math.min(backoffIdx.current + 1, BACKOFF.length - 1);
      timerRef.current = window.setTimeout(poll, delay);
    } catch (err) {
      if (cancelledRef.current) return;
      errorCount.current += 1;
      if (errorCount.current >= 3) {
        const msg = err instanceof Error ? err.message : '网络错误';
        setStatus('failed');
        setErrorMsg(msg);
        completedRef.current = true;
        onFailRef.current?.(msg);
        return;
      }
      const delay = BACKOFF[Math.min(backoffIdx.current, BACKOFF.length - 1)];
      timerRef.current = window.setTimeout(poll, delay);
    }
  }, [jobId]);

  useEffect(() => {
    cancelledRef.current = false;
    completedRef.current = false;
    backoffIdx.current = 0;
    errorCount.current = 0;
    setFaded(false);
    setErrorMsg(undefined);
    setStatus('queued');
    timerRef.current = window.setTimeout(poll, 0);

    const handleVisibility = () => {
      if (document.hidden) {
        clearTimer();
      } else if (!cancelledRef.current && !completedRef.current) {
        backoffIdx.current = 0;
        clearTimer();
        timerRef.current = window.setTimeout(poll, 0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      cancelledRef.current = true;
      clearTimer();
    };
  }, [poll, clearTimer]);

  const handleCancel = () => {
    cancelledRef.current = true;
    clearTimer();
    setStatus('cancelled');
    onCancelRef.current?.();
  };

  const handleRetry = () => {
    if (onRetryRef.current) {
      onRetryRef.current();
      return;
    }
    cancelledRef.current = false;
    completedRef.current = false;
    errorCount.current = 0;
    backoffIdx.current = 0;
    setFaded(false);
    setErrorMsg(undefined);
    setStatus('queued');
    clearTimer();
    timerRef.current = window.setTimeout(poll, 0);
  };

  const showProgress =
    (status === 'running' || status === 'validating') &&
    typeof progress === 'number';
  const progressPct =
    typeof progress === 'number' ? Math.min(100, Math.max(0, progress)) : 0;

  return (
    <div
      className={clsx(
        'flex h-10 items-center gap-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 transition-opacity duration-slow',
        faded && 'pointer-events-none opacity-0',
        className,
      )}
    >
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-sm text-[var(--text-primary)]"
            title={errorMsg && status === 'failed' ? errorMsg : undefined}
          >
            {labelMap[status]}
          </span>
          {currentStep && (
            <span className="truncate text-xs text-[var(--text-tertiary)]">
              · {currentStep}
            </span>
          )}
        </div>
        {showProgress && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--slate-200)]">
            <div
              className="h-full bg-[var(--accent-500)] transition-[width] duration-normal"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>
      {cancelable && (status === 'queued' || status === 'running') && (
        <Button variant="ghost" size="compact" onClick={handleCancel}>
          取消
        </Button>
      )}
      {status === 'failed' && (
        <Button variant="secondary" size="compact" onClick={handleRetry}>
          重试
        </Button>
      )}
    </div>
  );
}