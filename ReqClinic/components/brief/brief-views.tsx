'use client';

import { clsx } from 'clsx';
import {
  CheckSquare,
  Download,
  FileText,
  ListChecks,
  Loader2,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getApiClient } from '@/lib/api';
import type { BriefView, BriefViewType } from '@/lib/api/types';
import { ErrorState } from '@/components/ui';

type ViewTab = {
  type: BriefViewType | 'export';
  label: string;
  icon: typeof ListChecks;
};

const VIEW_TABS: ViewTab[] = [
  { type: 'simple', label: '普通概述', icon: ListChecks },
  { type: 'exec', label: '专业报告', icon: FileText },
  { type: 'export', label: '导出文档', icon: Download },
];

interface BriefViewsProps {
  sessionId: string;
  version: number;
  /** 当视图数据加载完成时回调，供父组件用于导出/复制 */
  onViewDataChange?: (view: BriefView) => void;
}

export function BriefViews({ sessionId, version, onViewDataChange }: BriefViewsProps) {
  const [activeView, setActiveView] = useState<BriefViewType | 'export'>('simple');
  const [viewData, setViewData] = useState<BriefView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef<string | undefined>(undefined);
  const callbackRef = useRef(onViewDataChange);
  callbackRef.current = onViewDataChange;

  const loadView = useCallback(
    async (viewType: BriefViewType) => {
      setLoading(true);
      setError(null);
      try {
        const api = getApiClient();
        const data = await api.getBriefView({
          session_id: sessionId,
          brief_version: version,
          view_type: viewType,
        });
        setViewData(data);
        callbackRef.current?.(data);
      } catch (e) {
        const err = e as Error & { requestId?: string };
        requestIdRef.current = err.requestId;
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, version],
  );

  useEffect(() => {
    setActiveView('simple');
    void loadView('simple');
  }, [loadView]);

  const handleTabChange = (viewType: BriefViewType | 'export') => {
    if (viewType === activeView || loading) return;
    setActiveView(viewType);
    void loadView(viewType === 'export' ? 'exec' : viewType);
  };

  return (
    <section className="flex flex-col gap-4">
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="简报视图切换"
        className="flex flex-wrap items-center gap-2"
      >
        {VIEW_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeView === tab.type;
          return (
            <button
              key={tab.type}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabChange(tab.type)}
              disabled={loading}
              className={clsx(
                'app-chip brief-view-tab disabled:cursor-not-allowed disabled:opacity-60',
                !isActive && 'app-chip-muted',
              )}
              style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="app-card app-card-pad min-h-[200px]">
        {loading ? (
          <div
            className="app-state-box"
            style={{ minHeight: 200, padding: '32px 16px' }}
          >
            <Loader2 className="h-4 w-4 animate-spin icon" strokeWidth={1.5} />
            <span className="desc">正在加载简报视图…</span>
          </div>
        ) : error ? (
          <ErrorState
            title="视图加载失败"
            description={error.message}
            requestId={requestIdRef.current}
            onRetry={() => void loadView(activeView === 'export' ? 'exec' : activeView)}
          />
        ) : viewData && activeView === 'export' ? (
          <ExportDocumentView view={viewData} />
        ) : viewData ? (
          <ViewRenderer view={viewData} />
        ) : null}
      </div>
    </section>
  );
}

// ===== 视图渲染器 =====

function ViewRenderer({ view }: { view: BriefView }) {
  switch (view.view_type) {
    case 'simple':
      return <SimpleView view={view} />;
    case 'exec':
      return <ExecView view={view} />;
    default:
      return <SimpleView view={view} />;
  }
}

// ===== 概述 =====

const PRIORITY_STYLES: Record<string, { background: string; color: string }> = {
  P0: { background: 'rgba(160,108,108,0.14)', color: 'var(--aurora-rose)' },
  P1: { background: 'rgba(168,133,47,0.16)', color: 'var(--aurora-gold)' },
  P2: { background: 'rgba(107,138,126,0.16)', color: 'var(--aurora-sage)' },
  P3: { background: 'rgba(139,133,120,0.16)', color: 'var(--aurora-muted)' },
};

function renderInlinePriority(text: string) {
  // 将 P0/P1/P2/P3 标记渲染为彩色标签
  const parts = humanizeBriefText(text).split(/(P[0-3])(?=[\s、，,。]|$)/g);
  return parts.map((part, i) => {
    if (/^P[0-3]$/.test(part)) {
      return (
        <span
          key={i}
          className="mx-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold"
          style={PRIORITY_STYLES[part] ?? PRIORITY_STYLES.P3}
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function SimpleView({ view }: { view: BriefView }) {
  const sections = view.sections ?? [];
  const topContent = view.content ? view.content.split(/\n\n+/) : [];

  return (
    <article className="flex flex-col gap-4">
      {topContent.length > 0 && !sections.length && (
        <MarkdownBriefContent content={view.content} variant="simple" />
      )}

      {sections.map((section, idx) => {
        const isQuote = section.title.includes('原始想法') || section.title.includes('希望结果');
        const isScope = section.title.includes('范围') || section.title.includes('不做');
        const isPriority = section.title.includes('优先') || section.title.includes('核心需求');
        const isOption = section.title.includes('方案') || section.title.includes('取舍');
        const isNextStep = section.title.includes('下一步') || section.title.includes('建议');

        if (isPriority) {
          return (
            <div
              key={idx}
              className="rounded p-4"
              style={{
                border: '1px solid var(--aurora-hair)',
                background: 'rgba(255,255,255,0.4)',
              }}
            >
              <h4
                className="mb-2 text-[13px] font-semibold"
                style={{ color: 'var(--aurora-ink-soft)' }}
              >
                {section.title}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {section.content
                  .split(/[；;。]/)
                  .map((s) => humanizeBriefText(s.trim()))
                  .filter(Boolean)
                  .map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 rounded px-2 py-1 text-[12px]"
                      style={{
                        border: '1px solid var(--aurora-hair)',
                        background: 'var(--aurora-bg-deep)',
                        color: 'var(--aurora-ink)',
                      }}
                    >
                      {renderInlinePriority(item)}
                    </div>
                  ))}
              </div>
            </div>
          );
        }

        if (isOption) {
          return (
            <div
              key={idx}
              className="rounded p-4"
              style={{
                border: '1px solid rgba(168,133,47,0.30)',
                background: 'rgba(168,133,47,0.08)',
              }}
            >
              <h4
                className="mb-2 text-[13px] font-semibold"
                style={{ color: 'var(--aurora-gold)' }}
              >
                {section.title}
              </h4>
              <p
                className="text-[14px] leading-relaxed"
                style={{ color: 'var(--aurora-ink)' }}
              >
                {renderInlinePriority(section.content)}
              </p>
            </div>
          );
        }

        if (isScope) {
          return (
            <div
              key={idx}
              className="rounded p-4"
              style={{
                borderLeft: '4px solid var(--aurora-gold)',
                background: 'var(--aurora-bg-deep)',
              }}
            >
              <h4
                className="mb-1 text-[13px] font-semibold"
                style={{ color: 'var(--aurora-ink-soft)' }}
              >
                {section.title}
              </h4>
              <p
                className="text-[14px] leading-relaxed"
                style={{ color: 'var(--aurora-ink)' }}
              >
                {humanizeBriefText(section.content)}
              </p>
            </div>
          );
        }

        if (isQuote) {
          return (
            <blockquote
              key={idx}
              className="py-2 pl-4 pr-3"
              style={{
                borderLeft: '4px solid var(--aurora-hair-strong)',
                background: 'var(--aurora-bg-deep)',
              }}
            >
              <p
                className="text-[13px] italic"
                style={{ color: 'var(--aurora-ink-soft)' }}
              >
                {humanizeBriefText(section.content)}
              </p>
              <cite
                className="mt-1 block text-[12px] not-italic"
                style={{ color: 'var(--aurora-muted)' }}
              >
                {section.title}
              </cite>
            </blockquote>
          );
        }

        if (isNextStep) {
          return (
            <div
              key={idx}
              className="rounded p-4"
              style={{
                background: 'var(--aurora-ink)',
                color: 'var(--aurora-bg)',
              }}
            >
              <h4 className="mb-1 text-[13px] font-semibold">{section.title}</h4>
              <p className="text-[14px] leading-relaxed">{humanizeBriefText(section.content)}</p>
            </div>
          );
        }

        return (
          <div key={idx} className="flex flex-col gap-1">
            <h4
              className="text-[13px] font-semibold"
              style={{ color: 'var(--aurora-ink-soft)' }}
            >
              {section.title}
            </h4>
            <p
              className="text-[14px] leading-relaxed"
              style={{ color: 'var(--aurora-ink)' }}
            >
              {renderInlinePriority(section.content)}
            </p>
          </div>
        );
      })}
    </article>
  );
}

// ===== 详细报告 =====

function ExecView({ view }: { view: BriefView }) {
  const sections = view.sections ?? [];

  return (
    <article className="flex flex-col gap-4">
      {sections.length === 0 && (
        <MarkdownBriefContent content={view.content} variant="exec" />
      )}
      {sections.map((section, idx) => {
        const lines = section.content.split('\n').filter((l) => l.trim());
        const hasTable = lines.some((l) => l.trim().startsWith('|'));
        const hasList = lines.some((l) => /^[-*]\s/.test(l.trim()));

        if (hasTable) {
          const tableLines = lines.filter((l) => l.trim().startsWith('|'));
          // 第一行表头，第二行分隔符，其余数据行
          const header = tableLines[0]
            ?.split('|')
            .map((c) => c.trim())
            .filter(Boolean) ?? [];
          const dataRows = tableLines
            .slice(2)
            .map((l) =>
              l
                .split('|')
                .map((c) => c.trim())
                .filter(Boolean),
            );

          return (
            <div key={idx} className="flex flex-col gap-2">
              <h4
                className="text-[13px] font-semibold"
                style={{ color: 'var(--aurora-ink-soft)' }}
              >
                {section.title}
              </h4>
              <div
                className="overflow-x-auto rounded"
                style={{ border: '1px solid var(--aurora-hair)' }}
              >
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr style={{ background: 'var(--aurora-bg-deep)' }}>
                      {header.map((h, i) => (
                        <th
                          key={i}
                          className="px-2.5 py-2 text-left font-semibold"
                          style={{
                            borderBottom: '1px solid var(--aurora-hair)',
                            color: 'var(--aurora-ink-soft)',
                          }}
                        >
                          {humanizeBriefText(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, ri) => (
                      <tr
                        key={ri}
                        style={{
                          background:
                            ri % 2 === 0
                              ? 'rgba(255,255,255,0.5)'
                              : 'var(--aurora-bg-deep)',
                        }}
                      >
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="px-2.5 py-1.5"
                            style={{
                              borderBottom: '1px solid var(--aurora-hair)',
                              color: 'var(--aurora-ink)',
                            }}
                          >
                            {humanizeBriefText(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        if (hasList) {
          return (
            <div key={idx} className="flex flex-col gap-2">
              <h4
                className="text-[13px] font-semibold"
                style={{ color: 'var(--aurora-ink-soft)' }}
              >
                {section.title}
              </h4>
              <ul className="flex flex-col gap-1.5">
                {lines.map((l, i) => {
                  const text = humanizeBriefText(l.trim().replace(/^[-*]\s+/, ''));
                  // 高亮键值对 "key: value"
                  const kvMatch = text.match(/^([^:：]+)[：:]\s*(.*)$/);
                  if (kvMatch) {
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-[13px]"
                        style={{ color: 'var(--aurora-ink)' }}
                      >
                        <span
                          className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full"
                          style={{ background: 'var(--aurora-gold)' }}
                        />
                        <span>
                          <span
                            className="font-semibold"
                            style={{ color: 'var(--aurora-ink-soft)' }}
                          >
                            {kvMatch[1]}：
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>
                            {kvMatch[2]}
                          </span>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[13px]"
                      style={{ color: 'var(--aurora-ink)' }}
                    >
                      <span
                        className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full"
                        style={{ background: 'var(--aurora-gold)' }}
                      />
                      <span>{text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }

        return (
          <div key={idx} className="flex flex-col gap-1">
            <h4
              className="text-[13px] font-semibold"
              style={{ color: 'var(--aurora-ink-soft)' }}
            >
              {section.title}
            </h4>
            <pre
              className="whitespace-pre-wrap rounded p-3 text-[13px] leading-relaxed"
              style={{
                border: '1px solid var(--aurora-hair)',
                background: 'rgba(255,255,255,0.5)',
                color: 'var(--aurora-ink)',
              }}
            >
            {humanizeBriefText(section.content)}
            </pre>
          </div>
        );
      })}
    </article>
  );
}

function ExportDocumentView({ view }: { view: BriefView }) {
  return (
    <article className="brief-export-document">
      <header className="brief-export-document__head">
        <div className="app-label">导出文档</div>
        <h3>可复制的专业需求文档</h3>
        <p>
          内容与专业报告同源，适合复制到协作文档、评审材料或后续 PDF 排版中。
        </p>
      </header>
      <MarkdownBriefContent content={view.content} variant="exec" />
    </article>
  );
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] };

export function MarkdownBriefContent({
  content,
  variant,
}: {
  content: string;
  variant: 'simple' | 'exec';
}) {
  const blocks = parseMarkdownBlocks(content);
  if (blocks.length === 0) {
    return (
      <p className="text-[14px] leading-relaxed" style={{ color: 'var(--aurora-muted)' }}>
        暂无内容。
      </p>
    );
  }

  return (
    <div className={variant === 'simple' ? 'brief-rendered brief-rendered--simple' : 'brief-rendered'}>
      {blocks.map((block, index) => renderMarkdownBlock(block, index, variant))}
    </div>
  );
}

function renderMarkdownBlock(block: MarkdownBlock, index: number, variant: 'simple' | 'exec'): ReactNode {
  if (block.type === 'heading') {
    const levelClass = block.level <= 1 ? 'brief-rendered__title' : 'brief-rendered__heading';
    return (
      <h3 key={index} className={levelClass}>
        {humanizeBriefText(block.text)}
      </h3>
    );
  }

  if (block.type === 'paragraph') {
    return (
      <p key={index} className={variant === 'simple' ? 'brief-rendered__lead' : 'brief-rendered__paragraph'}>
        {renderInlinePriority(block.text)}
      </p>
    );
  }

  if (block.type === 'list') {
    return (
      <ul key={index} className="brief-rendered__list">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInlinePriority(item)}</li>
        ))}
      </ul>
    );
  }

  return (
    <div key={index} className="brief-rendered__table-wrap">
      <table className="brief-rendered__table">
        <thead>
          <tr>
            {block.header.map((cell, cellIndex) => (
              <th key={cellIndex}>{humanizeBriefText(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{humanizeBriefText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]?.trim() ?? '';
    if (!line) {
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const split = splitInlineHeadingText(heading[2]);
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: split.title,
      });
      if (split.rest) {
        blocks.push({ type: 'paragraph', text: split.rest });
      }
      i += 1;
      continue;
    }

    if (isTableLine(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i]?.trim() ?? '')) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      const parsed = parseMarkdownTable(tableLines);
      if (parsed) {
        blocks.push(parsed);
      }
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i]?.trim() ?? '';
      if (!current || /^(#{1,3})\s+/.test(current) || isTableLine(current) || /^[-*]\s+/.test(current)) {
        break;
      }
      paragraphLines.push(current);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

function isTableLine(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|') && line.includes('|');
}

function splitInlineHeadingText(text: string): { title: string; rest: string | null } {
  if (text.length < 36) return { title: text, rest: null };
  const match = text.match(/^(.{4,24}[）)])\s+(.{8,})$/);
  if (!match) return { title: text, rest: null };
  return { title: match[1], rest: match[2] };
}

function parseMarkdownTable(lines: string[]): MarkdownBlock | null {
  if (lines.length < 2) return null;
  const header = splitMarkdownRow(lines[0]);
  const bodyStart = isMarkdownSeparatorRow(lines[1]) ? 2 : 1;
  const rows = lines.slice(bodyStart).map(splitMarkdownRow).filter((row) => row.length > 0);
  if (header.length === 0 || rows.length === 0) return null;
  return { type: 'table', header, rows };
}

function splitMarkdownRow(line: string): string[] {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isMarkdownSeparatorRow(line: string): boolean {
  return splitMarkdownRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function humanizeBriefText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\bcovered\b/g, '已确认')
    .replace(/\bpartial\b/g, '还需确认')
    .replace(/\binferred\b/g, '初步判断')
    .replace(/\bmissing\b/g, '尚未提供')
    .replace(/\bnot_started\b/g, '尚未开始');
}

// ===== 后续任务素材（内部兼容） =====

function AiTaskView({ view }: { view: BriefView }) {
  const sections = view.sections ?? [];

  return (
    <article className="flex flex-col gap-3">
      {sections.length === 0 && (
        <div
          className="rounded p-4"
          style={{ background: 'var(--aurora-ink)', color: 'var(--aurora-bg)' }}
        >
          <pre
            className="whitespace-pre-wrap text-[13px] leading-relaxed"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {view.content}
          </pre>
        </div>
      )}
      {sections.map((section, idx) => {
        const content = section.content;
        // 检测是否含代码块 ```
        const codeBlockMatch = content.match(/```([\s\S]*?)```/);
        const hasCodeBlock = !!codeBlockMatch;
        const hasTaskList = /\[ \]|\[x\]/i.test(content);
        const hasKeyValue = /^[^:：\n]+[：:]\s*.+$/m.test(content);

        if (hasCodeBlock) {
          const codeContent = codeBlockMatch ? codeBlockMatch[1].trim() : '';
          const lines = codeContent.split('\n');
          return (
            <div key={idx} className="flex flex-col gap-2">
              <h4
                className="text-[13px] font-semibold"
                style={{ color: 'var(--aurora-gold)' }}
              >
                {section.title}
              </h4>
              <div
                className="rounded p-4"
                style={{ background: 'var(--aurora-ink)', color: 'var(--aurora-bg)' }}
              >
                <div className="flex flex-col gap-1">
                  {lines.map((line, i) => {
                    const taskMatch = line.match(/^\[\s?\]\s*(.*)$/);
                    const doneMatch = line.match(/^\[x\]\s*(.*)$/i);
                    if (taskMatch) {
                      return (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-[13px]"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          <Square
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            strokeWidth={1.5}
                            style={{ color: 'var(--aurora-muted)' }}
                            aria-hidden="true"
                          />
                          <span>{taskMatch[1]}</span>
                        </div>
                      );
                    }
                    if (doneMatch) {
                      return (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-[13px]"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          <CheckSquare
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            strokeWidth={1.5}
                            style={{ color: 'var(--aurora-sage)' }}
                            aria-hidden="true"
                          />
                          <span className="line-through opacity-70">{doneMatch[1]}</span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        className="text-[13px]"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {renderKeyValueHighlight(line)}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

        if (hasTaskList) {
          const lines = content.split('\n').filter((l) => l.trim());
          return (
            <div key={idx} className="flex flex-col gap-2">
              <h4
                className="text-[13px] font-semibold"
                style={{ color: 'var(--aurora-gold)' }}
              >
                {section.title}
              </h4>
              <div
                className="rounded p-4"
                style={{ background: 'var(--aurora-ink)', color: 'var(--aurora-bg)' }}
              >
                <div className="flex flex-col gap-1">
                  {lines.map((line, i) => {
                    const taskMatch = line.match(/^\[\s?\]\s*(.*)$/);
                    const doneMatch = line.match(/^\[x\]\s*(.*)$/i);
                    if (taskMatch) {
                      return (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-[13px]"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          <Square
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            strokeWidth={1.5}
                            style={{ color: 'var(--aurora-muted)' }}
                            aria-hidden="true"
                          />
                          <span>{taskMatch[1]}</span>
                        </div>
                      );
                    }
                    if (doneMatch) {
                      return (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-[13px]"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          <CheckSquare
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            strokeWidth={1.5}
                            style={{ color: 'var(--aurora-sage)' }}
                            aria-hidden="true"
                          />
                          <span className="line-through opacity-70">{doneMatch[1]}</span>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        className="text-[13px]"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {renderKeyValueHighlight(line)}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

        if (hasKeyValue) {
          const lines = content.split('\n').filter((l) => l.trim());
          return (
            <div key={idx} className="flex flex-col gap-2">
              <h4
                className="text-[13px] font-semibold"
                style={{ color: 'var(--aurora-gold)' }}
              >
                {section.title}
              </h4>
              <div
                className="rounded p-4"
                style={{ background: 'var(--aurora-ink)', color: 'var(--aurora-bg)' }}
              >
                <div className="flex flex-col gap-1">
                  {lines.map((line, i) => (
                    <div
                      key={i}
                      className="text-[13px]"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {renderKeyValueHighlight(line)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={idx} className="flex flex-col gap-1">
            <h4
              className="text-[13px] font-semibold"
              style={{ color: 'var(--aurora-gold)' }}
            >
              {section.title}
            </h4>
            <p
              className="text-[13px] leading-relaxed"
              style={{ color: 'var(--aurora-ink)' }}
            >
              {content}
            </p>
          </div>
        );
      })}
    </article>
  );
}

function renderKeyValueHighlight(line: string) {
  const kvMatch = line.match(/^([^:：]+)([：:]\s*)(.*)$/);
  if (kvMatch) {
    return (
      <>
        <span style={{ color: 'var(--aurora-gold)' }}>{kvMatch[1]}</span>
        <span style={{ color: 'var(--aurora-muted)' }}>{kvMatch[2]}</span>
        <span style={{ color: 'var(--aurora-bg)' }}>{kvMatch[3]}</span>
      </>
    );
  }
  // 处理列表项 "- xxx: yyy"
  const listKvMatch = line.match(/^(-\s+)([^:：]+)([：:]\s*)(.*)$/);
  if (listKvMatch) {
    return (
      <>
        <span style={{ color: 'var(--aurora-muted)' }}>{listKvMatch[1]}</span>
        <span style={{ color: 'var(--aurora-gold)' }}>{listKvMatch[2]}</span>
        <span style={{ color: 'var(--aurora-muted)' }}>{listKvMatch[3]}</span>
        <span style={{ color: 'var(--aurora-bg)' }}>{listKvMatch[4]}</span>
      </>
    );
  }
  return <span>{line}</span>;
}

// ===== 内部说明（兼容旧类型） =====

function LearnView({ view }: { view: BriefView }) {
  const sections = view.sections ?? [];
  const [card1, card2, ...rest] = sections;

  return (
    <article className="flex flex-col gap-4">
      {/* 对话式衬线引言 */}
      {view.content && (
        <blockquote
          className="py-3 pl-4 pr-3"
          style={{
            borderLeft: '4px solid var(--aurora-gold)',
            background: 'var(--aurora-bg-deep)',
            fontFamily: 'var(--font-display)',
          }}
        >
          <p
            className="text-[15px] italic leading-relaxed"
            style={{ color: 'var(--aurora-ink)' }}
          >
            {view.content}
          </p>
        </blockquote>
      )}

      {/* 双卡：补齐了什么 / 还缺什么 */}
      {(card1 || card2) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {card1 && (
            <div
              className="rounded p-4"
              style={{
                border: '1px solid rgba(107,138,126,0.30)',
                background: 'rgba(107,138,126,0.12)',
              }}
            >
              <h4
                className="mb-2 text-[13px] font-semibold"
                style={{ color: 'var(--aurora-sage)' }}
              >
                {card1.title}
              </h4>
              <p
                className="whitespace-pre-wrap text-[13px] leading-relaxed"
                style={{ color: 'var(--aurora-ink)' }}
              >
                {card1.content}
              </p>
            </div>
          )}
          {card2 && (
            <div
              className="rounded p-4"
              style={{
                border: '1px solid rgba(160,108,108,0.30)',
                background: 'rgba(160,108,108,0.12)',
              }}
            >
              <h4
                className="mb-2 text-[13px] font-semibold"
                style={{ color: 'var(--aurora-rose)' }}
              >
                {card2.title}
              </h4>
              <p
                className="whitespace-pre-wrap text-[13px] leading-relaxed"
                style={{ color: 'var(--aurora-ink)' }}
              >
                {card2.content}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 其余段落 */}
      {rest.length > 0 && (
        <div className="flex flex-col gap-3">
          {rest.map((section, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <h4
                className="text-[13px] font-semibold"
                style={{
                  color: 'var(--aurora-ink-soft)',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {section.title}
              </h4>
              <p
                className="whitespace-pre-wrap text-[13px] leading-relaxed"
                style={{ color: 'var(--aurora-ink)' }}
              >
                {section.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
