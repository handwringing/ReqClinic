'use client';

import { clsx } from 'clsx';
import {
  AlertTriangle,
  CheckCircle,
  Info,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface ToastOptions {
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

export interface ToastItem extends ToastOptions {
  id: number;
}

export interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (options: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastConfig {
  icon: LucideIcon;
  borderClass: string;
  iconClass: string;
  defaultDuration: number;
  ariaLive: 'polite' | 'assertive';
}

const toastConfig: Record<ToastType, ToastConfig> = {
  success: {
    icon: CheckCircle,
    borderClass: 'border-l-[var(--success-700)]',
    iconClass: 'text-[var(--success-700)]',
    defaultDuration: 4000,
    ariaLive: 'polite',
  },
  warning: {
    icon: AlertTriangle,
    borderClass: 'border-l-[var(--warning-700)]',
    iconClass: 'text-[var(--warning-700)]',
    defaultDuration: 4000,
    ariaLive: 'polite',
  },
  error: {
    icon: XCircle,
    borderClass: 'border-l-[var(--danger-700)]',
    iconClass: 'text-[var(--danger-700)]',
    defaultDuration: 6000,
    ariaLive: 'assertive',
  },
  info: {
    icon: Info,
    borderClass: 'border-l-[var(--info-700)]',
    iconClass: 'text-[var(--info-700)]',
    defaultDuration: 4000,
    ariaLive: 'polite',
  },
};

function ToastView({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const cfg = toastConfig[toast.type];
  const Icon = cfg.icon;
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef<number>(toast.duration ?? cfg.defaultDuration);
  const startRef = useRef<number>(0);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clear();
    startRef.current = Date.now();
    timerRef.current = window.setTimeout(
      () => onDismiss(toast.id),
      Math.max(0, remainingRef.current),
    );
  }, [clear, onDismiss, toast.id]);

  const pause = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startRef.current),
      );
    }
  }, []);

  useEffect(() => {
    start();
    return clear;
  }, [start, clear]);

  return (
    <div
      role="status"
      aria-live={cfg.ariaLive}
      className={clsx(
        'pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md border-l-4 bg-[var(--bg-surface)] p-3 shadow-overlay',
        cfg.borderClass,
      )}
      style={{ animation: 'toast-slide-in 200ms cubic-bezier(0, 0, 0.2, 1)' }}
      onMouseEnter={pause}
      onMouseLeave={start}
    >
      <Icon
        className={clsx('mt-0.5 h-5 w-5 shrink-0', cfg.iconClass)}
        strokeWidth={1.5}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {toast.title}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="关闭"
        className="shrink-0 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((options: ToastOptions) => {
    const id = (idRef.current += 1);
    setToasts((prev) => [...prev, { ...options, id }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismiss }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast 必须在 ToastProvider 内使用');
  }
  return ctx;
}