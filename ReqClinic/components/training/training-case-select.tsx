'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, GraduationCap, Loader2, PlayCircle } from 'lucide-react';
import { getApiClient } from '@/lib/api';
import type { TrainingCase, UUID } from '@/lib/api/types';
import { ProductBrandText } from '@/components/common/product-brand';
import {
  ErrorState,
  LoadingState,
  SkeletonCard,
} from '@/components/ui';
import { AppBackground } from '@/components/layout/app-background';
import { trainingStaticAttemptId } from '@/lib/static-demo-ids';

type DifficultyKey = TrainingCase['difficulty'];

const difficultyChip: Record<DifficultyKey, string> = {
  easy: 'app-chip app-chip-sage',
  medium: 'app-chip',
  hard: 'app-chip app-chip-rose',
};

const difficultyLabel: Record<DifficultyKey, string> = {
  easy: '入门',
  medium: '进阶',
  hard: '挑战',
};

const difficultyOrder: Record<DifficultyKey, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

let trainingCasesCache: TrainingCase[] | null = null;
let trainingCasesRequest: Promise<TrainingCase[]> | null = null;

function loadTrainingCases(forceRefresh = false): Promise<TrainingCase[]> {
  if (!forceRefresh && trainingCasesCache) return Promise.resolve(trainingCasesCache);
  if (trainingCasesRequest) return trainingCasesRequest;

  trainingCasesRequest = getApiClient()
    .listTrainingCases({ limit: 50, offset: 0 })
    .then((response) => {
      trainingCasesCache = response.items;
      return response.items;
    })
    .finally(() => {
      trainingCasesRequest = null;
    });

  return trainingCasesRequest;
}

export function TrainingCaseSelect() {
  const router = useRouter();
  const [cases, setCases] = useState<TrainingCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<UUID | null>(null);
  const sortedCases = useMemo(
    () =>
      [...(cases ?? [])].sort((a, b) => {
        const diff = difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title, 'zh-CN');
      }),
    [cases],
  );

  useEffect(() => {
    let cancelled = false;
    const cachedCases = trainingCasesCache;
    setCases(cachedCases);
    setError(null);
    loadTrainingCases(cachedCases !== null || reloadKey > 0)
      .then((items) => {
        if (!cancelled) setCases(items);
      })
      .catch((err) => {
        if (!cancelled && !cachedCases) {
          setError(err instanceof Error ? err.message : '加载练习情境失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const warmTrainingCase = (trainingCase: TrainingCase) => {
    router.prefetch(`/training/${trainingStaticAttemptId(trainingCase.id)}?source=sample`);
  };

  const handleStart = async (trainingCase: TrainingCase) => {
    if (busyId !== null) return;
    setBusyId(trainingCase.id);
    warmTrainingCase(trainingCase);
    try {
      const attempt = await getApiClient().createTrainingAttempt({
        case_id: trainingCase.id,
        case_version: trainingCase.version,
        source_kind: 'sample',
      });
      router.push(`/training/${attempt.attempt_id}?source=sample`);
    } catch (err) {
      setBusyId(null);
      setError(err instanceof Error ? err.message : '创建练习失败');
    }
  };

  return (
    <div className="app-content page-motion-shell" style={{ position: 'relative', minHeight: '100vh' }}>
      <AppBackground />

      {/* 顶栏 */}
      <div className="app-topbar">
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
        <div aria-hidden="true" />
      </div>

      <main
        className="app-content page-motion-stage"
        style={{
          position: 'relative',
          zIndex: 4,
          padding: '42px 32px 72px',
        }}
      >
        <section
          aria-label="表达训练入口"
          style={{
            width: 'min(1120px, 100%)',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
          }}
        >
        <header
          className="app-card app-card-pad training-cases-hero page-motion-panel--left"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: 24,
            alignItems: 'end',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              className="app-label"
              style={{ marginBottom: 12 }}
            >
              <GraduationCap size={14} strokeWidth={1.5} aria-hidden="true" />
              <span>练习独立进行 · 不影响项目内容</span>
            </div>
            <h1 className="app-title app-title-lg">
              选择<span className="accent">表达训练</span>
            </h1>
            <p
              style={{
                maxWidth: 680,
                lineHeight: '1.65',
                marginTop: 10,
                color: 'var(--aurora-ink-soft)',
                fontSize: 14,
              }}
            >
              选择一个案例演示，从预设追问中决定下一步，观察不同问法如何影响角色回答和反馈。演示不会影响任何项目内容。
            </p>
          </div>
          <span
            className="app-chip app-chip-muted"
            style={{
              maxWidth: 360,
              alignSelf: 'center',
              whiteSpace: 'normal',
              lineHeight: 1.55,
              padding: '8px 12px',
            }}
          >
            按入门、进阶、挑战排序。
          </span>
        </header>

        <section className="training-entry-layout" aria-label="表达训练入口">
          <div className="training-demo-entry page-motion-panel--right">
            <div className="app-label" style={{ marginBottom: 10 }}>
              <PlayCircle size={14} strokeWidth={1.5} aria-hidden="true" />
              案例演示
            </div>
            <h2 className="app-title app-title-md">选择一个演示案例</h2>
            <p className="training-entry-desc">
              每个案例都有不同的角色、信息边界和反馈重点。进入后请选择预设追问，案例会按你的选择继续展开。
            </p>
          </div>

          <div className="training-cases-list">
            {error && (
              <ErrorState
                description={error}
                onRetry={() => setReloadKey((k) => k + 1)}
                retryText="重新加载"
              />
            )}

            {!error && (
              <LoadingState
                isLoading={cases === null}
                delayMessage="正在打开练习情境…"
                fallback={
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <SkeletonCard key={i} />
                    ))}
                  </div>
                }
              >
                {sortedCases.length === 0 ? (
                  <div className="app-card app-card-pad app-state-box">
                    <p className="desc">暂无练习案例</p>
                    <button
                      type="button"
                      className="app-btn-ghost"
                      onClick={() => setReloadKey((k) => k + 1)}
                    >
                      重新加载
                    </button>
                  </div>
                ) : (
                  <div
                    className="page-motion-list"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: 14,
                      alignItems: 'stretch',
                    }}
                  >
                    {sortedCases.map((c) => {
                      const isBusy = busyId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => void handleStart(c)}
                          onPointerEnter={() => warmTrainingCase(c)}
                          onPointerDown={() => warmTrainingCase(c)}
                          onFocus={() => warmTrainingCase(c)}
                          disabled={busyId !== null}
                          className="app-card app-card-pad"
                          style={{
                            minHeight: 244,
                            textAlign: 'left',
                            cursor: busyId !== null ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 16,
                            transition:
                              'transform 0.3s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.3s ease, border-color 0.3s ease',
                          }}
                        >
                          <div>
                            <div
                              className="flex flex-wrap items-center gap-2"
                              style={{ marginBottom: 14 }}
                            >
                              <span className="app-chip app-chip-muted">{c.category}</span>
                              <span className={difficultyChip[c.difficulty]}>
                                {difficultyLabel[c.difficulty]}
                              </span>
                            </div>
                            <h3 className="app-title app-title-sm">{c.title}</h3>
                            <p
                              style={{
                                color: 'var(--aurora-ink-soft)',
                                fontSize: 13,
                                lineHeight: '1.68',
                                marginTop: 10,
                              }}
                            >
                              {c.description}
                            </p>
                          </div>
                          <div
                            className="flex items-center justify-between"
                            style={{
                              borderTop: '1px solid var(--aurora-hair)',
                              paddingTop: 12,
                            }}
                          >
                            <span
                              style={{
                                color: 'var(--aurora-muted)',
                                fontSize: 12,
                                fontFamily: 'var(--font-ibm-plex-mono), monospace',
                              }}
                            >
                              练习追问
                            </span>
                            {isBusy ? (
                              <Loader2
                                className="h-4 w-4 animate-spin"
                                strokeWidth={1.5}
                                aria-hidden="true"
                                style={{ color: 'var(--aurora-gold)' }}
                              />
                            ) : (
                              <span
                                style={{
                                  color: 'var(--aurora-gold)',
                                  fontSize: 12,
                                  fontFamily: 'var(--font-ibm-plex-mono), monospace',
                                }}
                              >
                                开始练习 →
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </LoadingState>
            )}
          </div>
        </section>
        </section>
      </main>
    </div>
  );
}

