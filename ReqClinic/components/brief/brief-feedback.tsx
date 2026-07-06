'use client';

import { clsx } from 'clsx';
import {
  CheckCircle,
  ChevronDown,
  Loader2,
  MessageSquare,
  Send,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { getApiClient } from '@/lib/api';
import type { BriefUsefulnessFeedback } from '@/lib/api/types';
import { useToast } from '@/components/ui';

interface BriefFeedbackProps {
  sessionId: string;
  version: number;
  /** 是否默认展开 */
  defaultOpen?: boolean;
  className?: string;
}

type Rating = BriefUsefulnessFeedback['rating'];

type RatingOption = {
  value: Rating;
  label: string;
  selectedStyle: { borderColor: string; background: string; color: string };
  icon: typeof CheckCircle;
};

const RATING_OPTIONS: RatingOption[] = [
  {
    value: 'directly_usable',
    label: '可直接使用或仅需微调',
    selectedStyle: {
      borderColor: 'var(--aurora-sage)',
      background: 'rgba(107,138,126,0.12)',
      color: 'var(--aurora-sage)',
    },
    icon: CheckCircle,
  },
  {
    value: 'needs_major_changes',
    label: '需要大改',
    selectedStyle: {
      borderColor: 'var(--aurora-gold)',
      background: 'rgba(168,133,47,0.12)',
      color: 'var(--aurora-gold)',
    },
    icon: MessageSquare,
  },
  {
    value: 'unusable',
    label: '不可用',
    selectedStyle: {
      borderColor: 'var(--aurora-rose)',
      background: 'rgba(160,108,108,0.12)',
      color: 'var(--aurora-rose)',
    },
    icon: XCircle,
  },
];

export function BriefFeedback({
  sessionId,
  version,
  defaultOpen = false,
  className,
}: BriefFeedbackProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [rating, setRating] = useState<Rating | null>(null);
  const [expectedUse, setExpectedUse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const canSubmit = rating !== null && !submitting;

  const handleSubmit = async () => {
    if (!rating || submitting) return;
    setSubmitting(true);
    try {
      const api = getApiClient();
      await api.submitBriefUsefulnessFeedback({
        session_id: sessionId,
        brief_version: version,
        feedback: {
          rating,
          expected_use: expectedUse.trim(),
        },
      });
      showToast({
        type: 'success',
        title: '反馈已提交',
        description: '感谢你的反馈，我们将持续改进简报质量。',
      });
      // 重置
      setRating(null);
      setExpectedUse('');
      setOpen(false);
    } catch {
      showToast({
        type: 'error',
        title: '提交失败',
        description: '请稍后重试',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={clsx('app-card', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <span
          className="app-label"
          style={{ fontSize: 11, color: 'var(--aurora-ink-soft)' }}
        >
          <MessageSquare
            className="h-4 w-4"
            strokeWidth={1.5}
            style={{ color: 'var(--aurora-muted)' }}
            aria-hidden="true"
          />
          可用性反馈
        </span>
        <ChevronDown
          className={clsx(
            'h-4 w-4 transition-transform',
            open && 'rotate-180',
          )}
          strokeWidth={1.5}
          style={{ color: 'var(--aurora-muted)' }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="px-5 pb-5 pt-2"
          style={{ borderTop: '1px solid var(--aurora-hair)' }}
        >
          {/* Rating 选择 */}
          <fieldset className="mb-4">
            <legend
              className="mb-2 block"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--aurora-ink-soft)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
              }}
            >
              这份简报对你来说可用程度如何？
            </legend>
            <div className="flex flex-col gap-2">
              {RATING_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = rating === opt.value;
                return (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-[13px] transition-colors"
                    style={
                      isSelected
                        ? opt.selectedStyle
                        : {
                            border: '1px solid var(--aurora-hair)',
                            background: 'transparent',
                            color: 'var(--aurora-ink-soft)',
                          }
                    }
                  >
                    <input
                      type="radio"
                      name="brief-rating"
                      value={opt.value}
                      checked={isSelected}
                      onChange={() => setRating(opt.value)}
                      className="sr-only"
                    />
                    <Icon
                      className="h-4 w-4"
                      strokeWidth={1.5}
                      style={{
                        color: isSelected ? undefined : 'var(--aurora-muted)',
                      }}
                      aria-hidden="true"
                    />
                    <span style={{ fontWeight: isSelected ? 600 : 400 }}>
                      {opt.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* 预期用途 */}
          <div className="mb-4">
            <label
              htmlFor="expected-use"
              className="mb-1.5 block"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--aurora-ink-soft)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
              }}
            >
              预期用途
            </label>
            <textarea
              id="expected-use"
              value={expectedUse}
              onChange={(e) => setExpectedUse(e.target.value)}
              placeholder="你打算如何使用这份简报？"
              className="app-textarea"
              maxLength={500}
            />
            <div
              className="mt-1 text-right text-[11px]"
              style={{ color: 'var(--aurora-muted)' }}
            >
              {expectedUse.length}/500
            </div>
          </div>

          {/* 提交按钮 */}
          <div className="flex justify-end">
            <button
              type="button"
              className="app-btn-primary"
              disabled={!canSubmit}
              aria-busy={submitting || undefined}
              onClick={() => void handleSubmit()}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              )}
              <span>提交反馈</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
