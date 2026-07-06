'use client';

import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SplitterProps {
  /** localStorage 持久化 key，不传则不持久化 */
  storageKey?: string;
  defaultPct?: number;
  min?: number;
  max?: number;
  onChange?: (pct: number) => void;
  className?: string;
}

export function Splitter({
  storageKey,
  defaultPct = 45,
  min = 25,
  max = 75,
  onChange,
  className,
}: SplitterProps) {
  const [pct, setPct] = useState<number>(() => {
    if (storageKey && typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(storageKey);
      if (stored !== null) {
        const n = Number(stored);
        if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
      }
    }
    return Math.min(max, Math.max(min, defaultPct));
  });
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef(pct);
  pctRef.current = pct;

  const clamp = useCallback(
    (v: number) => Math.min(max, Math.max(min, v)),
    [min, max],
  );

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      setPct(clamped);
      onChange?.(clamped);
    },
    [clamp, onChange],
  );

  useEffect(() => {
    if (storageKey) {
      window.localStorage.setItem(storageKey, String(pct));
    }
  }, [pct, storageKey]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = e.clientX - rect.left;
    commit((x / rect.width) * 100);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handleDoubleClick = () => {
    commit(defaultPct);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      commit(clamp(pctRef.current - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      commit(clamp(pctRef.current + step));
    }
  };

  return (
    <div
      ref={containerRef}
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(pct)}
      tabIndex={0}
      className={clsx(
        'group relative shrink-0 cursor-col-resize select-none transition-all duration-fast',
        dragging
          ? 'w-2 bg-[var(--accent-600)]'
          : 'w-1 bg-[var(--border-default)] hover:w-2 hover:bg-[var(--accent-600)]',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {dragging && (
        <div
          className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--bg-inverse)] px-1.5 py-0.5 text-[11px] text-[var(--text-inverse)]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {Math.round(pct)}%
        </div>
      )}
    </div>
  );
}