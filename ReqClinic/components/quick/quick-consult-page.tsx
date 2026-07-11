'use client';

import { useCallback, useEffect, useState } from 'react';
import { getApiClient } from '@/lib/api';
import {
  buildQuickDemoFixture,
  getQuickDemoCase,
  quickDemoCardTitle,
  quickDemoReview,
  quickDemoSupplement,
} from '@/lib/quick-demo-cases';
import { quickStaticSessionId } from '@/lib/static-demo-ids';
import type {
  CoverageSlot,
  CoverageSlotName,
  CoverageSlotState,
  QuickSession,
  QuickSessionTurn,
  QuickSessionUnderstanding,
  QuickSessionUnknown,
} from '@/lib/api/types';
import { Splitter, ToastProvider } from '@/components/ui';
import { AppBackground } from '@/components/layout/app-background';
import { QuickTopbar } from './quick-topbar';
import { QuickDialogue } from './quick-dialogue';
import { QuickVisualization, type QuickCardBinding } from './quick-visualization';

const SPLIT_STORAGE_KEY = 'quick-split';
const SPLIT_DEFAULT = 45;
const SPLIT_MIN = 25;
const SPLIT_MAX = 75;

function readStoredSplit(): number {
  if (typeof window === 'undefined') return SPLIT_DEFAULT;
  const stored = window.localStorage.getItem(SPLIT_STORAGE_KEY);
  if (stored !== null) {
    const n = Number(stored);
    if (Number.isFinite(n)) {
      return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n));
    }
  }
  return SPLIT_DEFAULT;
}

function fallbackTurns(session: QuickSession): QuickSessionTurn[] {
  if (!session.original_input?.trim()) return [];
  return [
    {
      id: `${session.id}-original-input`,
      session_id: session.id,
      role: 'user',
      content: session.original_input,
      created_at: session.created_at,
    },
  ];
}

function sourceCaseIdFromStaticSession(sessionId: string): string | null {
  const prefix = 'quick-sample-';
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : null;
}

function buildStaticQuickInitial(sessionId: string): {
  session: QuickSession;
  messages: QuickSessionTurn[];
  coverage: CoverageSlot[];
  understanding: QuickSessionUnderstanding;
  unknowns: QuickSessionUnknown[];
} | null {
  const sourceCaseId = sourceCaseIdFromStaticSession(sessionId);
  const demoCase = getQuickDemoCase(sourceCaseId);
  if (!sourceCaseId || !demoCase || quickStaticSessionId(sourceCaseId) !== sessionId) return null;

  const fixture = buildQuickDemoFixture(sourceCaseId);
  const now = '2026-07-07T00:00:00.000Z';
  const firstAssistant = fixture.messages.find((turn) => turn.role === 'assistant');
  const coverage = fixture.coverage.map((slot) => ({
    name: slot.name as CoverageSlotName,
    label: slot.label,
    state: slot.state as CoverageSlotState,
    is_blocking: slot.is_blocking,
  }));
  const session: QuickSession = {
    id: sessionId,
    version: 1,
    status: 'clarifying',
    source_kind: 'sample',
    source_case_id: sourceCaseId,
    original_input: fixture.original_input,
    current_understanding_version: 0,
    brief_version: 0,
    created_at: now,
    updated_at: now,
  };

  return {
    session,
    messages: firstAssistant
      ? [
          {
            id: firstAssistant.id,
            session_id: sessionId,
            role: firstAssistant.role,
            content: firstAssistant.content,
            structured_content: firstAssistant.structured_content,
            source_refs: firstAssistant.source_refs,
            update_marks: firstAssistant.update_marks,
            follow_ups: firstAssistant.follow_ups,
            created_at: firstAssistant.created_at ?? now,
          },
        ]
      : [],
    coverage,
    understanding: {
      session_id: sessionId,
      version: 0,
      summary: `已载入${fixture.title}，助手会按当前流程逐步追问。`,
      slots: {
        expected_outcome: fixture.understanding.slots.expected_outcome,
      },
      coverage_slots: coverage,
    },
    unknowns: [],
  };
}

export interface QuickConsultPageProps {
  sessionId: string;
}

export function QuickConsultPage({ sessionId }: QuickConsultPageProps) {
  return (
    <ToastProvider>
      <QuickConsultPageInner sessionId={sessionId} />
    </ToastProvider>
  );
}

function QuickConsultPageInner({ sessionId }: QuickConsultPageProps) {
  const staticInitial = buildStaticQuickInitial(sessionId);
  const [session, setSession] = useState<QuickSession | null>(staticInitial?.session ?? null);
  const [messages, setMessages] = useState<QuickSessionTurn[]>(staticInitial?.messages ?? []);
  const [coverage, setCoverage] = useState<CoverageSlot[] | null>(staticInitial?.coverage ?? null);
  const [understanding, setUnderstanding] = useState<QuickSessionUnderstanding | null>(staticInitial?.understanding ?? null);
  const [unknowns, setUnknowns] = useState<QuickSessionUnknown[] | null>(staticInitial?.unknowns ?? null);
  const [cardBindings, setCardBindings] = useState<QuickCardBinding[]>([]);
  const [advancedView, setAdvancedView] = useState(false);
  const [leftPct, setLeftPct] = useState<number>(readStoredSplit);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'dialogue' | 'visual'>('dialogue');

  const loadAll = useCallback(async () => {
    const api = getApiClient();
    const s = await api.getQuickSession(sessionId);
    setSession(s);
    if (s.active_job_id) setActiveJobId(s.active_job_id);

    const [msgs, cov, und, unk] = await Promise.all([
      api
        .listQuickSessionMessages(sessionId, { limit: 100, offset: 0 })
        .catch(() => ({ items: fallbackTurns(s) })),
      api.getQuickSessionCoverage(sessionId).catch(() => null),
      api.getQuickSessionUnderstanding(sessionId).catch(() => null),
      api.listQuickSessionUnknowns(sessionId).catch(() => null),
    ]);

    setMessages(msgs.items.length > 0 ? msgs.items : fallbackTurns(s));
    setCoverage(cov);
    setUnderstanding(und);
    setUnknowns(unk);
  }, [sessionId]);

  useEffect(() => {
    void loadAll().catch(() => {
      // 忽略，状态保持空值
    });
  }, [loadAll]);

  const handleAddCardBinding = useCallback((card: QuickCardBinding) => {
    setCardBindings((prev) => [...prev.filter((c) => c.id !== card.id), card]);
    setMobilePanel('dialogue');
  }, []);

  const handleRemoveCardBinding = useCallback((id: string) => {
    setCardBindings((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleClearCardBindings = useCallback(() => {
    setCardBindings([]);
  }, []);

  const sessionTitle = session?.original_input ?? '快速问诊';
  const selectedCardIds = cardBindings.map((c) => c.id);
  const briefSupplementRequired =
    session?.status === 'brief_ready' && (unknowns ?? []).some((item) => item.is_blocking);
  const cardReferenceEnabled = session?.status === 'understanding_review' || briefSupplementRequired;
  const requiredCardId =
    session?.source_kind === 'sample' && session.status === 'understanding_review'
      ? quickDemoReview(session.source_case_id)?.cardId
      : session?.source_kind === 'sample' && briefSupplementRequired
        ? quickDemoSupplement(session.source_case_id)?.cardId
        : undefined;
  const requiredCardTitle = requiredCardId
    ? quickDemoCardTitle(session?.source_case_id, requiredCardId)
    : undefined;
  const cardReferenceLockedDescription =
    session?.status === 'clarifying'
      ? '请先回答当前问题；需要修改或补充时，再把整理区卡片加入对话。'
      : '请先完成当前操作；需要修改或补充时，再把整理区卡片加入对话。';

  useEffect(() => {
    if (!cardReferenceEnabled) {
      setCardBindings([]);
    }
  }, [cardReferenceEnabled]);

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const intervalMs = session?.source_kind === 'sample' ? 100 : 800;
    const firstDelayMs = session?.source_kind === 'sample' ? 50 : 200;
    const poll = async () => {
      try {
        const job = await getApiClient().getJobStatus(activeJobId);
        if (cancelled) return;
        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
          setActiveJobId(null);
          await loadAll();
          return;
        }
      } catch {
        if (cancelled) return;
      }
      timer = setTimeout(poll, intervalMs);
    };
    timer = setTimeout(poll, firstDelayMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId, loadAll, session?.source_kind]);

  return (
    <div className="quick-consult-shell page-motion-shell">
      <AppBackground />
      <QuickTopbar
        sessionTitle={sessionTitle}
        advancedView={advancedView}
        onToggleAdvancedView={setAdvancedView}
        sessionId={sessionId}
      />
      <div className="quick-mobile-tabs" aria-label="问诊内容切换">
        <button
          type="button"
          className={mobilePanel === 'dialogue' ? 'quick-mobile-tab quick-mobile-tab--active' : 'quick-mobile-tab'}
          onClick={() => setMobilePanel('dialogue')}
        >
          对话
        </button>
        <button
          type="button"
          className={mobilePanel === 'visual' ? 'quick-mobile-tab quick-mobile-tab--active' : 'quick-mobile-tab'}
          onClick={() => setMobilePanel('visual')}
        >
          整理
        </button>
      </div>
      <div className="quick-consult-main page-motion-stage">
        <div
          className={`quick-consult-pane quick-consult-pane--dialogue page-motion-panel--left ${
            mobilePanel !== 'dialogue' ? 'quick-consult-pane--mobile-hidden' : ''
          }`}
          style={{ width: `${leftPct}%` }}
        >
          <QuickDialogue
            sessionId={sessionId}
            session={session}
            messages={messages}
            cardBindings={cardBindings}
            onRemoveCardBinding={handleRemoveCardBinding}
            onClearCardBindings={handleClearCardBindings}
            onRefresh={loadAll}
            onJobAccepted={setActiveJobId}
            briefSupplementRequired={briefSupplementRequired}
            isJobRunning={activeJobId !== null}
          />
        </div>
        <Splitter
          className="app-splitter"
          storageKey={SPLIT_STORAGE_KEY}
          defaultPct={SPLIT_DEFAULT}
          min={SPLIT_MIN}
          max={SPLIT_MAX}
          onChange={setLeftPct}
        />
        <div
          className={`quick-consult-pane quick-consult-pane--visual page-motion-panel--right ${
            mobilePanel !== 'visual' ? 'quick-consult-pane--mobile-hidden' : ''
          }`}
          style={{ width: `${100 - leftPct}%` }}
        >
          <QuickVisualization
            sessionId={sessionId}
            sourceCaseId={session?.source_case_id}
            selectedCardIds={selectedCardIds}
            advancedView={advancedView}
            referenceEnabled={cardReferenceEnabled}
            referenceLockedTitle="请先按当前问题推进"
            referenceLockedDescription={cardReferenceLockedDescription}
            requiredCardId={requiredCardId}
            requiredCardTitle={requiredCardTitle}
            onAddCard={handleAddCardBinding}
            understanding={understanding}
            coverage={coverage}
            unknowns={unknowns}
          />
        </div>
      </div>
    </div>
  );
}
