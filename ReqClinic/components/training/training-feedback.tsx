'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Check,
  ListChecks,
  Loader2,
  RotateCcw,
  Sparkles,
  Trophy,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import type { TrainingAttempt, TrainingFeedback } from '@/lib/api/types';

export interface TrainingFeedbackPageProps {
  attempt: TrainingAttempt;
  feedback: TrainingFeedback;
  onRetry: () => Promise<void>;
  onComplete: () => Promise<void>;
}

function normalizeCoverageScore(score: number): number {
  const value = score <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, Math.round(value)));
}

type VisibleDimension = '目标' | '对象' | '场景' | '边界' | '验收';

interface TrainingTrendEntry {
  attemptId: string;
  caseId: string;
  createdAt: string;
  score: number;
  dimensions: Record<VisibleDimension, 'covered' | 'partial' | 'missing'>;
}

const VISIBLE_DIMENSIONS: VisibleDimension[] = ['目标', '对象', '场景', '边界', '验收'];

function visibleDimensionFor(label: string): VisibleDimension {
  if (/目标|结果|成功|价值|指标/.test(label)) return '目标';
  if (/对象|用户|角色|受众|相关人|确认人/.test(label)) return '对象';
  if (/场景|流程|触点|使用|情境/.test(label)) return '场景';
  if (/边界|范围|限制|排除|风险|约束/.test(label)) return '边界';
  if (/验收|标准|判断|完成|质量|交付/.test(label)) return '验收';
  return '边界';
}

function buildTrendEntry(
  attempt: TrainingAttempt,
  feedback: TrainingFeedback,
  score: number,
): TrainingTrendEntry {
  const dimensions = Object.fromEntries(
    VISIBLE_DIMENSIONS.map((dimension) => [dimension, 'missing']),
  ) as TrainingTrendEntry['dimensions'];

  for (const item of feedback.dimension_breakdown) {
    const dimension = visibleDimensionFor(item.dimension);
    const current = dimensions[dimension];
    if (current === 'covered') continue;
    if (item.status === 'covered' || (item.status === 'partial' && current === 'missing')) {
      dimensions[dimension] = item.status;
    }
  }

  return {
    attemptId: attempt.attempt_id,
    caseId: attempt.case_id,
    createdAt: new Date().toISOString(),
    score,
    dimensions,
  };
}

function dimensionLabel(status: 'covered' | 'partial' | 'missing'): string {
  if (status === 'covered') return '已覆盖';
  if (status === 'partial') return '还可补问';
  return '还没问到';
}

export function TrainingFeedbackPage({
  attempt,
  feedback,
  onRetry,
  onComplete,
}: TrainingFeedbackPageProps) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [completing, setCompleting] = useState(false);
  const isCompleted = attempt.status === 'completed';
  const isSampleAttempt =
    attempt.source_kind === 'sample' ||
    attempt.case_version === 'demo' ||
    attempt.case_id.startsWith('demo-training');

  // coverage_score 是 0–1 之间的覆盖率，前端展示成百分比；建议达成水平 60%。
  const totalPct = normalizeCoverageScore(feedback.coverage_score);
  const passThreshold = 60;
  const isPass = totalPct >= passThreshold;
  const currentTrend = useMemo(
    () => buildTrendEntry(attempt, feedback, totalPct),
    [attempt, feedback, totalPct],
  );

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await onComplete();
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div
      className="training-feedback-shell page-motion-shell"
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header className="app-topbar" style={{ flexShrink: 0 }}>
        <div className="brand-mark" style={{ gap: 12 }}>
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
        </div>
        <div className="meta" style={{ gap: 8 }}>
          <span className="app-chip app-chip-muted">
            表达训练
          </span>
          {isSampleAttempt && (
            <span className="app-chip app-chip-muted">
              案例演示
            </span>
          )}
        </div>
      </header>
      <main
        className="training-feedback-main page-motion-stage page-motion-list"
        style={{
          maxWidth: 880,
          margin: '0 auto',
          width: '100%',
          padding: '28px 24px 120px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* 顶部总分 */}
        <header
          className="app-card app-card-pad"
          aria-label="本轮练习覆盖度"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{
                  background: isPass
                    ? 'rgba(107,138,126,0.16)'
                    : 'rgba(160,108,108,0.16)',
                }}
              >
                <Trophy
                  className="h-5 w-5"
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{
                    color: isPass
                      ? 'var(--aurora-sage)'
                      : 'var(--aurora-rose)',
                  }}
                />
              </div>
              <div>
                <div className="app-label" style={{ marginBottom: 4 }}>
                  本轮反馈
                </div>
                <div style={{ fontSize: 14, color: 'var(--aurora-ink-soft)' }}>
                  {isPass ? '已达到本轮建议目标' : '继续练习以提升覆盖度'}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {isCompleted && (
                <span className="app-chip app-chip-sage">
                  <Check
                    className="h-3 w-3"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  练习已完成
                </span>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-3">
            <span
              style={{
                fontSize: 32,
                fontWeight: 600,
                lineHeight: 1,
                fontFamily: 'var(--font-fraunces), var(--font-noto-serif-sc), serif',
                color: 'var(--aurora-ink)',
              }}
            >
              {totalPct}%
            </span>
            <span
              className="pb-1 ml-auto"
              style={{
                fontSize: 12,
                color: 'var(--aurora-muted)',
                fontFamily: 'var(--font-ibm-plex-mono), monospace',
              }}
            >
              本轮建议目标 {passThreshold}%
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="app-chip">覆盖度 {totalPct}%</span>
            <span className={isPass ? 'app-chip app-chip-sage' : 'app-chip app-chip-rose'}>
              {isPass ? '已达成' : '继续练习'}
            </span>
          </div>

          <p
            className="mt-3"
            style={{
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--aurora-muted)',
            }}
          >
            分数只代表本轮练习反馈，不代表能力认证。
          </p>
        </header>

        <section className="mt-6 app-card app-card-pad" aria-label="本轮覆盖概览">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="app-label" style={{ marginBottom: 6 }}>
                本轮覆盖
              </div>
              <h2 className="app-title app-title-md">本轮追问覆盖</h2>
            </div>
            <span className="app-chip app-chip-muted">
              本次结果
            </span>
          </div>
          <div className="training-trend-grid" style={{ marginTop: 14 }}>
            {VISIBLE_DIMENSIONS.map((dimension) => {
              const status = currentTrend.dimensions[dimension];
              return (
                <div key={dimension} className={`training-trend-card training-trend-card--${status}`}>
                  <span>{dimension}</span>
                  <strong>{dimensionLabel(status)}</strong>
                </div>
              );
            })}
          </div>
          <p
            className="mt-3"
            style={{
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--aurora-muted)',
            }}
          >
            本页只展示这一次练习的结果；重新再来会回到当前案例开头。
          </p>
        </section>

        {/* 覆盖情况 */}
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks
              className="h-4 w-4"
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: 'var(--aurora-gold)' }}
            />
            <h2 className="app-title app-title-md">追问覆盖情况</h2>
          </div>
          <div className="flex flex-col gap-3">
            {feedback.dimension_breakdown.map((dim, idx) => {
              const isCovered = dim.status === 'covered';
              const isMissing = dim.status === 'missing';
              const barColor = isCovered
                ? 'var(--aurora-sage)'
                : isMissing
                  ? 'var(--aurora-rose)'
                  : 'var(--aurora-gold)';
              const statusLabel = isCovered ? '已覆盖' : isMissing ? '还没问到' : '还可补问';
              return (
                <article
                  key={`${dim.dimension}-${idx}`}
                  className="app-card app-card-pad"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {isCovered ? (
                        <CheckCircle2
                          className="h-4 w-4"
                          strokeWidth={1.5}
                          aria-hidden="true"
                          style={{ color: 'var(--aurora-sage)' }}
                        />
                      ) : isMissing ? (
                        <XCircle
                          className="h-4 w-4"
                          strokeWidth={1.5}
                          aria-hidden="true"
                          style={{ color: 'var(--aurora-rose)' }}
                        />
                      ) : (
                        <AlertCircle
                          className="h-4 w-4"
                          strokeWidth={1.5}
                          aria-hidden="true"
                          style={{ color: 'var(--aurora-gold)' }}
                        />
                      )}
                      <h3 className="app-title app-title-sm">{dim.dimension}</h3>
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: barColor,
                        fontFamily: 'var(--font-ibm-plex-mono), monospace',
                      }}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  {dim.evidence && (
                    <div
                      className="mt-3"
                      style={{
                        background: 'rgba(139,133,120,0.10)',
                        borderLeft: '2px solid var(--aurora-hair-strong)',
                        padding: '8px 12px',
                      }}
                    >
                      <div
                        className="app-label"
                        style={{ marginBottom: 2 }}
                      >
                        依据
                      </div>
                      <p
                        style={{
                          fontSize: 12,
                          lineHeight: '1.65',
                          color: 'var(--aurora-ink-soft)',
                        }}
                      >
                        {dim.evidence}
                      </p>
                    </div>
                  )}

                  {dim.comment && (
                    <p
                      className="mt-2"
                      style={{
                        fontSize: 12,
                        lineHeight: '1.65',
                        color: 'var(--aurora-ink-soft)',
                      }}
                    >
                      {dim.comment}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {/* 可补问方向 */}
        {feedback.missing_dimensions.length > 0 && (
          <section className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <XCircle
                className="h-4 w-4"
                strokeWidth={1.5}
                aria-hidden="true"
                style={{ color: 'var(--aurora-rose)' }}
              />
              <h2 className="app-title app-title-md">还可以补问的方向</h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {feedback.missing_dimensions.map((m, i) => (
                <span key={i} className="app-chip app-chip-rose">
                  {m}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* 改进建议 */}
        {feedback.improvement_suggestions.length > 0 && (
          <section className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles
                className="h-4 w-4"
                strokeWidth={1.5}
                aria-hidden="true"
                style={{ color: 'var(--aurora-gold)' }}
              />
              <h2 className="app-title app-title-md">改进建议</h2>
            </div>
            <ol className="flex flex-col gap-2">
              {feedback.improvement_suggestions.map((tip, i) => (
                <li
                  key={i}
                  className="app-card flex items-start gap-3"
                  style={{ padding: '12px 16px' }}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: 'rgba(168,133,47,0.14)',
                      color: 'var(--aurora-gold)',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'var(--font-ibm-plex-mono), monospace',
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      lineHeight: '1.65',
                      color: 'var(--aurora-ink)',
                    }}
                  >
                    {tip}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* 改写示例 */}
        {feedback.improvement_examples.length > 0 && (
          <section className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles
                className="h-4 w-4"
                strokeWidth={1.5}
                aria-hidden="true"
                style={{ color: 'var(--aurora-gold)' }}
              />
              <h2 className="app-title app-title-md">改写示例</h2>
            </div>
            <div className="flex flex-col gap-3">
              {feedback.improvement_examples.map((ex, i) => (
                <article
                  key={i}
                  className="app-card app-card-pad"
                >
                  <div className="flex flex-col gap-2">
                    <div>
                      <div className="app-label" style={{ marginBottom: 4 }}>
                        改前
                      </div>
                      <p
                        style={{
                          fontSize: 13,
                          lineHeight: '1.65',
                          color: 'var(--aurora-ink-soft)',
                        }}
                      >
                        {ex.before}
                      </p>
                    </div>
                    <div>
                      <div className="app-label" style={{ marginBottom: 4 }}>
                        改后
                      </div>
                      <p
                        style={{
                          fontSize: 13,
                          lineHeight: '1.65',
                          color: 'var(--aurora-ink)',
                        }}
                      >
                        {ex.after}
                      </p>
                    </div>
                    <div>
                      <div className="app-label" style={{ marginBottom: 4 }}>
                        原因
                      </div>
                      <p
                        style={{
                          fontSize: 12,
                          lineHeight: '1.65',
                          color: 'var(--aurora-muted)',
                        }}
                      >
                        {ex.reason}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* 底部按钮 */}
        <footer
          className="mt-8 flex items-center justify-end gap-3"
        >
          <button
            type="button"
            className="app-btn-ghost"
            disabled={completing || retrying}
            onClick={() => void handleRetry()}
            aria-busy={retrying || undefined}
          >
            {retrying ? (
              <Loader2
                className="h-4 w-4 animate-spin"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            ) : (
              <RotateCcw
                className="h-4 w-4"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            )}
            重新再来
          </button>
          <button
            type="button"
            className="app-btn-primary"
            disabled={isCompleted || retrying || completing}
            onClick={() => void handleComplete()}
            aria-busy={completing || undefined}
          >
            {completing ? (
              <Loader2
                className="h-4 w-4 animate-spin"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            ) : (
              <Check
                className="h-4 w-4"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            )}
            {isCompleted ? '已完成' : '完成练习'}
          </button>
        </footer>

        <p
          className="mt-6"
          style={{
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--aurora-muted)',
            textAlign: 'center',
          }}
        >
          本轮反馈仅用于练习复盘，不构成权威评估。
        </p>
      </main>
    </div>
  );
}

