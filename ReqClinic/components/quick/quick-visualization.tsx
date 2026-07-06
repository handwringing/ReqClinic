'use client';

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Crop,
  GitCompare,
  HelpCircle,
  MinusCircle,
  Route,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getApiClient } from '@/lib/api';
import { getQuickDemoCase } from '@/lib/quick-demo-cases';
import type { QuickDemoTemplateKind } from '@/lib/quick-demo-cases';
import type {
  CoverageSlot,
  CoverageSlotName,
  CoverageSlotState,
  QuickSessionUnderstanding,
  QuickSessionUnknown,
} from '@/lib/api/types';
import { useToast } from '@/components/ui';

// 卡片绑定：左栏输入框模块与右栏选中态共享。
export interface QuickCardRef {
  id: string;
  title: string;
}

export interface QuickCardBinding extends QuickCardRef {
  mode: 'direct';
}

export interface QuickVisualizationProps {
  sessionId: string;
  sourceCaseId?: string | null;
  selectedCardIds: string[];
  advancedView: boolean;
  referenceEnabled?: boolean;
  referenceLockedTitle?: string;
  referenceLockedDescription?: string;
  requiredCardId?: string | null;
  requiredCardTitle?: string | null;
  onAddCard: (card: QuickCardBinding) => void;
  // 由父组件加载后注入，避免重复请求；缺省时本组件自行加载。
  understanding?: QuickSessionUnderstanding | null;
  coverage?: CoverageSlot[] | null;
  unknowns?: QuickSessionUnknown[] | null;
}

interface CoreCardDef {
  id: string;
  title: string;
  detail?: string;
  icon: LucideIcon;
  slot?: CoverageSlotName;
  source: string;
}

interface FloatingMenuState {
  card: QuickCardRef;
  top: number;
  left: number;
  width: number;
  placement: 'top' | 'bottom';
}

const CORE_CARDS: CoreCardDef[] = [
  { id: 'expected_outcome', title: '期望结果', icon: Target, slot: 'expected_outcome', source: '当前对话整理' },
  { id: 'target_user', title: '目标用户', icon: Users, slot: 'target_user', source: '当前对话整理' },
  { id: 'core_scenario', title: '核心场景', icon: Route, slot: 'core_scenario', source: '当前对话整理' },
  { id: 'scope_boundary', title: '范围说明', icon: Crop, slot: 'scope_boundary', source: '当前对话整理' },
  { id: 'completion_criteria', title: '完成标准', icon: Trophy, slot: 'completion_criteria', source: '当前对话整理' },
  { id: 'constraints_risks', title: '风险与约束', icon: AlertTriangle, slot: 'constraints_risks', source: '当前对话整理' },
  { id: 'unknowns', title: '待确认信息', icon: HelpCircle, source: '当前对话整理' },
];

const THEMED_SLOT_MAP: Record<QuickDemoTemplateKind, CoverageSlotName[]> = {
  software: ['target_user', 'core_scenario', 'scope_boundary', 'completion_criteria'],
  creative: ['expected_outcome', 'core_scenario', 'scope_boundary', 'completion_criteria'],
  academic: ['completion_criteria', 'scope_boundary', 'constraints_risks', 'core_scenario'],
  service: ['core_scenario', 'target_user', 'constraints_risks', 'completion_criteria'],
  outsourcing: ['scope_boundary', 'completion_criteria', 'target_user', 'constraints_risks'],
  collaboration: ['target_user', 'expected_outcome', 'constraints_risks', 'scope_boundary'],
  early_idea: ['expected_outcome', 'target_user', 'core_scenario', 'constraints_risks'],
};

const SLOT_ICONS: Record<CoverageSlotName, LucideIcon> = {
  expected_outcome: Target,
  target_user: Users,
  core_scenario: Route,
  scope_boundary: Crop,
  completion_criteria: Trophy,
  constraints_risks: AlertTriangle,
};

const PROGRESSIVE_SLOT_ORDER: Array<{ name: CoverageSlotName; label: string }> = [
  { name: 'expected_outcome', label: '期望结果' },
  { name: 'target_user', label: '目标用户' },
  { name: 'core_scenario', label: '核心场景' },
  { name: 'scope_boundary', label: '范围说明' },
  { name: 'completion_criteria', label: '完成标准' },
  { name: 'constraints_risks', label: '风险与约束' },
];

function slotStatusBadge(state: CoverageSlotState, isBlocking: boolean) {
  if (isBlocking && state !== 'covered') return 'blocking' as const;
  if (state === 'covered') return 'confirmed' as const;
  return 'pending' as const;
}

function slotStatusText(state: CoverageSlotState): string {
  switch (state) {
    case 'covered':
      return '已确认';
    case 'partial':
      return '已整理';
    default:
      return '待补充';
  }
}

export function QuickVisualization({
  sessionId,
  sourceCaseId,
  selectedCardIds,
  advancedView,
  referenceEnabled = false,
  referenceLockedTitle = '请先按当前问题推进',
  referenceLockedDescription = '请先回答当前问题；需要修改或补充时，再把卡片加入对话。',
  requiredCardId,
  requiredCardTitle,
  onAddCard,
  understanding: understandingProp,
  coverage: coverageProp,
  unknowns: unknownsProp,
}: QuickVisualizationProps) {
  const [understanding, setUnderstanding] = useState<QuickSessionUnderstanding | null>(understandingProp ?? null);
  const [coverage, setCoverage] = useState<CoverageSlot[] | null>(coverageProp ?? null);
  const [unknowns, setUnknowns] = useState<QuickSessionUnknown[] | null>(unknownsProp ?? null);
  const [floatingMenu, setFloatingMenu] = useState<FloatingMenuState | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const api = getApiClient();
    let cancelled = false;
    async function load() {
      const [u, c, unk] = await Promise.all([
        api.getQuickSessionUnderstanding(sessionId),
        api.getQuickSessionCoverage(sessionId),
        api.listQuickSessionUnknowns(sessionId),
      ]);
      if (cancelled) return;
      setUnderstanding(u);
      setCoverage(c);
      setUnknowns(unk);
    }
    // 仅在父组件未注入数据时自行加载。
    if (understandingProp === undefined && coverageProp === undefined && unknownsProp === undefined) {
      void load();
    }
    return () => {
      cancelled = true;
    };
  }, [sessionId, understandingProp, coverageProp, unknownsProp]);

  // 父组件注入更新时同步（刷新后）。
  useEffect(() => {
    if (understandingProp !== undefined) setUnderstanding(understandingProp);
  }, [understandingProp]);
  useEffect(() => {
    if (coverageProp !== undefined) setCoverage(coverageProp);
  }, [coverageProp]);
  useEffect(() => {
    if (unknownsProp !== undefined) setUnknowns(unknownsProp);
  }, [unknownsProp]);

  useEffect(() => {
    if (!floatingMenu) return;
    const close = () => {
      setFloatingMenu(null);
    };
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('resize', close);
    };
  }, [floatingMenu]);

  const slots = understanding?.slots ?? {};
  const hasBlockingUnknown = (unknowns ?? []).some((u) => u.is_blocking);
  const demoCase = getQuickDemoCase(sourceCaseId);
  const template = demoCase?.template;
  const thematicCards: CoreCardDef[] = template
    ? template.rightPanelCards.map((card, index) => {
      const slot = THEMED_SLOT_MAP[template.kind][index] ?? 'expected_outcome';
      return {
        id: slot,
        title: card.title,
        detail: card.detail,
        icon: SLOT_ICONS[slot] ?? Target,
        slot,
        source: '当前对话整理',
      };
    })
    : CORE_CARDS.filter((def) => def.id !== 'unknowns');
  const coverageByName = new Map((coverage ?? []).map((slot) => [slot.name, slot]));
  const hasSlotValue = (name: CoverageSlotName) => Boolean(slots[name]?.trim());
  const coveredCount = (coverage ?? []).filter((slot) => slot.state === 'covered').length;
  const extractedCount = (coverage ?? []).filter((slot) => slot.state !== 'not_started').length;
  const pendingCount =
    (coverage ?? []).filter((slot) => slot.state === 'not_started' && !hasSlotValue(slot.name)).length +
    (unknowns ?? []).length;
  const constraintCount =
    (hasSlotValue('constraints_risks') ? 1 : 0) +
    (unknowns ?? []).filter((item) => item.is_blocking).length;
  const hasDiscussedSlot = (name: CoverageSlotName) => {
    const state = coverageByName.get(name)?.state;
    return hasSlotValue(name) || (state !== undefined && state !== 'not_started');
  };
  const knownSegments = PROGRESSIVE_SLOT_ORDER
    .map((item) => ({ ...item, value: slots[item.name] }))
    .filter((item) => Boolean(item.value?.trim()));
  const knownSlotCount = knownSegments.length;
  const discussedSlotCount = PROGRESSIVE_SLOT_ORDER.filter((item) => hasDiscussedSlot(item.name)).length;
  const showAllAvailableCards = advancedView || referenceEnabled;
  const showTemplateCard = showAllAvailableCards || knownSlotCount >= 3;
  const showProgressCard = showAllAvailableCards || knownSlotCount >= 2;
  const showCoverageGrid = showAllAvailableCards || knownSlotCount >= 3;
  const visibleCoverage = showAllAvailableCards
    ? coverage ?? []
    : (coverage ?? []).filter((slot) => hasDiscussedSlot(slot.name));
  const baseCoreCards = [
    ...thematicCards.filter((def) => {
      if (showAllAvailableCards) return true;
      if (def.slot) return hasDiscussedSlot(def.slot);
      return false;
    }),
    ...CORE_CARDS.filter((def) => def.id === 'unknowns'),
  ];
  const requiredFallbackCard =
    requiredCardId && !baseCoreCards.some((def) => def.id === requiredCardId)
      ? CORE_CARDS.find((def) => def.id === requiredCardId)
      : undefined;
  const visibleCoreCards = [
    ...baseCoreCards,
    ...(requiredFallbackCard ? [requiredFallbackCard] : []),
  ].filter((def) => {
    if (def.id === 'unknowns') {
      return (unknowns ?? []).length > 0 || requiredCardId === 'unknowns';
    }
    if (showAllAvailableCards) return true;
    return true;
  });
  const resolvedRequiredCardTitle =
    requiredCardTitle ??
    visibleCoreCards.find((card) => card.id === requiredCardId)?.title ??
    '指定卡片';

  // 当前理解摘要：为[目标用户]，在[核心场景]下，解决[问题]，达到[期望结果]
  const summarySegments: { key: string; label: string; value?: string }[] = [
    { key: 'target_user', label: '目标用户', value: slots.target_user },
    { key: 'core_scenario', label: '核心场景', value: slots.core_scenario },
    { key: 'problem', label: '问题', value: slots.constraints_risks },
    { key: 'expected_outcome', label: '期望结果', value: slots.expected_outcome },
  ];

  const closeFloatingMenu = () => {
    setFloatingMenu(null);
  };

  const notifyReferenceLocked = () => {
    showToast({
      type: 'info',
      title: referenceLockedTitle,
      description: referenceLockedDescription,
      duration: 4200,
    });
    closeFloatingMenu();
  };

  const openFloatingMenu = (card: QuickCardRef, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 220), 320);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const estimatedHeight = 176;
    const hasRoomBelow = rect.bottom + 8 + estimatedHeight < window.innerHeight;
    const placement = hasRoomBelow || rect.top < estimatedHeight ? 'bottom' : 'top';
    const top = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;
    setFloatingMenu({ card, top, left, width, placement });
  };

  const handleDirectAdd = (card: QuickCardRef) => {
    if (!referenceEnabled) {
      notifyReferenceLocked();
      return;
    }
    const matchesRequiredCard =
      !requiredCardId ||
      card.id === requiredCardId ||
      card.title === resolvedRequiredCardTitle;
    if (!matchesRequiredCard) {
      showToast({
        type: 'info',
        title: '请先选择这张卡片',
        description: `这次需要点击「${resolvedRequiredCardTitle}」，再按当前提示填入内容。`,
        duration: 4200,
      });
      closeFloatingMenu();
      return;
    }
    const normalizedCard =
      requiredCardId
        ? { id: requiredCardId, title: resolvedRequiredCardTitle }
        : card;
    onAddCard({ ...normalizedCard, mode: 'direct' });
    showToast({
      type: 'success',
      title: '已加入对话框',
      description: `正在修改「${normalizedCard.title}」。`,
      duration: 2400,
    });
    closeFloatingMenu();
  };

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      role="region"
      aria-label="需求整理区"
    >
      <div className="quick-visual-stack flex flex-col gap-4 p-4">
        {/* 当前理解摘要 */}
        <section
          className="app-card p-4"
          aria-label="当前理解"
        >
          <div className="app-label">当前理解</div>
          {advancedView ? (
            <p
              className="mt-1.5 font-display text-[15px] leading-relaxed"
              style={{ color: 'var(--aurora-ink)' }}
            >
              为
              {summarySegments.map((seg, i) => (
                <span key={seg.key}>
                  <Segment value={seg.value} label={seg.label} />
                  {i === 0 && '，在'}
                  {i === 1 && '下，解决'}
                  {i === 2 && '，达到'}
                  {i === 3 && ''}
                </span>
              ))}
              。
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {knownSegments.length > 0 ? (
                knownSegments.map((seg) => (
                  <div
                    key={seg.name}
                    className="rounded-md px-2.5 py-2"
                    style={{
                      background: 'rgba(255,255,255,0.36)',
                      border: '1px solid var(--aurora-card-border)',
                    }}
                  >
                    <div className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
                      {seg.label}
                    </div>
                    <div
                      className="mt-0.5 text-[13px] leading-relaxed"
                      style={{ color: 'var(--aurora-ink)' }}
                    >
                      {seg.value}
                    </div>
                  </div>
                ))
              ) : (
                <p
                  className="text-[13px] leading-relaxed"
                  style={{ color: 'var(--aurora-muted)' }}
                >
                  助手会先从你的第一句话里提取确定信息。
                </p>
              )}
            </div>
          )}
        </section>

        {/* 当前重点与梳理进展 */}
        {template && showTemplateCard && (
          <section className="app-card quick-visual-template p-4" aria-label="当前重点">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="app-label">整理重点</div>
                <h2
                  className="mt-1 font-display text-[15px] font-semibold"
                  style={{ color: 'var(--aurora-ink)' }}
                >
                  {template.label}
                </h2>
              </div>
              <span className="app-chip app-chip-muted">
                {demoCase?.title ?? '当前内容'}
              </span>
            </div>
            <p
              className="mt-2 text-[12px] leading-relaxed"
              style={{ color: 'var(--aurora-ink-soft)' }}
            >
              {template.summary}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {template.priorityDimensions.map((item) => (
                <span key={item} className="app-chip" style={{ padding: '3px 8px', fontSize: 10 }}>
                  {item}
                </span>
              ))}
            </div>
          </section>
        )}

        {showProgressCard && (
          <section className="app-card quick-visual-progress p-3.5" aria-label="梳理进展">
            <div className="app-label mb-2">整理概况</div>
            <div className="grid grid-cols-5 gap-1.5">
              <StateTile label="已明确" value={coveredCount} tone="sage" />
              <StateTile label="已整理" value={extractedCount} tone="gold" />
              <StateTile label="待补充" value={pendingCount} tone="muted" />
              <StateTile label="约束" value={constraintCount} tone={constraintCount > 0 ? 'rose' : 'muted'} />
              <StateTile label="取舍" value={sessionId ? 1 : 0} tone="muted" />
            </div>
          </section>
        )}

        {/* 信息完整度网格 */}
        {showCoverageGrid && visibleCoverage.length > 0 && (
        <section className="quick-visual-coverage" aria-label="信息完整度">
          <div className="grid grid-cols-3 gap-2">
            {visibleCoverage.map((slot) => {
              const Icon = SLOT_ICONS[slot.name] ?? CircleDashed;
              const stateText = slotStatusText(slot.state);
              return (
                <div
                  key={slot.name}
                  className="relative flex flex-col gap-1 rounded-md p-2"
                  style={{
                    border:
                      slot.state === 'not_started'
                        ? '1px dashed var(--aurora-hair-strong)'
                        : '1px solid var(--aurora-card-border)',
                    background:
                      slot.state === 'covered'
                        ? 'rgba(107,138,126,0.10)'
                        : slot.state === 'partial'
                          ? 'rgba(168,133,47,0.10)'
                          : 'transparent',
                    color:
                      slot.state === 'covered'
                        ? 'var(--aurora-sage)'
                        : slot.state === 'partial'
                          ? 'var(--aurora-gold)'
                          : 'var(--aurora-muted)',
                  }}
                >
                  {slot.is_blocking && slot.state !== 'covered' && (
                    <span
                      className="absolute right-1 top-1 rounded-sm px-1 text-[10px] font-semibold leading-4"
                      style={{
                        background: 'rgba(160,108,108,0.16)',
                        color: 'var(--aurora-rose)',
                      }}
                      title="这项信息会影响后续方案"
                    >
                      建议确认
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span className="text-[12px] font-semibold">
                      {slot.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        background:
                          slot.state === 'covered'
                            ? 'var(--aurora-sage)'
                            : slot.state === 'partial'
                              ? 'var(--aurora-gold)'
                              : 'var(--aurora-hair-strong)',
                      }}
                    />
                    <span className="text-[11px]">{stateText}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        )}

        {/* 核心卡片 */}
        {visibleCoreCards.length > 0 && (
        <section className="quick-visual-core" aria-label="核心卡片">
          <div className="grid grid-cols-2 gap-2">
            {visibleCoreCards.map((def) => {
              const Icon = def.icon;
              const isSelected = selectedCardIds.includes(def.id);
              const isRequired = requiredCardId === def.id;
              const slotValue = def.slot ? slots[def.slot] : undefined;
              const slotState = coverage?.find((c) => c.name === def.slot)?.state;
              const isBlockingSlot = coverage?.find((c) => c.name === def.slot)?.is_blocking;
              const isUnknowns = def.id === 'unknowns';

              let badgeVariant: 'confirmed' | 'pending' | 'blocking';
              if (isUnknowns) {
                badgeVariant = hasBlockingUnknown ? 'blocking' : 'pending';
              } else if (slotState) {
                badgeVariant = slotStatusBadge(slotState, !!isBlockingSlot);
              } else {
                badgeVariant = 'pending';
              }

              const items: { icon: LucideIcon; text: string }[] = [];
              if (isUnknowns) {
                const list = unknowns ?? [];
                if (list.length === 0) {
                  items.push({ icon: CheckCircle2, text: '暂无待确认信息' });
                } else {
                  list.slice(0, 3).forEach((u) => {
                    items.push({
                      icon: u.is_blocking ? AlertTriangle : HelpCircle,
                      text: u.question,
                    });
                  });
                }
              } else if (slotValue) {
                items.push({ icon: CheckCircle2, text: slotValue });
              } else if (slotState && slotState !== 'not_started') {
                items.push({ icon: HelpCircle, text: '已提到，口径还需补充' });
              } else {
                items.push({ icon: MinusCircle, text: '待补充' });
              }

              return (
                <div
                  key={def.id}
                  className={`app-card quick-visual-card relative flex flex-col p-3.5 text-left ${
                    isSelected ? 'quick-visual-card--selected' : ''
                  } ${isRequired ? 'quick-visual-card--required' : ''}`}
                  style={{
                    boxShadow: isSelected
                      ? 'inset 3px 0 0 var(--aurora-gold), var(--aurora-shadow-soft)'
                      : isRequired
                        ? '0 0 0 2px rgba(168,133,47,0.28), var(--aurora-shadow-soft)'
                      : 'var(--aurora-shadow-soft)',
                    background: isSelected
                      ? 'rgba(168,133,47,0.08)'
                      : isRequired
                        ? 'rgba(168,133,47,0.06)'
                      : 'var(--aurora-card-bg)',
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (floatingMenu?.card.id === def.id) {
                        closeFloatingMenu();
                        return;
                      }
                      openFloatingMenu(
                        { id: def.id, title: def.title },
                        event.currentTarget,
                      );
                    }}
                    className="quick-visual-card__button flex w-full flex-col text-left"
                    title={`${def.title}：打开卡片操作`}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Icon
                          className="h-4 w-4"
                          strokeWidth={1.5}
                          style={{ color: 'var(--aurora-gold)' }}
                        />
                        <span
                          className="text-[14px] font-semibold"
                          style={{ color: 'var(--aurora-ink)' }}
                        >
                          {def.title}
                        </span>
                      </div>
                      <span
                        className={
                          badgeVariant === 'confirmed'
                            ? 'app-chip app-chip-sage'
                            : badgeVariant === 'blocking'
                              ? 'app-chip app-chip-rose'
                              : 'app-chip app-chip-muted'
                        }
                      >
                        {badgeVariant === 'confirmed'
                          ? '已确认'
                          : badgeVariant === 'blocking'
                            ? '建议确认'
                            : slotState === 'partial' && slotValue
                              ? '已整理'
                              : '待补充'}
                      </span>
                    </div>
                    <ul className="mt-2 flex flex-col gap-1">
                      {def.detail && (
                        <li
                          className="text-[11px] leading-relaxed"
                          style={{ color: 'var(--aurora-muted)' }}
                        >
                          {def.detail}
                        </li>
                      )}
                      {items.map((item, idx) => {
                        const ItemIcon = item.icon;
                        const itemColor =
                          ItemIcon === AlertTriangle
                            ? 'var(--aurora-rose)'
                            : ItemIcon === CheckCircle2
                              ? 'var(--aurora-sage)'
                              : 'var(--aurora-muted)';
                        return (
                          <li
                            key={idx}
                            className="flex items-start gap-1.5 text-[12px] leading-relaxed"
                            style={{ color: 'var(--aurora-ink-soft)' }}
                          >
                            <ItemIcon
                              className="mt-0.5 h-3 w-3 shrink-0"
                              strokeWidth={1.5}
                              style={{ color: itemColor }}
                            />
                            <span className="break-words">{item.text}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <div
                      className="mt-2 text-[11px]"
                      style={{ color: 'var(--aurora-muted)' }}
                    >
                      来源：{def.source}
                    </div>
                    {isRequired && (
                      <div className="quick-required-card-hint">
                        这次请用这张卡片
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        )}

        {/* 更多内容 */}
        {advancedView && (
          <section aria-label="更多内容" className="flex flex-col gap-2">
            {template && (
              <div className="app-card flex flex-col gap-2 p-3.5">
                <div className="app-label">本类项目会关注</div>
                <div className="flex flex-col gap-2">
                  {template.rightPanelCards.map((card) => (
                    <div
                      key={card.title}
                      className="rounded-md p-2"
                      style={{
                        border: '1px solid var(--aurora-card-border)',
                        background: 'rgba(255,255,255,0.34)',
                      }}
                    >
                      <div
                        className="text-[12px] font-semibold"
                        style={{ color: 'var(--aurora-ink)' }}
                      >
                        {card.title}
                      </div>
                      <div
                        className="mt-0.5 text-[11px] leading-relaxed"
                        style={{ color: 'var(--aurora-muted)' }}
                      >
                        {card.detail}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <AdvancedCard
              title="范围说明"
              icon={Crop}
              value={slots.scope_boundary}
              source="当前对话整理"
            />
            <AdvancedCard
              title="完成标准"
              icon={Trophy}
              value={slots.completion_criteria}
              source="当前对话整理"
            />
            <div
              className="app-card flex flex-col p-3.5"
              style={{ borderStyle: 'dashed' }}
            >
              <div className="flex items-center gap-1.5">
                <GitCompare
                  className="h-4 w-4"
                  strokeWidth={1.5}
                  style={{ color: 'var(--aurora-gold)' }}
                />
                <span
                  className="text-[14px] font-semibold"
                  style={{ color: 'var(--aurora-ink)' }}
                >
                  方案比较
                </span>
              </div>
              <p
                className="mt-2 text-[12px]"
                style={{ color: 'var(--aurora-muted)' }}
              >
                理解确认后，将在此生成可选方案及其代价与可逆性比较。
              </p>
            </div>
          </section>
        )}
      </div>
      {floatingMenu &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="关闭卡片操作"
              className="fixed inset-0 cursor-default"
              style={{ zIndex: 80, background: 'transparent' }}
              onClick={closeFloatingMenu}
            />
            <div
              role="menu"
              className="quick-card-menu fixed rounded-md p-2"
              style={{
                zIndex: 81,
                top: floatingMenu.top,
                left: floatingMenu.left,
                width: floatingMenu.width,
                transform:
                  floatingMenu.placement === 'top'
                    ? 'translateY(-100%)'
                    : undefined,
                background: 'var(--aurora-card-bg)',
                border: '1px solid var(--aurora-card-border)',
                boxShadow: '0 18px 45px rgba(35,31,22,0.16)',
                backdropFilter: 'blur(20px) saturate(140%)',
                WebkitBackdropFilter: 'blur(20px) saturate(140%)',
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className="quick-card-menu__action rounded px-2 py-1.5 text-left text-[12px]"
                  style={{ color: 'var(--aurora-ink)' }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleDirectAdd(floatingMenu.card);
                  }}
                >
                  加入到对话框
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

function StateTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'sage' | 'gold' | 'rose' | 'muted';
}) {
  const color =
    tone === 'sage'
      ? 'var(--aurora-sage)'
      : tone === 'rose'
        ? 'var(--aurora-rose)'
        : tone === 'gold'
          ? 'var(--aurora-gold)'
          : 'var(--aurora-muted)';
  return (
    <div
      className="rounded-md px-1.5 py-2 text-center"
      style={{
        border: '1px solid var(--aurora-card-border)',
        background: tone === 'muted' ? 'transparent' : 'rgba(255,255,255,0.34)',
      }}
    >
      <div
        className="font-display text-[15px] font-semibold leading-none"
        style={{ color }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[10px] leading-none"
        style={{ color: 'var(--aurora-muted)' }}
      >
        {label}
      </div>
    </div>
  );
}

function Segment({ value, label }: { value?: string; label: string }) {
  if (!value) {
    return (
      <em className="px-0.5 italic" style={{ color: 'var(--aurora-muted)' }}>
        待补充
      </em>
    );
  }
  return (
    <strong
      className="px-0.5 font-semibold"
      style={{ color: 'var(--aurora-gold)' }}
      title={label}
    >
      {value}
    </strong>
  );
}

function AdvancedCard({
  title,
  icon: Icon,
  value,
  source,
}: {
  title: string;
  icon: LucideIcon;
  value?: string;
  source: string;
}) {
  return (
    <div className="app-card flex flex-col p-3.5">
      <div className="flex items-center gap-1.5">
        <Icon
          className="h-4 w-4"
          strokeWidth={1.5}
          style={{ color: 'var(--aurora-gold)' }}
        />
        <span
          className="text-[14px] font-semibold"
          style={{ color: 'var(--aurora-ink)' }}
        >
          {title}
        </span>
      </div>
      <p
        className="mt-2 text-[12px] leading-relaxed"
        style={{ color: 'var(--aurora-ink-soft)' }}
      >
        {value ? (
          value
        ) : (
          <em className="italic" style={{ color: 'var(--aurora-muted)' }}>
            待补充
          </em>
        )}
      </p>
      <div
        className="mt-2 text-[11px]"
        style={{ color: 'var(--aurora-muted)' }}
      >
        来源：{source}
      </div>
    </div>
  );
}
