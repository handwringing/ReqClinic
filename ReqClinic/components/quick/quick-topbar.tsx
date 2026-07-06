'use client';

import { Archive, ArrowLeft, Ban, MoreVertical, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import { ConfirmDialog, DeleteConfirmDialog } from '@/components/ui';
import { getApiClient } from '@/lib/api';

export interface QuickStep {
  index: number;
  title: string;
}

export const QUICK_STEPS: QuickStep[] = [
  { index: 1, title: '开始表达' },
  { index: 2, title: '连续追问' },
  { index: 3, title: '确认理解' },
  { index: 4, title: '比较方案' },
  { index: 5, title: '生成简报' },
];

export interface QuickTopbarProps {
  sessionTitle: string;
  advancedView: boolean;
  onToggleAdvancedView: (next: boolean) => void;
  sessionId: string;
}

type MenuAction = 'abandon' | 'archive';

export function QuickTopbar({
  sessionTitle,
  advancedView,
  onToggleAdvancedView,
  sessionId,
}: QuickTopbarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<MenuAction | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部时关闭
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleConfirmAction = useCallback(async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const api = getApiClient();
      if (confirmAction === 'abandon') {
        await api.abandonQuickSession(sessionId);
      } else {
        await api.archiveQuickSession(sessionId);
      }
      router.push('/quick');
    } catch (err) {
      setActionLoading(false);
      setActionError(err instanceof Error ? err.message : '操作失败，请重试');
    }
  }, [confirmAction, sessionId, router]);

  const confirmTitle = confirmAction === 'abandon' ? '放弃会话' : '归档会话';
  const confirmDesc =
    confirmAction === 'abandon'
      ? '放弃后将返回快速问诊页，这次内容不会继续推进。'
      : '归档后将返回快速问诊页，后续可以在归档记录中查看。';

  return (
    <header className="app-topbar">
      {/* 左侧：品牌 + 会话标题 */}
      <div className="flex min-w-0 items-center" style={{ gap: 14 }}>
        <button
          type="button"
          className="app-nav-back"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          返回
        </button>
        <span
          aria-hidden="true"
          style={{ width: 1, height: 12, background: 'var(--aurora-hair-strong)' }}
        />
        <button
          type="button"
          className="brand-mark brand-home-link"
          onClick={() => router.push('/')}
          aria-label="返回首页"
        >
          <span className="dot" />
          <ProductBrandText />
        </button>
        <span
          aria-hidden="true"
          style={{ width: 1, height: 12, background: 'var(--aurora-hair-strong)' }}
        />
        <span
          className="truncate"
          title={sessionTitle}
          style={{ color: 'var(--aurora-muted)', maxWidth: 320 }}
        >
          {sessionTitle}
        </span>
      </div>

      <div aria-hidden="true" />

      {/* 右侧：全部内容开关 + 操作菜单 */}
      <div className="meta" style={{ gap: 14 }}>
        <button
          type="button"
          role="switch"
          aria-checked={advancedView}
          aria-label="展开全部整理内容"
          onClick={() => onToggleAdvancedView(!advancedView)}
          className="flex h-6 w-11 items-center rounded-full transition-colors"
          style={{
            border: `1px solid ${advancedView ? 'var(--aurora-gold)' : 'var(--aurora-hair-strong)'}`,
            background: advancedView ? 'var(--aurora-gold)' : 'transparent',
            justifyContent: advancedView ? 'flex-end' : 'flex-start',
          }}
        >
          <span
            className="h-4 w-4 rounded-full bg-white"
            style={{ marginLeft: 2, marginRight: 2 }}
          />
        </button>
        <span
          style={{
            color: advancedView ? 'var(--aurora-gold)' : 'var(--aurora-muted)',
          }}
        >
          全部整理
        </span>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--aurora-hair)]"
            style={{ color: 'var(--aurora-ink-soft)' }}
          >
            <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="会话操作"
              className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md py-1"
              style={{
                background: 'var(--aurora-card-bg)',
                border: '1px solid var(--aurora-card-border)',
                boxShadow: 'var(--aurora-shadow-soft)',
                backdropFilter: 'blur(20px) saturate(140%)',
                WebkitBackdropFilter: 'blur(20px) saturate(140%)',
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setActionError(null);
                  setConfirmAction('abandon');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--aurora-hair)]"
                style={{ color: 'var(--aurora-ink)' }}
              >
                <Ban className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                放弃会话
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setActionError(null);
                  setConfirmAction('archive');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--aurora-hair)]"
                style={{ color: 'var(--aurora-ink)' }}
              >
                <Archive className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                归档会话
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--aurora-hair)]"
                style={{ color: 'var(--aurora-rose)' }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                删除会话
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmTitle}
        variant="danger"
        confirmText={actionLoading ? '处理中…' : '确认'}
        confirmLoading={actionLoading}
        description={
          <div>
            <p>{confirmDesc}</p>
            {actionError && (
              <p className="mt-2" style={{ color: 'var(--aurora-rose)' }}>
                {actionError}
              </p>
            )}
          </div>
        }
        onConfirm={handleConfirmAction}
        onCancel={() => {
          if (!actionLoading) {
            setConfirmAction(null);
            setActionError(null);
          }
        }}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        entityType="quick_session"
        entityId={sessionId}
        entityName={sessionTitle}
        title="删除会话"
        description={`即将删除「${sessionTitle}」，此操作将在保留期后永久清除。`}
        onDelete={async ({ entityId }) => {
          const task = await getApiClient().deleteQuickSession(entityId);
          if (task.blocked_reason === 'legal_hold') {
            return { status: 'legal_hold' as const };
          }
          return {
            status: 'scheduled' as const,
            estimated_purge_at: task.estimated_purge_at,
          };
        }}
        onDeleted={() => {
          setDeleteOpen(false);
          router.push('/quick');
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </header>
  );
}
