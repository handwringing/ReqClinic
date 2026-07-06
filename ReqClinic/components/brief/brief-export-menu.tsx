'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  ChevronDown,
  Copy,
  Download,
  FileDown,
  FileText,
  Loader2,
} from 'lucide-react';
import { getApiClient } from '@/lib/api';
import type { BriefExport } from '@/lib/api/types';
import { useToast } from '@/components/ui';

interface BriefExportMenuProps {
  sessionId: string;
  briefVersion: number;
  /** 简报纯文本内容，用于复制到剪贴板 */
  briefContent: string;
  className?: string;
}

type ExportFormat = 'markdown' | 'pdf';

interface ExportRecord {
  exportId: string;
  expiresAt: string;
  format: ExportFormat;
}

export function BriefExportMenu({
  sessionId,
  briefVersion,
  briefContent,
  className,
}: BriefExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [exportRecord, setExportRecord] = useState<ExportRecord | null>(null);
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

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(briefContent);
      } else {
        // 兜底：使用 textarea
        const ta = document.createElement('textarea');
        ta.value = briefContent;
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
    }
  };

  const handleDownload = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(format);
    try {
      const api = getApiClient();
      // 第一步：申请导出
      const exportRes: BriefExport = await api.exportQuickSessionBrief({
        session_id: sessionId,
        brief_version: briefVersion,
        formats: [format],
      });
      setExportRecord({
        exportId: exportRes.export_id,
        expiresAt: exportRes.expires_at,
        format,
      });
      // 第二步：获取下载链接
      const result = await api.downloadQuickSessionBrief({
        export_id: exportRes.export_id,
        format,
      });
      // 运行时 result 实际可能是 { download_url: string }，做兼容处理
      const downloadUrl =
        typeof result === 'string'
          ? result
          : (result as unknown as { download_url?: string }).download_url ??
            '';
      if (!downloadUrl) {
        throw new Error('未获取到下载链接');
      }
      // 触发浏览器下载
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `需求简报-${briefVersion}.${format === 'pdf' ? 'pdf' : 'md'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast({
        type: 'success',
        title: format === 'pdf' ? '版式文件下载已开始' : '文本文件下载已开始',
      });
    } catch {
      showToast({
        type: 'error',
        title: '导出失败',
        description: '请稍后重试',
      });
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const menuItems: {
    key: ExportFormat | 'copy';
    label: string;
    icon: typeof Copy;
    onClick: () => void | Promise<void>;
    loading?: boolean;
  }[] = [
    { key: 'copy', label: '复制到剪贴板', icon: Copy, onClick: handleCopy },
    {
      key: 'markdown',
      label: '下载文本文件',
      icon: FileText,
      onClick: () => handleDownload('markdown'),
      loading: busy === 'markdown',
    },
    {
      key: 'pdf',
      label: '下载版式文件',
      icon: FileDown,
      onClick: () => handleDownload('pdf'),
      loading: busy === 'pdf',
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
          {exportRecord && (
            <div
              className="mt-1 px-3 py-2"
              style={{ borderTop: '1px solid var(--aurora-hair)' }}
            >
              <p
                className="text-[11px]"
                style={{ color: 'var(--aurora-muted)' }}
              >
                导出编号：
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {exportRecord.exportId.slice(0, 8)}…
                </span>
              </p>
              <p
                className="text-[11px]"
                style={{ color: 'var(--aurora-muted)' }}
              >
                过期时间：{new Date(exportRecord.expiresAt).toLocaleString('zh-CN')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
