'use client';

import { clsx } from 'clsx';
import { ArrowLeft, ArrowUp, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import { BriefExportMenu } from './brief-export-menu';

interface BriefTopbarProps {
  title: string;
  version: number;
  generatedAt: string;
  status?: 'draft' | 'ready';
  sessionId: string;
  briefContent: string;
  onUpgrade?: () => void;
  upgradePending?: boolean;
  isSampleSession?: boolean;
  className?: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return iso;
  }
}

export function BriefTopbar({
  title,
  version,
  generatedAt,
  status = 'draft',
  sessionId,
  briefContent,
  onUpgrade,
  upgradePending = false,
  isSampleSession = false,
  className,
}: BriefTopbarProps) {
  const router = useRouter();
  const isDraft = status === 'draft';
  const upgradeLabel = isSampleSession ? '体验正式项目' : '升级正式项目';
  const pendingLabel = '正在升级';

  return (
    <header className={clsx('app-topbar', className)}>
      {/* 左侧：标题 + 版本 + 时间 + 状态徽章 */}
      <div
        className="flex min-w-0 items-center"
        style={{ gap: 12, flexWrap: 'wrap' }}
      >
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
          aria-hidden="true"
          style={{ width: 1, height: 16, background: 'var(--aurora-hair-strong)' }}
        />
        <h1
          className="app-title app-title-sm"
          style={{
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </h1>
        <span className="app-chip" style={{ flexShrink: 0 }}>
          第 {version} 版
        </span>
        <span style={{ flexShrink: 0, color: 'var(--aurora-muted)' }}>
          {formatDate(generatedAt)}
        </span>
        <span
          className={clsx('app-chip', isDraft ? 'app-chip-rose' : 'app-chip-sage')}
          style={{ flexShrink: 0 }}
        >
          {isDraft ? '草稿' : '已就绪'}
        </span>
        {isSampleSession && (
          <span className="app-chip app-chip-muted" style={{ flexShrink: 0 }}>
            参考案例
          </span>
        )}
      </div>

      {/* 右侧：导出 + 升级 */}
      <div className="meta" style={{ flexShrink: 0, gap: 12 }}>
        <BriefExportMenu
          sessionId={sessionId}
          briefVersion={version}
          briefContent={briefContent}
          title={title}
        />
        <button
          type="button"
          className="app-btn-primary"
          onClick={onUpgrade}
          disabled={upgradePending}
          style={{ padding: '8px 16px', fontSize: 13 }}
        >
          {upgradePending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ArrowUp className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          )}
          <span>{upgradePending ? pendingLabel : upgradeLabel}</span>
        </button>
      </div>
    </header>
  );
}
