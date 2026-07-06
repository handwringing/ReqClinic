'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, AlertCircle } from 'lucide-react';
import { getApiClient } from '@/lib/api';
import { ApiClientError, ErrorCodes } from '@/lib/api/errors';
import type { Agreement, AgreementConsent } from '@/lib/api/types';
import { Button } from '@/components/ui';

type Scope = 'quick' | 'formal' | 'training';

const SCOPE_LABEL: Record<Scope, string> = {
  quick: '快速问诊',
  formal: '正式分析',
  training: '表达训练',
};

export interface AgreementDialogProps {
  open: boolean;
  agreement: Agreement;
  scope: Scope;
  /** initial = 首次同意；updated = 协议版本变化后重新同意 */
  reason: 'initial' | 'updated';
  /** 当前已有的同意记录（重新同意时用于版本对比） */
  existingConsent?: AgreementConsent | null;
  onAccepted: (consent: AgreementConsent) => void;
  onClose: () => void;
}

export function AgreementDialog({
  open,
  agreement,
  scope,
  reason,
  existingConsent,
  onAccepted,
  onClose,
}: AgreementDialogProps) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fullTextOpen, setFullTextOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // 重置状态：每次打开时清空勾选与错误
  useEffect(() => {
    if (open) {
      setChecked(false);
      setErrorText(null);
      setFullTextOpen(false);
      previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;
      dialogRef.current?.focus();
    }
  }, [open, agreement.id]);

  // Esc 关闭 + focus trap
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!submitting) onClose();
        return;
      }
      if (e.key === 'Tab' && node) {
        const selector =
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const list = Array.from(node.querySelectorAll<HTMLElement>(selector));
        if (list.length === 0) {
          e.preventDefault();
          node.focus();
          return;
        }
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !node.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !node.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [open, onClose, submitting]);

  if (!open) return null;

  const isReaccept = reason === 'updated';
  const previousVersion = existingConsent?.agreement_version;

  const handleSubmit = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      const api = getApiClient();
      const consent = isReaccept
        ? await api.reacceptAgreement({ agreement_id: agreement.id, scope })
        : await api.acceptAgreement({ agreement_id: agreement.id, scope });
      onAccepted(consent);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === ErrorCodes.AGREEMENT_REQUIRED) {
          setErrorText('协议已更新，请阅读新版本后重新同意。');
        } else {
          setErrorText(err.message || '提交失败，请重试。');
        }
      } else {
        setErrorText('网络异常，请重试。');
      }
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${isReaccept ? '重新' : ''}同意使用协议`}
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
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] p-5">
          <div className="flex items-start gap-3">
            <FileText
              className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-600)]"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {isReaccept ? '协议已更新，请重新同意' : '使用前请阅读并同意协议'}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                {agreement.title} · 版本 {agreement.version} · 生效于{' '}
                {new Date(agreement.effective_at).toLocaleDateString('zh-CN')}
              </p>
            </div>
          </div>
          <span
            className="shrink-0 rounded-sm bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
          >
            {SCOPE_LABEL[scope]}
          </span>
        </div>

        {/* 正文 */}
        <div className="flex-1 overflow-y-auto p-5">
          {isReaccept && previousVersion && (
            <div
              className="mb-4 flex items-start gap-2 rounded-md border border-[var(--warning-100)] bg-[var(--warning-50)] p-3"
              role="status"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning-700)]"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <div className="text-xs leading-relaxed text-[var(--warning-700)]">
                你此前同意的版本为 <strong>{previousVersion}</strong>，当前生效版本已更新为{' '}
                <strong>{agreement.version}</strong>。请阅读下方协议，确认后重新同意。
              </div>
            </div>
          )}

          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            本协议说明「需求问诊室」在{SCOPE_LABEL[scope]}场景下对你输入内容的处理方式、
            内容来源标注，以及你可以随时撤回同意的权利。
          </p>

          {/* 协议正文入口 */}
          <button
            type="button"
            onClick={() => setFullTextOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)]"
            aria-expanded={fullTextOpen}
            aria-controls="agreement-full-text"
          >
            <FileText className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            {fullTextOpen ? '收起协议正文' : '阅读完整协议正文'}
          </button>

          {fullTextOpen && (
            <div
              id="agreement-full-text"
              className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3"
            >
              <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[var(--text-secondary)]">
{`需求问诊室使用协议（版本 ${agreement.version}）

一、服务性质
本服务用于辅助整理需求表达，生成内容不构成专业建议。

二、内容处理
你输入的文本仅用于本次会话的需求分析，不会用于模型训练。

三、来源标注
所有展示内容均标注来源：案例内容、系统预览、用户输入、系统整理、已确认。

四、撤回权利
你可以随时在「协议记录」中撤回同意，撤回后将无法继续使用当前功能。

五、协议变更
协议更新时，你需要重新阅读并同意新版本后方可继续使用。

参考标识：${agreement.content_ref}`}
              </pre>
            </div>
          )}

          {/* 勾选框 */}
          <label
            className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-[var(--border-default)] p-3 hover:bg-[var(--bg-hover)]"
            style={{ display: 'flex' }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent-600)]"
              disabled={submitting}
            />
            <span className="text-sm leading-relaxed text-[var(--text-primary)]">
              我已阅读并理解上述协议，同意在{SCOPE_LABEL[scope]}场景下按协议处理我的输入。
            </span>
          </label>

          {errorText && (
            <div
              className="mt-3 rounded-md border border-[var(--danger-100)] bg-[var(--danger-50)] p-2.5 text-xs text-[var(--danger-700)]"
              role="alert"
            >
              {errorText}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] p-4">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="regular"
              onClick={onClose}
              disabled={submitting}
            >
              稍后再说
            </Button>
            <Button
              variant="primary"
              size="regular"
              loading={submitting}
              disabled={!checked}
              onClick={() => void handleSubmit()}
            >
              {isReaccept ? '重新同意' : '同意并继续'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
