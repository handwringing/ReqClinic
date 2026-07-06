'use client';

import { ArrowLeft, CheckCircle2, HelpCircle, Layers3, MoreHorizontal, PlayCircle, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import { Avatar } from '@/components/ui';
import type { Project } from '@/lib/api/types';

export interface FormalTopbarProps {
  projectTitle: string;
  organizedCount: number;
  mapNodeCount: number;
  pendingQuestionCount: number;
  unresolvedConflictCount: number;
  ownerInitials: string[];
  sourceKind?: Project['source_kind'];
}

export function FormalTopbar({
  projectTitle,
  organizedCount,
  mapNodeCount,
  pendingQuestionCount,
  unresolvedConflictCount,
  ownerInitials,
  sourceKind,
}: FormalTopbarProps) {
  const router = useRouter();
  const visibleOwners = ownerInitials.slice(0, 3);
  const overflow = Math.max(0, ownerInitials.length - 3);
  const needsAttention = pendingQuestionCount + unresolvedConflictCount;
  const sourceLabel =
    sourceKind === 'sample'
      ? '示例体验'
      : sourceKind === 'quick_upgrade'
        ? '由快速问诊升级'
        : null;

  return (
    <header className="app-topbar" style={{ flexShrink: 0, gap: 24 }}>
      <div className="brand-mark" style={{ minWidth: 0, gap: 12 }}>
        <button
          type="button"
          className="app-nav-back"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          返回
        </button>
        <span
          aria-hidden
          style={{ width: 1, height: 16, background: 'var(--aurora-hair-strong)' }}
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
          aria-hidden
          style={{ width: 1, height: 16, background: 'var(--aurora-hair-strong)' }}
        />
        <span
          className="app-title app-title-sm"
          title={projectTitle}
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 300,
          }}
        >
          {projectTitle}
        </span>
        {sourceLabel && (
          <span className={sourceKind === 'sample' ? 'app-chip app-chip-muted' : 'app-chip app-chip-sage'}>
            <PlayCircle size={13} strokeWidth={1.5} aria-hidden="true" />
            {sourceLabel}
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
          minWidth: 0,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <span className="app-chip">
          <Layers3 size={13} strokeWidth={1.5} />
          需求地图 {mapNodeCount} 项
        </span>
        <span className="app-chip app-chip-sage">
          <CheckCircle2 size={13} strokeWidth={1.5} />
          已整理 {organizedCount} 项
        </span>
        <span className={needsAttention > 0 ? 'app-chip app-chip-rose' : 'app-chip app-chip-muted'}>
          {needsAttention > 0 ? (
            <HelpCircle size={13} strokeWidth={1.5} />
          ) : (
            <ShieldAlert size={13} strokeWidth={1.5} />
          )}
          待确认 {needsAttention} 项
        </span>
      </div>

      <div className="meta" style={{ gap: 14 }}>
        <div
          style={{ display: 'flex', alignItems: 'center' }}
          aria-label={`参与者 ${ownerInitials.length} 人`}
        >
          {visibleOwners.map((init, idx) => (
            <span
              key={`${init}-${idx}`}
              style={{
                marginLeft: idx === 0 ? 0 : -8,
                border: '2px solid var(--aurora-bg)',
                borderRadius: 9999,
                zIndex: visibleOwners.length - idx,
              }}
            >
              <Avatar variant="user" size={28} aria-label={init}>
                {init}
              </Avatar>
            </span>
          ))}
          {overflow > 0 && (
            <span
              style={{
                marginLeft: -8,
                border: '2px solid var(--aurora-bg)',
                borderRadius: 9999,
                background: 'var(--aurora-ink)',
                color: 'var(--aurora-bg)',
                fontSize: 11,
                fontWeight: 600,
                width: 28,
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label={`还有 ${overflow} 人`}
            >
              +{overflow}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="操作菜单"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--aurora-ink-soft)',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 4,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <MoreHorizontal size={18} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
