'use client';

import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './confirm-dialog';
import { Button } from './button';

export type DeletePhase =
  | 'confirm'
  | 'submitting'
  | 'scheduled'
  | 'legal_hold'
  | 'error';

export interface DeleteResult {
  status: 'scheduled' | 'legal_hold';
  estimated_purge_at?: string;
}

export interface DeleteConfirmDialogProps {
  open: boolean;
  entityType: string;
  entityId: string;
  entityName?: string;
  /** 执行删除，携带幂等键；返回 scheduled 或 legal_hold。抛出错误视为失败。 */
  onDelete: (params: {
    entityType: string;
    entityId: string;
    idempotencyKey: string;
  }) => Promise<DeleteResult>;
  onDeleted?: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

function fallbackUUID(): string {
  const hex = '0123456789abcdef';
  const out: string[] = [];
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out.push('-');
    } else if (i === 14) {
      out.push('4');
    } else if (i === 19) {
      out.push(hex[(Math.random() * 4) | 8]);
    } else {
      out.push(hex[(Math.random() * 16) | 0]);
    }
  }
  return out.join('');
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return fallbackUUID();
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isLegalHold(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('legal_hold') || lower.includes('legalhold') || msg.includes('409');
}

export function DeleteConfirmDialog({
  open,
  entityType,
  entityId,
  entityName,
  onDelete,
  onDeleted,
  onCancel,
  title = '确认删除',
  description,
}: DeleteConfirmDialogProps) {
  const [phase, setPhase] = useState<DeletePhase>('confirm');
  const [estimatedPurgeAt, setEstimatedPurgeAt] = useState<string | undefined>(
    undefined,
  );
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);
  const idempotencyKeyRef = useRef<string>('');
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  useEffect(() => {
    if (open) {
      setPhase('confirm');
      setEstimatedPurgeAt(undefined);
      setErrorMsg(undefined);
      idempotencyKeyRef.current = '';
    }
  }, [open]);

  const scopeText = entityName ? `「${entityName}」` : '该记录';

  const handleConfirm = async () => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }
    setPhase('submitting');
    try {
      const res = await onDeleteRef.current({
        entityType,
        entityId,
        idempotencyKey: idempotencyKeyRef.current,
      });
      if (res.status === 'scheduled') {
        setEstimatedPurgeAt(res.estimated_purge_at);
        setPhase('scheduled');
      } else if (res.status === 'legal_hold') {
        setPhase('legal_hold');
      } else {
        setErrorMsg('未识别的响应');
        setPhase('error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      if (isLegalHold(msg)) {
        setPhase('legal_hold');
      } else {
        setErrorMsg(msg);
        setPhase('error');
      }
    }
  };

  const handleDismissScheduled = () => {
    onDeletedRef.current?.();
    onCancel();
  };

  const phaseTitle: Record<DeletePhase, string> = {
    confirm: title,
    submitting: title,
    scheduled: '已安排删除',
    legal_hold: '无法删除',
    error: '删除失败',
  };

  let phaseDescription: string;
  if (description && (phase === 'confirm' || phase === 'submitting')) {
    phaseDescription = description;
  } else if (phase === 'scheduled') {
    phaseDescription = `${scopeText} 将于 ${formatDate(estimatedPurgeAt)} 永久删除。`;
  } else if (phase === 'legal_hold') {
    phaseDescription = `${scopeText} 因法律保留无法删除。`;
  } else if (phase === 'error') {
    phaseDescription = errorMsg ?? '删除失败，请重试。';
  } else {
    phaseDescription = `即将删除${scopeText}，此操作将在保留期后永久清除。`;
  }

  const footer =
    phase === 'scheduled' || phase === 'legal_hold' ? (
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" size="regular" onClick={handleDismissScheduled}>
          关闭
        </Button>
      </div>
    ) : phase === 'error' ? (
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="regular" onClick={onCancel}>
          取消
        </Button>
        <Button variant="danger" size="regular" onClick={handleConfirm}>
          重试
        </Button>
      </div>
    ) : undefined;

  return (
    <ConfirmDialog
      open={open}
      title={phaseTitle[phase]}
      description={phaseDescription}
      variant="danger"
      confirmText={phase === 'submitting' ? '删除中…' : '删除'}
      confirmLoading={phase === 'submitting'}
      onConfirm={
        phase === 'confirm' || phase === 'submitting' ? handleConfirm : undefined
      }
      onCancel={onCancel}
      footer={footer}
    />
  );
}
