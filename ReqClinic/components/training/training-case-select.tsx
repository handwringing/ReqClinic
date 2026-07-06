'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, GraduationCap, Loader2, PlayCircle, Sparkles } from 'lucide-react';
import { getApiClient } from '@/lib/api';
import type { TrainingCase, UUID } from '@/lib/api/types';
import { ProductBrandText } from '@/components/common/product-brand';
import {
  ErrorState,
  LoadingState,
  SkeletonCard,
} from '@/components/ui';
import { AppBackground } from '@/components/layout/app-background';

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

export function TrainingCaseSelect() {
  const router = useRouter();
  const [cases, setCases] = useState<TrainingCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<UUID | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customNotice, setCustomNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCases(null);
    setError(null);
    getApiClient()
      .listTrainingCases({ limit: 50, offset: 0 })
      .then((res) => {
        if (!cancelled) setCases(res.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载练习情境失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleStart = async (trainingCase: TrainingCase) => {
    if (busyId !== null) return;
    setBusyId(trainingCase.id);
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
    <div className="app-content" style={{ position: 'relative', minHeight: '100vh' }}>
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
        className="app-content"
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
          className="app-card app-card-pad training-cases-hero"
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
              选择一个固定情境练习追问。当前版本也可以先写下自己的练习场景，但暂时不会创建自定义回合。
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
            当前版本先开放固定情境练习。
          </span>
        </header>

        <section className="training-entry-layout" aria-label="表达训练入口">
          <div className="app-card app-card-pad training-custom-entry">
            <div className="app-label" style={{ marginBottom: 10 }}>
              <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
              自定义场景
            </div>
            <h2 className="app-title app-title-md">用自己的场景练习追问</h2>
            <p className="training-entry-desc">
              这里用于记录你想练习的场景。当前版本暂未开放自定义回合，输入内容不会提交。
            </p>
            <textarea
              className="app-textarea"
              value={customPrompt}
              onChange={(event) => {
                setCustomPrompt(event.target.value.slice(0, 1000));
                if (customNotice) setCustomNotice('');
              }}
              placeholder="描述你想练习澄清的场景，例如：团队只说想提升转化率，我想练习怎么追问目标、角色、边界和验收。"
              rows={5}
              style={{ minHeight: 132 }}
              aria-label="真实训练场景输入"
            />
            <div className="training-entry-actions">
              <span className="app-label">{customPrompt.length}/1000</span>
              <button
                type="button"
                className="app-btn-primary"
                onClick={() => setCustomNotice('当前版本暂未开放自定义练习。你可以先选择右侧示例体验；刚才输入的内容不会提交。')}
              >
                开始自定义练习
              </button>
            </div>
            {customNotice && (
              <div
                role="alert"
                className="app-chip app-chip-muted"
                style={{ alignSelf: 'flex-start', whiteSpace: 'normal', lineHeight: 1.55 }}
              >
                {customNotice}
              </div>
            )}
          </div>

          <div className="training-demo-entry">
            <div className="app-label" style={{ marginBottom: 10 }}>
              <PlayCircle size={14} strokeWidth={1.5} aria-hidden="true" />
              示例体验
            </div>
            <h2 className="app-title app-title-md">选择一个练习情境</h2>
            <p className="training-entry-desc">
              示例会创建独立练习回合，教练给出当前建议追问；角色只回答你问到的信息，反馈会指出遗漏维度。
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
                {(cases ?? []).length === 0 ? (
                  <div className="app-card app-card-pad app-state-box">
                    <p className="desc">暂无练习情境</p>
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
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: 14,
                      alignItems: 'stretch',
                    }}
                  >
                    {(cases ?? []).map((c) => {
                      const isBusy = busyId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => void handleStart(c)}
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

