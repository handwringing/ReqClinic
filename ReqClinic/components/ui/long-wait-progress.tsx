'use client';

import { CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';

export interface LongWaitProgressProps {
  title: string;
  description?: string;
  steps?: string[];
  compact?: boolean;
  className?: string;
}

const DEFAULT_STEPS = ['接收内容', '整理重点', '生成回复', '检查一致性'];

function estimateProgress(elapsedMs: number): number {
  if (elapsedMs < 1200) return 12;
  if (elapsedMs < 5000) return 28;
  if (elapsedMs < 12000) return 46;
  if (elapsedMs < 24000) return 64;
  if (elapsedMs < 42000) return 78;
  return 88;
}

export function LongWaitProgress({
  title,
  description,
  steps = DEFAULT_STEPS,
  compact = false,
  className,
}: LongWaitProgressProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 700);
    return () => window.clearInterval(timer);
  }, []);

  const progress = estimateProgress(elapsedMs);
  const activeIndex = useMemo(() => {
    if (steps.length <= 1) return 0;
    const ratio = Math.min(0.98, progress / 100);
    return Math.min(steps.length - 1, Math.floor(ratio * steps.length));
  }, [progress, steps.length]);

  return (
    <div
      className={clsx('long-wait-progress', compact && 'long-wait-progress--compact', className)}
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="long-wait-progress__head">
        <Loader2 className="long-wait-progress__spinner" strokeWidth={1.6} aria-hidden="true" />
        <div className="long-wait-progress__copy">
          <strong>{title}</strong>
          {description && <span>{description}</span>}
        </div>
        <span className="long-wait-progress__percent" aria-hidden="true">
          {progress}%
        </span>
      </div>
      <div
        className="long-wait-progress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      {steps.length > 0 && (
        <div className="long-wait-progress__steps" aria-label="当前处理步骤">
          {steps.map((step, index) => {
            const done = index < activeIndex;
            const active = index === activeIndex;
            return (
              <span
                key={`${step}-${index}`}
                className={clsx(
                  'long-wait-progress__step',
                  done && 'long-wait-progress__step--done',
                  active && 'long-wait-progress__step--active',
                )}
              >
                {done ? (
                  <CheckCircle2 size={12} strokeWidth={1.7} aria-hidden="true" />
                ) : active ? (
                  <Loader2 size={12} strokeWidth={1.7} aria-hidden="true" />
                ) : (
                  <CircleDashed size={12} strokeWidth={1.7} aria-hidden="true" />
                )}
                {step}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
