'use client';

import { useEffect, useRef, useState } from 'react';
import { History, Trash2, AlertTriangle } from 'lucide-react';
import { getApiClient } from '@/lib/api';
import { ApiClientError } from '@/lib/api/errors';
import type { Agreement, AgreementConsent } from '@/lib/api/types';
import { Button } from '@/components/ui';

type Scope = 'quick' | 'formal' | 'training';

const SCOPE_LABEL: Record<Scope, string> = {
  quick: '快速问诊',
  formal: '正式分析',
  training: '表达训练',
};

export interface AgreementHistoryDialogProps {
  open: boolean;
  agreement: Agreement;
  scope: Scope;
  activeConsent: AgreementConsent | null;
  onWithdrawn: (consentId: string) => void;
  onClose: () => void;
}

export function AgreementHistoryDialog({
  open,
  agreement,
  scope,
  activeConsent,
  onWithdrawn,
  onClose,
}: AgreementHistoryDialogProps) {
  const [consents, setConsents] = useState<AgreementConsent[]>([]);
  const [loading, setLoading] = useState(false);
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(null);
  const [withdrawText, setWithdrawText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const list = await getApiClient().listAgreementConsents({
          scope,
          limit: 50,
          offset: 0,
        });
        if (!cancelled) setConsents(list.items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, scope]);

  // Esc 关闭 + 焦点
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
    node?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!submitting) onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [open, onClose, submitting]);

  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  if (!open) return null;

  const handleWithdraw = async (consentId: string) => {
    if (withdrawText !== '撤回') return;
    setSubmitting(true);
    setErrorText(null);
    try {
      await getApiClient().withdrawAgreementConsent({ consent_id: consentId });
      onWithdrawn(consentId);
      setWithdrawConfirmId(null);
      setWithdrawText('');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorText(err.message || '撤回失败，请重试。');
      } else {
        setErrorText('网络异常，请重试。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const sortedConsents = [...consents].sort(
    (a, b) => new Date(b.consented_at).getTime() - new Date(a.consented_at).getTime(),
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="协议同意记录"
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(2px)' }}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-[var(--bg-surface)] shadow-overlay outline-none"
      >
        {/* 头部 */}
        <div className="flex items-start gap-3 border-b border-[var(--border-default)] p-5">
          <History
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-600)]"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              协议同意记录
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
              {agreement.title} · 当前版本 {agreement.version} · 作用域{' '}
              {SCOPE_LABEL[scope]}
            </p>
          </div>
          <Button variant="ghost" size="compact" onClick={onClose} disabled={submitting}>
            关闭
          </Button>
        </div>

        {/* 时间线 */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
              加载中…
            </div>
          ) : sortedConsents.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
              暂无同意记录
            </div>
          ) : (
            <ol className="flex flex-col gap-3" aria-label="同意记录时间线">
              {sortedConsents.map((c) => {
                const isActive = activeConsent?.id === c.id && !c.withdrawn_at;
                const isWithdrawn = !!c.withdrawn_at;
                const isOutdated = !isWithdrawn && c.agreement_version !== agreement.version;
                return (
                  <li
                    key={c.id}
                    className="rounded-md border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            版本 {c.agreement_version}
                          </span>
                          {isActive && (
                            <span className="rounded-sm bg-[var(--success-100)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--success-700)]">
                              当前生效
                            </span>
                          )}
                          {isOutdated && (
                            <span className="rounded-sm bg-[var(--warning-100)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning-700)]">
                              已过期
                            </span>
                          )}
                          {isWithdrawn && (
                            <span className="rounded-sm bg-[var(--slate-200)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
                              已撤回
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                          同意时间：{new Date(c.consented_at).toLocaleString('zh-CN')}
                        </div>
                        {isWithdrawn && (
                          <div className="text-xs text-[var(--text-tertiary)]">
                            撤回时间：{new Date(c.withdrawn_at!).toLocaleString('zh-CN')}
                          </div>
                        )}
                      </div>
                      {!isWithdrawn && (
                        <Button
                          variant="ghost"
                          size="compact"
                          leftIcon={Trash2}
                          onClick={() => {
                            setWithdrawConfirmId(c.id);
                            setWithdrawText('');
                            setErrorText(null);
                          }}
                          disabled={submitting}
                        >
                          撤回
                        </Button>
                      )}
                    </div>

                    {/* 撤回二次确认 */}
                    {withdrawConfirmId === c.id && (
                      <div
                        className="mt-3 rounded-md border border-[var(--danger-100)] bg-[var(--danger-50)] p-3"
                        role="alertdialog"
                        aria-label="撤回确认"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle
                            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger-700)]"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-[var(--danger-700)]">
                              撤回后无法继续使用{SCOPE_LABEL[scope]}功能
                            </p>
                            <p className="mt-1 text-xs text-[var(--text-secondary)]">
                              请输入「撤回」二字以确认：
                            </p>
                            <input
                              type="text"
                              value={withdrawText}
                              onChange={(e) => setWithdrawText(e.target.value)}
                              className="mt-2 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--border-focus)]"
                              placeholder="撤回"
                              disabled={submitting}
                              style={{ color: 'var(--text-primary)', opacity: 1 }}
                            />
                            {errorText && (
                              <p className="mt-2 text-xs text-[var(--danger-700)]">{errorText}</p>
                            )}
                            <div className="mt-2 flex justify-end gap-2">
                              <Button
                                variant="secondary"
                                size="compact"
                                onClick={() => {
                                  setWithdrawConfirmId(null);
                                  setWithdrawText('');
                                  setErrorText(null);
                                }}
                                disabled={submitting}
                              >
                                取消
                              </Button>
                              <Button
                                variant="danger"
                                size="compact"
                                loading={submitting}
                                disabled={withdrawText !== '撤回'}
                                onClick={() => void handleWithdraw(c.id)}
                              >
                                确认撤回
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
