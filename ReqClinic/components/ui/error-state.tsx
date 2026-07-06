'use client';

import { clsx } from 'clsx';
import { AlertOctagon, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  requestId?: string;
  onRetry?: () => void;
  retryText?: string;
  icon?: LucideIcon;
  className?: string;
  children?: ReactNode;
}

function normalizeErrorDescription(description?: string): string | undefined {
  if (!description) return description;
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(description)) {
    return '当前服务暂时连接不上，请确认本地服务已启动后再重试。';
  }
  return description;
}

export function ErrorState({
  title = '加载失败',
  description,
  requestId,
  onRetry,
  retryText = '重试',
  icon: Icon = AlertOctagon,
  className,
  children,
}: ErrorStateProps) {
  const safeDescription = normalizeErrorDescription(description);

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center px-6 py-10 text-center',
        className,
      )}
    >
      <Icon className="mb-3 h-12 w-12 text-[var(--danger-700)]" strokeWidth={1.5} />
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      {safeDescription && (
        <p className="mt-1 max-w-sm text-sm text-[var(--text-secondary)]">
          {safeDescription}
        </p>
      )}
      {requestId && (
        <p
          className="mt-2 text-xs text-[var(--text-tertiary)]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {requestId}
        </p>
      )}
      {onRetry && (
        <Button
          variant="primary"
          size="regular"
          onClick={onRetry}
          leftIcon={RefreshCw}
          className="mt-4"
        >
          {retryText}
        </Button>
      )}
      {children}
    </div>
  );
}
