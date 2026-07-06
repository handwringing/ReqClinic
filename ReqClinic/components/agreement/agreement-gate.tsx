'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { getApiClient } from '@/lib/api';
import { ApiClientError, ErrorCodes } from '@/lib/api/errors';
import type { Agreement, AgreementConsent, GuestSession } from '@/lib/api/types';
import { AgreementDialog } from './agreement-dialog';
import { AgreementHistoryDialog } from './agreement-history-dialog';

type Scope = 'quick' | 'formal' | 'training';

interface AgreementGateContextValue {
  /** 当前作用域下是否已完成同意 */
  hasConsented: boolean;
  /** 当前协议 */
  agreement: Agreement | null;
  /** 当前游客会话 */
  guestSession: GuestSession | null;
  /** 是否正在加载初始状态 */
  loading: boolean;
  /** 打开协议正文 + 同意对话框（首次同意或重新同意） */
  requireConsent: (reason?: 'initial' | 'updated') => void;
  /** 打开历史同意记录对话框（含撤回入口） */
  openHistory: () => void;
  /** 包装 API 调用：捕获 AGREEMENT_REQUIRED 并自动弹出重新同意对话框 */
  guard: <T>(fn: () => Promise<T>) => Promise<T>;
}

const AgreementGateContext = createContext<AgreementGateContextValue | null>(null);

export function useAgreementGate(): AgreementGateContextValue {
  const ctx = useContext(AgreementGateContext);
  if (!ctx) {
    throw new Error('useAgreementGate 必须在 AgreementGate 内部使用');
  }
  return ctx;
}

/** 根据路径推断协议作用域 */
function scopeFromPathname(pathname: string | null): Scope {
  if (!pathname) return 'quick';
  if (pathname.startsWith('/formal')) return 'formal';
  if (pathname.startsWith('/training')) return 'training';
  return 'quick';
}

/** 持久化键：记录每个 scope 最近一次有效同意的 consent_id，用于刷新后快速判定 */
function consentStorageKey(scope: Scope): string {
  return `reqclinic:consent:${scope}`;
}

function rememberConsent(scope: Scope, consentId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(consentStorageKey(scope), consentId);
}

function forgetConsent(scope: Scope): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(consentStorageKey(scope));
}

export interface AgreementGateProps {
  children: ReactNode;
}

export function AgreementGate({ children }: AgreementGateProps) {
  const pathname = usePathname();
  const scope = scopeFromPathname(pathname);

  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
  const [activeConsent, setActiveConsent] = useState<AgreementConsent | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogReason, setDialogReason] = useState<'initial' | 'updated'>('initial');
  const [historyOpen, setHistoryOpen] = useState(false);

  // 用于在 guard 中复用最近的 Idempotency-Key（重试时复用）
  const idempotencyKeyRef = useRef<string | null>(null);

  // 初次加载：恢复/创建游客会话 → 拉取协议 → 校验已有同意
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      try {
        const api = getApiClient();
        // 1. 恢复或签发游客会话
        let session: GuestSession | null = null;
        try {
          session = await api.getCurrentGuestSession();
        } catch {
          // 401 → 创建新游客会话
          session = await api.createGuestSession({});
        }
        if (cancelled) return;
        setGuestSession(session);

        // 2. 获取当前生效协议
        const agr = await api.getActiveAgreement({ scope });
        if (cancelled) return;
        setAgreement(agr);

        // 3. 校验已有同意：列表中查找本 scope 下未撤回且版本匹配的记录
        const list = await api.listAgreementConsents({ scope, limit: 50, offset: 0 });
        if (cancelled) return;
        const valid = list.items.find(
          (c) => !c.withdrawn_at && c.agreement_version === agr.version,
        ) ?? null;
        setActiveConsent(valid);
        if (valid) {
          rememberConsent(scope, valid.id);
        } else {
          forgetConsent(scope);
          // 首次进入且未同意 → 弹出协议
          setDialogReason('initial');
          setDialogOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const requireConsent = useCallback((reason: 'initial' | 'updated' = 'initial') => {
    setDialogReason(reason);
    setDialogOpen(true);
  }, []);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
  }, []);

  const handleAccepted = useCallback(
    (consent: AgreementConsent) => {
      setActiveConsent(consent);
      rememberConsent(scope, consent.id);
      setDialogOpen(false);
    },
    [scope],
  );

  // 撤回成功后：清除本地状态，并重新弹出协议（撤回后不可继续使用）
  const handleWithdrawn = useCallback(
    (consentId: string) => {
      if (activeConsent?.id === consentId) {
        setActiveConsent(null);
        forgetConsent(scope);
      }
      setHistoryOpen(false);
      setDialogReason('initial');
      setDialogOpen(true);
    },
    [activeConsent, scope],
  );

  // guard：包装 API 调用，捕获 AGREEMENT_REQUIRED，自动弹出重新同意对话框
  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiClientError && err.code === ErrorCodes.AGREEMENT_REQUIRED) {
          setDialogReason('updated');
          setDialogOpen(true);
        }
        throw err;
      }
    },
    [],
  );

  const hasConsented = activeConsent !== null && !activeConsent.withdrawn_at;

  const value = useMemo<AgreementGateContextValue>(
    () => ({
      hasConsented,
      agreement,
      guestSession,
      loading,
      requireConsent,
      openHistory,
      guard,
    }),
    [hasConsented, agreement, guestSession, loading, requireConsent, openHistory, guard],
  );

  return (
    <AgreementGateContext.Provider value={value}>
      {children}
      {agreement && (
        <AgreementDialog
          open={dialogOpen}
          agreement={agreement}
          scope={scope}
          reason={dialogReason}
          existingConsent={activeConsent}
          onAccepted={handleAccepted}
          onClose={() => setDialogOpen(false)}
        />
      )}
      {agreement && (
        <AgreementHistoryDialog
          open={historyOpen}
          agreement={agreement}
          scope={scope}
          activeConsent={activeConsent}
          onWithdrawn={handleWithdrawn}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </AgreementGateContext.Provider>
  );
}
