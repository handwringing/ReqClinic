'use client';

import { clsx } from 'clsx';
import { AlertTriangle, FileText, History, Home, Lock, MessageSquare, PencilLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BriefVersion } from '@/lib/api/types';
import { BriefFeedback } from './brief-feedback';

interface BriefContentProps {
  sessionId: string;
  briefVersion: BriefVersion;
  /** 所有可显示的版本列表 */
  versions: BriefVersion[];
  /** 当前选中的版本号 */
  currentVersion: number;
  /** 切换版本回调（仅视觉示意） */
  onVersionChange?: (version: number) => void;
  demoFlowCompleted?: boolean;
  className?: string;
}

export function BriefContent({
  sessionId,
  briefVersion,
  versions,
  currentVersion,
  onVersionChange,
  demoFlowCompleted = false,
  className,
}: BriefContentProps) {
  const router = useRouter();
  const [showFeedback, setShowFeedback] = useState(false);
  const [flowEndDialogOpen, setFlowEndDialogOpen] = useState(false);

  // 显示真实版本列表；无接口数据时只显示当前版本。
  const displayVersions: number[] =
    versions.length > 0
      ? versions.map((v) => v.version).sort((a, b) => b - a)
      : [currentVersion];
  const showVersionHistory = displayVersions.length > 1;
  const statusText = buildBriefStatusText(briefVersion);

  const handleContinueSupplement = () => {
    if (demoFlowCompleted) {
      setFlowEndDialogOpen(true);
      return;
    }
    router.push(`/quick/${sessionId}`);
  };

  return (
    <div className={clsx('app-card app-card-pad flex flex-col gap-5', className)}>
      {/* 未完成草稿警告条 */}
      {briefVersion.is_incomplete && (
        <div
          className="app-chip app-chip-rose"
          role="alert"
          style={{
            display: 'flex',
            width: '100%',
            borderRadius: 4,
            padding: '10px 14px',
            justifyContent: 'flex-start',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-0.5">
            <p style={{ fontSize: 13, fontWeight: 600 }}>当前为未完成草稿</p>
            <p style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.6 }}>
              简报中还有 {briefVersion.blocking_unknowns_count} 项关键信息需要确认，
              {briefVersion.non_blocking_unknowns_count} 项信息可以稍后补充，建议先补齐关键内容再用于沟通。
            </p>
            <p style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.6 }}>
              可以回到对话继续补充未明确内容，确认后再生成下一版简报。
            </p>
          </div>
        </div>
      )}

      {/* 正式性说明条 */}
      <div
        className="app-chip app-chip-sage"
        style={{
          display: 'flex',
          width: '100%',
          borderRadius: 4,
          padding: '10px 14px',
          justifyContent: 'flex-start',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <p style={{ fontSize: 12, lineHeight: 1.7, letterSpacing: '0.01em' }}>
          {statusText}
        </p>
      </div>

      {/* 版本历史 */}
      {showVersionHistory && (
        <div className="flex flex-col gap-2.5">
          <div
            className="app-label"
            style={{ fontSize: 10 }}
          >
            <History className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            版本历史
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {displayVersions.map((v) => {
              const isCurrent = v === currentVersion;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => onVersionChange?.(v)}
                  disabled={isCurrent}
                  className={clsx(
                    'app-chip',
                    isCurrent ? '' : 'app-chip-muted',
                    'disabled:cursor-default',
                  )}
                  style={{ cursor: isCurrent ? 'default' : 'pointer' }}
                >
                  v{v}
                  {isCurrent && (
                    <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.85 }}>
                      当前
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 底部按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="app-btn-ghost inline-flex items-center gap-2"
          onClick={handleContinueSupplement}
          aria-haspopup={demoFlowCompleted ? 'dialog' : undefined}
        >
          {demoFlowCompleted ? (
            <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <PencilLine className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          )}
          <span>{demoFlowCompleted ? '示例已结束' : briefVersion.is_incomplete ? '继续补充信息' : '继续补充'}</span>
        </button>
        <button
          type="button"
          className="app-btn-ghost inline-flex items-center gap-2"
          onClick={() => setShowFeedback((v) => !v)}
          aria-expanded={showFeedback}
        >
          <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          <span>{showFeedback ? '收起反馈' : '可用性反馈'}</span>
        </button>
      </div>

      {/* 可用性反馈 */}
      {showFeedback && (
        <BriefFeedback
          sessionId={sessionId}
          version={currentVersion}
          defaultOpen
        />
      )}

      {flowEndDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="brief-flow-end-title"
          style={{ background: 'rgba(26,27,40,0.28)' }}
        >
          <div
            className="app-card app-card-pad w-full"
            style={{
              maxWidth: 460,
              background: 'rgba(255,255,255,0.88)',
              backdropFilter: 'blur(24px) saturate(140%)',
              WebkitBackdropFilter: 'blur(24px) saturate(140%)',
            }}
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="app-chip app-chip-sage">
                  示例体验
                </span>
                <h2
                  id="brief-flow-end-title"
                  className="font-display text-[18px] font-semibold"
                  style={{ color: 'var(--aurora-ink)' }}
                >
                  当前示例已演示完成
                </h2>
              </div>
              <p
                className="text-[13px] leading-relaxed"
                style={{ color: 'var(--aurora-ink-soft)' }}
              >
                这个示例的引导步骤已经结束，继续补充暂时不会生成新的内容。你可以回到首页体验其他示例，也可以留在这里继续查看报告。
              </p>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="app-btn-ghost inline-flex items-center gap-2"
                  onClick={() => setFlowEndDialogOpen(false)}
                >
                  <FileText className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                  继续查看报告
                </button>
                <button
                  type="button"
                  className="app-btn-primary inline-flex items-center gap-2"
                  onClick={() => router.push('/')}
                >
                  <Home className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                  回到首页
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildBriefStatusText(briefVersion: BriefVersion): string {
  const blocking = briefVersion.blocking_unknowns_count;
  const nonBlocking = briefVersion.non_blocking_unknowns_count;
  if (blocking > 0 && nonBlocking > 0) {
    return `本简报用于沟通，尚未经过正式项目确认。当前还有 ${blocking} 项信息需要先确认，另有 ${nonBlocking} 项信息可以稍后补充。`;
  }
  if (blocking > 0) {
    return `本简报用于沟通，尚未经过正式项目确认。当前还有 ${blocking} 项信息需要先确认。`;
  }
  if (nonBlocking > 0) {
    return `本简报用于沟通，尚未经过正式项目确认。当前还有 ${nonBlocking} 项信息可以稍后补充。`;
  }
  return '本简报用于沟通，尚未经过正式项目确认。暂无待补充信息。';
}
