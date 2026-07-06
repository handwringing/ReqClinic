'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface LoadingStateProps {
  isLoading: boolean;
  children: ReactNode;
  fallback?: ReactNode;
  delayMessage?: string;
  /** 低于该时长（毫秒）不显示任何东西，默认 500ms */
  delay?: number;
  /** 超过该时长（毫秒）显示进度文案，默认 2000ms */
  slowThreshold?: number;
}

export function LoadingState({
  isLoading,
  children,
  fallback = null,
  delayMessage,
  delay = 500,
  slowThreshold = 2000,
}: LoadingStateProps) {
  const [showFallback, setShowFallback] = useState(false);
  const [showMessage, setShowMessage] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowFallback(false);
      setShowMessage(false);
      return;
    }
    const t1 = window.setTimeout(() => setShowFallback(true), delay);
    const t2 = window.setTimeout(() => setShowMessage(true), slowThreshold);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isLoading, delay, slowThreshold]);

  if (!isLoading) return <>{children}</>;
  if (!showFallback) return null;
  if (showMessage && delayMessage) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        {fallback}
        <p className="text-sm text-[var(--text-tertiary)]">{delayMessage}</p>
      </div>
    );
  }
  return <>{fallback}</>;
}