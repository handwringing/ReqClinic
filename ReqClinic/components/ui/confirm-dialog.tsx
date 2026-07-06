'use client';

import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from './button';

export type ConfirmVariant = 'default' | 'danger';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  confirmLoading?: boolean;
  /** 自定义底部按钮区，不传则使用默认的取消 + 确认按钮 */
  footer?: ReactNode;
  onConfirm?: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

function getFocusable(node: HTMLElement): HTMLElement[] {
  const selector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(node.querySelectorAll<HTMLElement>(selector));
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  confirmLoading = false,
  footer,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      (document.activeElement as HTMLElement | null) ?? null;
    const node = dialogRef.current;
    node?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === 'Tab' && node) {
        const list = getFocusable(node);
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
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [open, onCancel]);

  if (!open) return null;

  const defaultFooter = (
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="secondary" size="regular" onClick={onCancel}>
        {cancelText}
      </Button>
      {onConfirm && (
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          size="regular"
          loading={confirmLoading}
          onClick={onConfirm}
        >
          {confirmText}
        </Button>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(2px)' }}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-sm rounded-lg bg-[var(--bg-surface)] p-5 shadow-overlay outline-none"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        {description && (
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            {description}
          </div>
        )}
        {children}
        {footer ?? defaultFooter}
      </div>
    </div>
  );
}