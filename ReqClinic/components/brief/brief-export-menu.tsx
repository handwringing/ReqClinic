'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  ChevronDown,
  Copy,
  Download,
  FileText,
  Loader2,
} from 'lucide-react';
import { getApiClient } from '@/lib/api';
import type { BriefView } from '@/lib/api/types';
import { useToast } from '@/components/ui';

interface BriefExportMenuProps {
  sessionId: string;
  briefVersion: number;
  /** 简报纯文本内容，用于复制到剪贴板 */
  briefContent: string;
  title?: string;
  className?: string;
}

export function BriefExportMenu({
  sessionId,
  briefVersion,
  briefContent,
  title,
  className,
}: BriefExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'copy' | 'markdown' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const resolveProfessionalReport = async (): Promise<string> => {
    const current = briefContent.trim();
    if (current) return current;
    const view = await getApiClient().getBriefView({
      session_id: sessionId,
      brief_version: briefVersion,
      view_type: 'exec',
    });
    return formatBriefViewForExport(view).trim();
  };

  const handleCopy = async () => {
    if (busy) return;
    setBusy('copy');
    try {
      const content = await resolveProfessionalReport();
      if (!content) throw new Error('empty');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        // 兜底：使用 textarea
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast({ type: 'success', title: '已复制到剪贴板' });
    } catch {
      showToast({ type: 'error', title: '复制失败', description: '请手动选择文本复制' });
    } finally {
      setOpen(false);
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    if (busy) return;
    setBusy('markdown');
    try {
      const content = await resolveProfessionalReport();
      if (!content) {
        throw new Error('empty');
      }
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFileName(title || '需求简报')}-v${briefVersion}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({
        type: 'success',
        title: '专业报告下载已开始',
      });
    } catch {
      showToast({
        type: 'error',
        title: '导出失败',
        description: '专业报告还没有准备好，请稍后再试。',
      });
    } finally {
      setOpen(false);
      setBusy(null);
    }
  };

  const menuItems: {
    key: 'copy' | 'markdown';
    label: string;
    icon: typeof Copy;
    onClick: () => void | Promise<void>;
    loading?: boolean;
  }[] = [
    { key: 'copy', label: '复制专业报告', icon: Copy, onClick: handleCopy, loading: busy === 'copy' },
    {
      key: 'markdown',
      label: '下载 Markdown 文档',
      icon: FileText,
      onClick: handleDownload,
      loading: busy === 'markdown',
    },
  ];

  return (
    <div ref={menuRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="app-btn-ghost inline-flex items-center gap-2"
      >
        <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        <span>导出</span>
        <ChevronDown
          className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-40 w-56 py-1"
          style={{
            borderRadius: 4,
            border: '1px solid var(--aurora-card-border)',
            background: 'var(--aurora-card-bg)',
            backdropFilter: 'blur(20px) saturate(140%)',
            WebkitBackdropFilter: 'blur(20px) saturate(140%)',
            boxShadow: 'var(--aurora-shadow-soft)',
          }}
        >
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => void item.onClick()}
                disabled={!!busy}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                  'hover:bg-[var(--aurora-hair)] disabled:cursor-not-allowed disabled:opacity-60',
                )}
                style={{ color: 'var(--aurora-ink)' }}
              >
                {item.loading ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.5}
                    style={{ color: 'var(--aurora-muted)' }}
                    aria-hidden="true"
                  />
                ) : (
                  <Icon
                    className="h-4 w-4"
                    strokeWidth={1.5}
                    style={{ color: 'var(--aurora-muted)' }}
                    aria-hidden="true"
                  />
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '')
    .trim();
  return cleaned || '需求简报';
}

function formatBriefViewForExport(view: BriefView | null): string {
  if (!view) return '';
  const sections = view.sections ?? [];
  const sectionText = sections
    .map((section) => `## ${section.title}\n\n${section.content}`)
    .join('\n\n');
  const content = view.content?.trim() ?? '';
  if (view.view_type === 'exec' && sectionText.trim()) {
    return [content, sectionText].filter(Boolean).join('\n\n');
  }
  return content || sectionText;
}
