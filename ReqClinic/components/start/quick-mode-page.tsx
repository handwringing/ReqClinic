'use client';

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ProductBrandText } from '@/components/common/product-brand';
import { PRODUCT_TERMS } from '@/lib/product-language';
import { DynamicBackground } from './dynamic-background';
import { PromptBar } from './prompt-bar';
import { quickDemoSelections, type QuickDemoSelection } from '@/lib/quick-demo-cases';
import { getApiClient } from '@/lib/api';
import { quickStaticSessionId } from '@/lib/static-demo-ids';

const QUICK_CASES = quickDemoSelections();

export function QuickModePage() {
  const router = useRouter();
  const [launchingCaseId, setLaunchingCaseId] = useState<string | null>(null);

  const warmDemoCase = useCallback(
    (item: QuickDemoSelection) => {
      getApiClient();
      router.prefetch(`/quick/${quickStaticSessionId(item.sourceCaseId)}`);
    },
    [router],
  );

  const startDemoCase = useCallback(
    async (item: QuickDemoSelection) => {
      if (launchingCaseId) return;
      setLaunchingCaseId(item.sourceCaseId);
      warmDemoCase(item);
      try {
        const session = await getApiClient().createQuickSession({
          source_kind: 'sample',
          source_case_id: item.sourceCaseId,
          original_input: item.originalInput,
        });
        router.push(`/quick/${session.id}`);
      } catch {
        setLaunchingCaseId(null);
      }
    },
    [launchingCaseId, router, warmDemoCase],
  );

  return (
    <div className="start-aurora">
      <DynamicBackground />
      <div className="topline" />

      <div className="topbar">
        <div className="start-nav-left">
          <button type="button" className="mode-back" onClick={() => router.back()}>
            <ArrowLeft size={15} strokeWidth={1.5} aria-hidden="true" />
            返回
          </button>
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

      <div className="mode-stage">
        <div className="quick-mode-layout">
          <ModePanel
            eyebrow="快速问诊"
            title="一句话开始，整理成需求简报。"
            description="输入一个真实想法，或直接选择示例体验完整的追问、整理和生成简报流程。"
          >
            <PromptBar />
          </ModePanel>
          <QuickCaseGrid
            launchingCaseId={launchingCaseId}
            onStartDemo={startDemoCase}
            onWarmDemo={warmDemoCase}
          />
        </div>
      </div>
    </div>
  );
}

function QuickCaseGrid({
  launchingCaseId,
  onStartDemo,
  onWarmDemo,
}: {
  launchingCaseId: string | null;
  onStartDemo: (item: QuickDemoSelection) => void;
  onWarmDemo: (item: QuickDemoSelection) => void;
}) {
  return (
    <div className="mode-case-grid mode-case-grid-outside" aria-label="快速问诊示例体验">
      {QUICK_CASES.map((item) => (
        <button
          key={item.sourceCaseId}
          type="button"
          className="mode-case-card mode-case-card-compact"
          onPointerEnter={() => onWarmDemo(item)}
          onPointerDown={() => onWarmDemo(item)}
          onFocus={() => onWarmDemo(item)}
          onClick={() => onStartDemo(item)}
          disabled={launchingCaseId !== null}
        >
          <span className="mode-case-kicker">
            {launchingCaseId === item.sourceCaseId ? '正在打开示例' : item.templateLabel}
          </span>
          <span className="mode-case-title">{item.title}</span>
        </button>
      ))}
    </div>
  );
}

function ModePanel({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mode-dialog" aria-label={eyebrow}>
      <div className="mode-dialog-head">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="aurora-title mode-title">{title}</h1>
        <p className="tagline">{description}</p>
      </div>
      <div className="mode-dialog-body">{children}</div>
    </section>
  );
}
