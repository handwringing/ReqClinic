'use client';

import {
  GitBranch,
  Quote,
  SendHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { getApiClient } from '@/lib/api';
import type { QuickSession, QuickSessionTurn } from '@/lib/api/types';
import { Avatar, LongWaitProgress } from '@/components/ui';
import { ModelUnavailableDialog } from '@/components/common/model-unavailable-dialog';
import { useModelApiGate } from '@/lib/use-model-api-gate';
import {
  getQuickDemoCase,
  quickDemoCardTitle,
  quickDemoReview,
  quickDemoSupplement,
} from '@/lib/quick-demo-cases';
import {
  getQuickSampleBranchScenario,
  getQuickSampleSuggestedAnswer,
} from '@/lib/quick-sample-branches';
import type { QuickCardBinding } from './quick-visualization';

const MAX_LENGTH = 10000;

type DisplayOption = {
  id: string;
  title: string;
  description: string;
  pros?: string[];
  cons?: string[];
  is_recommended?: boolean;
  isRecommended?: boolean;
};

const MARK_LABELS: Record<string, string> = {
  expected_outcome: '期望结果',
  target_user: '目标用户',
  core_scenario: '核心场景',
  scope_boundary: '范围说明',
  completion_criteria: '完成标准',
  constraints_risks: '风险与约束',
  understanding_review: '当前理解已整理',
  card_reference: '卡片内容已加入',
  option_review: '方案比较已准备',
  brief_ready: '需求简报已生成',
};

export interface QuickDialogueProps {
  sessionId: string;
  session: QuickSession | null;
  messages: QuickSessionTurn[];
  cardBindings: QuickCardBinding[];
  onRemoveCardBinding: (id: string) => void;
  onClearCardBindings: () => void;
  onRefresh: () => void | Promise<void>;
  onJobAccepted?: (jobId: string) => void;
  briefSupplementRequired?: boolean;
  isJobRunning?: boolean;
}

export function QuickDialogue({
  sessionId,
  session,
  messages,
  cardBindings,
  onRemoveCardBinding,
  onClearCardBindings,
  onRefresh,
  onJobAccepted,
  briefSupplementRequired = false,
  isJobRunning = false,
}: QuickDialogueProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stageActionLoading, setStageActionLoading] = useState(false);
  const composingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const demoCase =
    session?.source_kind === 'sample' ? getQuickDemoCase(session.source_case_id) : undefined;
  const isSampleSession = !!demoCase;
  const { modelDialogOpen, requireModelApi, dismissModelDialog } = useModelApiGate({
    skip: isSampleSession,
  });
  const sampleUserMessages = messages.filter((message) => message.role === 'user');
  const sampleAnswers = isSampleSession && sampleUserMessages[0]?.content.trim() === session?.original_input.trim()
    ? sampleUserMessages.slice(1).map((message) => message.content)
    : sampleUserMessages.map((message) => message.content);
  const answeredCount = sampleAnswers.length;
  const sampleBranchScenario = getQuickSampleBranchScenario(session?.source_case_id);
  const sampleBranchChoices =
    isSampleSession && session?.status === 'clarifying' && answeredCount === 0
      ? sampleBranchScenario?.choices ?? []
      : [];
  const guidedAnswer =
    isSampleSession && session?.status === 'clarifying'
      ? getQuickSampleSuggestedAnswer(session?.source_case_id, answeredCount, sampleAnswers)
      : undefined;
  const reviewUpdate =
    isSampleSession && session?.status === 'understanding_review'
      ? quickDemoReview(session?.source_case_id)
      : undefined;
  const supplementUpdate =
    isSampleSession && briefSupplementRequired
      ? quickDemoSupplement(session?.source_case_id)
      : undefined;
  const reviewAnswer = reviewUpdate?.answer;
  const supplementAnswer = supplementUpdate?.answer;
  const canModifyUnderstanding = session?.status === 'understanding_review';
  const isBusy = sending || stageActionLoading || isJobRunning;
  const inputDisabledByStage =
    session === null ||
    isBusy ||
    session?.status === 'option_review' ||
    (session?.status === 'brief_ready' && !briefSupplementRequired);

  const canFillAnswer = !!guidedAnswer;
  const reviewTargetCardTitle = reviewUpdate
    ? quickDemoCardTitle(session?.source_case_id, reviewUpdate.cardId)
    : '这张卡片';
  const supplementTargetCardTitle = supplementUpdate
    ? quickDemoCardTitle(session?.source_case_id, supplementUpdate.cardId)
    : '待确认信息';
  const hasCardBinding = (cardId?: string, cardTitle?: string) =>
    Boolean(
      cardId &&
        cardBindings.some(
          (binding) =>
            binding.id === cardId ||
            (!!cardTitle && binding.title === cardTitle),
        ),
    );
  const reviewCardBound = hasCardBinding(reviewUpdate?.cardId, reviewTargetCardTitle);
  const supplementCardBound = hasCardBinding(supplementUpdate?.cardId, supplementTargetCardTitle);
  const canFillReview = !!reviewAnswer && reviewCardBound;
  const canFillSupplement = !!supplementAnswer && supplementCardBound;
  const hasReviewCardInteraction = messages.some(
    (m) =>
      m.role === 'user' &&
      (parseBoundContent(m.content).boundLabels.length > 0 ||
        (!!reviewAnswer && m.content.includes(reviewAnswer))),
  );
  const reviewNeedsCardInteraction =
    isSampleSession && session?.status === 'understanding_review' && !hasReviewCardInteraction;
  const trimmedInput = input.trim();
  const hasComposerContent = trimmedInput.length > 0;
  const sampleClarifyingAnswerAllowed = sampleBranchChoices.length > 0
    ? sampleBranchChoices.some((choice) => choice.answer.trim() === trimmedInput)
    : !!guidedAnswer && guidedAnswer.trim() === trimmedInput;
  const sampleSendAllowed = session?.status === 'clarifying'
    ? sampleClarifyingAnswerAllowed
    : canModifyUnderstanding
      ? reviewCardBound && !!reviewAnswer && reviewAnswer.trim() === trimmedInput
      : supplementAnswer
        ? supplementCardBound && supplementAnswer.trim() === trimmedInput
        : false;
  const canSend =
    hasComposerContent &&
    session !== null &&
    !sending &&
    !stageActionLoading &&
    !isJobRunning &&
    (!isSampleSession || sampleSendAllowed);

  const boundCardTitle = cardBindings[0]?.title;
  const composerPlaceholder = (() => {
    if (isBusy) return '正在整理，请稍候。';
    if (sampleBranchChoices.length > 0) return '先选择一个回答方向。';
    if (isSampleSession && guidedAnswer) return '点击上方按钮填入本步回答。';
    if (briefSupplementRequired) {
      if (supplementCardBound) return '点击“填入补充”，或直接补充这张卡片的说明。';
      return `先点击整理区「${supplementTargetCardTitle}」。`;
    }
    if (canModifyUnderstanding) {
      if (boundCardTitle && !isSampleSession) return `正在修改：${boundCardTitle}，请输入修改内容。`;
      if (reviewNeedsCardInteraction) {
        return reviewCardBound
          ? '点击“填入修改”。'
          : `先点击整理区「${reviewTargetCardTitle}」。`;
      }
      return '如需调整，先点整理区内容加入对话框；无误可查看方案。';
    }
    return '回答助手的问题；不确定也可以说不知道...';
  })();
  const busyMessage = (() => {
    if (isSampleSession) return '正在根据这次回答整理下一问。';
    if (session?.status === 'option_review') return '正在生成需求简报，完成后会自动打开新的内容。';
    if (stageActionLoading) return '正在准备下一步，完成后会自动更新。';
    return '正在整理回答，完成后会自动更新对话和整理区内容。';
  })();
  const busyTitle = (() => {
    if (isSampleSession) return '正在更新示例';
    if (session?.status === 'option_review') return '正在生成简报';
    if (stageActionLoading) return '正在准备下一步';
    return '正在整理回答';
  })();

  const refreshNow = useCallback(async () => {
    await Promise.resolve(onRefresh());
  }, [onRefresh]);

  const handleSend = useCallback(async () => {
    const value = input.trim();
    if (!canSend) return;
    if (!(await requireModelApi())) return;
    setSending(true);
    try {
      const accepted = await getApiClient().postQuickSessionMessage({
        session_id: sessionId,
        content: composeVisibleContent(value, cardBindings),
        bound_refs: cardBindings.map((binding) => ({
          card_id: binding.id,
          card_title: binding.title,
          card_version: null,
        })),
      });
      onJobAccepted?.(accepted.job_id);
      setInput('');
      onClearCardBindings();
      await refreshNow();
    } finally {
      setSending(false);
    }
  }, [canSend, cardBindings, input, onClearCardBindings, onJobAccepted, refreshNow, requireModelApi, sessionId]);

  const handleReviewAccept = useCallback(async () => {
    if (stageActionLoading || isJobRunning) return;
    if (!(await requireModelApi())) return;
    setStageActionLoading(true);
    try {
      const accepted = await getApiClient().reviewQuickSessionUnderstanding({
        session_id: sessionId,
        action: 'accept',
      });
      onJobAccepted?.(accepted.job_id);
      await refreshNow();
    } finally {
      setStageActionLoading(false);
    }
  }, [isJobRunning, onJobAccepted, refreshNow, requireModelApi, sessionId, stageActionLoading]);

  const handleGenerateBrief = useCallback(async () => {
    if (stageActionLoading || isJobRunning) return;
    if (!(await requireModelApi())) return;
    setStageActionLoading(true);
    try {
      const accepted = await getApiClient().generateQuickSessionBrief({
        session_id: sessionId,
      });
      onJobAccepted?.(accepted.job_id);
      await refreshNow();
    } finally {
      setStageActionLoading(false);
    }
  }, [isJobRunning, onJobAccepted, refreshNow, requireModelApi, sessionId, stageActionLoading]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (composingRef.current) return;
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const fillAnswer = () => {
    if (!canFillAnswer || !guidedAnswer) return;
    setInput(guidedAnswer);
    textareaRef.current?.focus();
  };

  const selectBranchChoice = (answer: string) => {
    if (inputDisabledByStage) return;
    setInput(answer);
  };

  const fillReview = () => {
    if (!canFillReview || !reviewAnswer) return;
    setInput(reviewAnswer);
    textareaRef.current?.focus();
  };

  const fillSupplement = () => {
    if (!canFillSupplement || !supplementAnswer) return;
    setInput(supplementAnswer);
    textareaRef.current?.focus();
  };

  return (
    <>
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <LongWaitProgress
            title={isSampleSession ? '正在打开问诊' : '正在准备第一问'}
            description={
              isSampleSession
                ? '正在读取案例并准备第一个问题。'
                : '问诊助手正在根据你的第一句话整理追问。'
            }
            steps={['读取描述', '整理重点', '准备提问']}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} turn={m} />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 p-3" style={{ borderTop: '1px solid var(--aurora-hair)' }}>
        {session?.status === 'understanding_review' && (
          <StageActionPanel
            label="理解确认"
            title="当前理解已整理"
            description={
              reviewNeedsCardInteraction
                ? reviewCardBound
                  ? `已选择「${reviewTargetCardTitle}」，请填入修改内容并发送。`
                  : `请点击整理区「${reviewTargetCardTitle}」加入对话框，再填入修改内容并发送。`
                : '确认无误后继续看方案。'
            }
            actionText={
              reviewNeedsCardInteraction
                ? reviewCardBound
                  ? '先填入修改内容'
                  : '先选择要修改的内容'
                : '确认，查看方案'
            }
            disabled={stageActionLoading || isJobRunning || reviewNeedsCardInteraction}
            onAction={handleReviewAccept}
          />
        )}
        {session?.status === 'option_review' && (
          <StageActionPanel
            label="方案与边界"
            title="方案比较已准备好"
            description={session.recommendation ?? '选择推荐方案后生成简报。'}
            actionText="生成简报"
            disabled={stageActionLoading || isJobRunning}
            onAction={handleGenerateBrief}
            options={
              session.quick_options && session.quick_options.length > 0
                ? session.quick_options
                : demoCase?.options ?? []
            }
          />
        )}
        {session?.status === 'brief_ready' && (
          <StageActionPanel
            label={briefSupplementRequired ? '继续补充' : '需求简报'}
            title={briefSupplementRequired ? '简报还缺关键信息' : '简报已生成'}
            description={
              briefSupplementRequired
                ? `可以先查看当前草稿，也可以点击整理区「${supplementTargetCardTitle}」，填入补充内容后生成新版简报。`
                : '打开简报页查看概述和详细报告。'
            }
            actionText={briefSupplementRequired ? '查看当前简报' : '查看简报'}
            disabled={false}
            actionHref={`/quick/${sessionId}/brief`}
          />
        )}

        <div className="app-card" style={{ padding: '12px 14px' }}>
          {isBusy && (
            isSampleSession ? (
              <div className="sample-step-notice mb-2" role="status" aria-live="polite">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                <span>正在切换示例步骤。</span>
              </div>
            ) : (
              <LongWaitProgress
                compact
                className="mb-2"
                title={busyTitle}
                description={busyMessage}
                steps={
                  session?.status === 'option_review'
                    ? ['汇总理解', '比较方案', '撰写简报', '检查来源']
                    : ['读取回答', '更新整理区', '准备下一问', '检查一致性']
                }
              />
            )
          )}
          {sampleBranchChoices.length > 0 && sampleBranchScenario && (
            <section className="quick-sample-directions page-motion-question" aria-label="回答方向">
              <div className="quick-sample-directions__head">
                <span className="app-label">
                  <GitBranch className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  可以从这里开始
                </span>
                <p>{sampleBranchScenario.prompt}</p>
              </div>
              <div className="quick-sample-directions__choices" role="group" aria-label="常用回答方向">
                {sampleBranchChoices.map((choice) => {
                  const selected = input.trim() === choice.answer;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      className={`quick-sample-direction ${selected ? 'is-selected' : ''}`}
                      data-quick-branch-choice={choice.id}
                      aria-pressed={selected}
                      onClick={() => selectBranchChoice(choice.answer)}
                    >
                      <strong>{choice.title}</strong>
                      <span>{choice.routeLabel}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {guidedAnswer && sampleBranchChoices.length === 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={fillAnswer}
                className="app-chip app-chip-sage"
              >
                填入参考回答
              </button>
              <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
                本步使用案例预设回答。
              </span>
            </div>
          )}
          {canModifyUnderstanding && reviewNeedsCardInteraction && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={fillReview}
                disabled={!canFillReview}
                className={canFillReview ? 'app-chip app-chip-sage' : 'app-chip app-chip-muted'}
                title={canFillReview ? '填入本案例的修改内容' : `先点击整理区「${reviewTargetCardTitle}」卡片`}
              >
                填入修改
              </button>
              <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
                {reviewCardBound
                  ? `正在修改「${reviewTargetCardTitle}」，可以填入修改。`
                  : `先把整理区「${reviewTargetCardTitle}」加入对话框。`}
              </span>
            </div>
          )}
          {briefSupplementRequired && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={fillSupplement}
                disabled={!canFillSupplement}
                className={canFillSupplement ? 'app-chip app-chip-sage' : 'app-chip app-chip-muted'}
                title={canFillSupplement ? '填入本案例的补充内容' : `先点击整理区「${supplementTargetCardTitle}」卡片`}
              >
                填入补充
              </button>
              <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
                {supplementCardBound
                  ? `正在补充「${supplementTargetCardTitle}」，可以填入内容。`
                  : `先把整理区「${supplementTargetCardTitle}」加入对话框。`}
              </span>
            </div>
          )}

          <div className="quick-composer-field">
            {cardBindings.map((binding) => (
              <span
                key={binding.id}
                className="quick-reference-token"
                title={bindingLabel(binding)}
              >
                <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <span className="quick-reference-token__label">
                  {bindingLabel(binding)}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${binding.title}`}
                  onClick={() => onRemoveCardBinding(binding.id)}
                  className="quick-reference-token__remove"
                >
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </span>
            ))}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                if (inputDisabledByStage || isSampleSession) return;
                setInput(e.target.value.slice(0, MAX_LENGTH));
              }}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={handleKeyDown}
              readOnly={inputDisabledByStage || isSampleSession}
              aria-readonly={inputDisabledByStage || isSampleSession}
              placeholder={composerPlaceholder}
              className="app-textarea quick-composer-textarea"
              style={{ maxHeight: 160 }}
              rows={3}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className="text-[11px]"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--aurora-muted)' }}
            >
              {isSampleSession ? '受控案例' : `${input.length}/${MAX_LENGTH}`}
            </span>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              className="app-btn-primary"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              <SendHorizontal className="h-4 w-4" strokeWidth={1.5} />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
      <ModelUnavailableDialog
        open={modelDialogOpen}
        title="暂时不能继续问诊"
        description="当前模型服务不可用，暂时不能处理新的回答或生成简报。你已输入的内容会保留，服务恢复后可以直接重试。"
        onDismiss={dismissModelDialog}
      />
    </>
  );
}

function StageActionPanel({
  label,
  title,
  description,
  actionText,
  disabled,
  onAction,
  actionHref,
  options = [],
}: {
  label: string;
  title: string;
  description: string;
  actionText: string;
  disabled: boolean;
  onAction?: () => void;
  actionHref?: string;
  options?: DisplayOption[];
}) {
  const router = useRouter();

  return (
    <div className="app-card mb-2" style={{ padding: '12px 14px' }}>
      <div className="mb-1 flex items-center gap-2">
        <span className="app-chip app-chip-sage">{label}</span>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--aurora-ink)' }}>
          {title}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--aurora-muted)' }}>
          {description}
        </p>
        {actionHref && !disabled ? (
          <button
            type="button"
            onClick={() => router.push(actionHref)}
            className="app-btn-primary"
            style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none' }}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            {actionText}
          </button>
        ) : (
          <button
            type="button"
            onClick={onAction}
            disabled={disabled}
            className="app-btn-primary"
            style={{ padding: '8px 14px', fontSize: 12 }}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            {actionText}
          </button>
        )}
      </div>
      {options.length > 0 && (
        <div className="mt-3 grid gap-2">
          {options.map((option) => {
            const isRecommended = option.is_recommended === true || option.isRecommended === true;
            const primaryPro = option.pros?.[0];
            const primaryCon = option.cons?.[0];
            return (
              <div
                key={option.id}
                className="quick-option-card rounded-md p-3"
                style={{
                  border: isRecommended
                    ? '1px solid rgba(107,138,126,0.36)'
                    : '1px solid var(--aurora-card-border)',
                  background: isRecommended
                    ? 'rgba(107,138,126,0.10)'
                    : 'rgba(255,255,255,0.34)',
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: 'var(--aurora-ink)' }}
                  >
                    {option.title}
                  </span>
                  {isRecommended && (
                    <span className="app-chip app-chip-sage" style={{ padding: '2px 7px', fontSize: 10 }}>
                      推荐
                    </span>
                  )}
                </div>
                <p
                  className="quick-option-card__description mt-1 text-[12px] leading-relaxed"
                  style={{ color: 'var(--aurora-ink-soft)' }}
                >
                  {option.description}
                </p>
                {((option.pros?.length ?? 0) > 0 || (option.cons?.length ?? 0) > 0) && (
                  <div className="mt-2 grid gap-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--aurora-muted)' }}>
                    {primaryPro && (
                      <div className="quick-option-card__line">
                        <span>主要收益</span>
                        <strong>{primaryPro}</strong>
                      </div>
                    )}
                    {primaryCon && (
                      <div className="quick-option-card__line">
                        <span>主要代价</span>
                        <strong>{primaryCon}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ turn }: { turn: QuickSessionTurn }) {
  if (turn.role === 'user') {
    const parsed = parseBoundContent(turn.content);
    return (
      <div
        className="flex flex-col items-end gap-1"
        style={{ animation: 'message-slide-in 200ms cubic-bezier(0,0,0.2,1)' }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
            我
          </span>
        </div>
        <div
          className="max-w-[85%] rounded-lg rounded-tr-sm px-3 py-2 text-[14px] leading-relaxed"
          style={{
            background: 'rgba(168,133,47,0.10)',
            border: '1px solid rgba(168,133,47,0.22)',
            color: 'var(--aurora-ink)',
          }}
        >
          <div className="quick-message-content">
            {parsed.boundLabels.map((label, index) => (
              <span
                key={`${label}-${index}`}
                className="quick-message-reference-token"
                title={label}
              >
                <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <span className="quick-reference-token__label">
                  {label}
                </span>
              </span>
            ))}
            {parsed.body && (
              <span className="quick-message-body">{parsed.body}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-start gap-1"
      style={{ animation: 'message-slide-in 200ms cubic-bezier(0,0,0.2,1)' }}
    >
      <div className="flex items-center gap-1.5">
        <Avatar variant="ai" size={24}>
          问
        </Avatar>
        <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
          问诊助手
        </span>
      </div>
      <div
        className="max-w-[88%] rounded-lg rounded-tl-sm px-3 py-2"
        style={{
          background: 'var(--aurora-card-bg)',
          border: '1px solid var(--aurora-card-border)',
          boxShadow: 'var(--aurora-shadow-soft)',
        }}
      >
        <StructuredContent turn={turn} />
        {turn.source_refs && turn.source_refs.length > 0 && (
          <div
            className="mt-2 flex flex-wrap items-center gap-2 pt-2"
            style={{ borderTop: '1px solid var(--aurora-hair)' }}
          >
            {turn.source_refs.map((ref, i) => (
              <span
                key={`${ref}-${i}`}
                className="inline-flex items-center gap-1 text-[11px]"
                style={{ fontFamily: 'var(--font-mono)', color: 'var(--aurora-muted)' }}
              >
                <Quote className="h-3 w-3" strokeWidth={1.5} />
                {describeSourceRef(ref)}
              </span>
            ))}
          </div>
        )}
        {turn.update_marks && turn.update_marks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {turn.update_marks.map((mark, i) => (
              <span key={`${mark}-${i}`} className="app-chip-sage">
                已整理：{describeUpdateMark(mark)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StructuredContent({ turn }: { turn: QuickSessionTurn }) {
  const sc = turn.structured_content;
  if (!sc) {
    return (
      <div
        className="text-[14px] leading-relaxed"
        style={{ color: 'var(--aurora-ink)' }}
      >
        {turn.content}
      </div>
    );
  }
  const paragraphs = sc.paragraphs ?? [];
  const highlights = sc.highlights ?? [];
  const bullets = sc.bullets ?? [];
  const nodes: ReactNode[] = [];

  paragraphs.forEach((p, i) => {
    nodes.push(
      <p
        key={`p-${i}`}
        className="text-[14px] leading-relaxed"
        style={{ color: 'var(--aurora-ink)' }}
      >
        {renderWithHighlights(p, highlights)}
      </p>,
    );
  });
  if (bullets.length > 0) {
    nodes.push(
      <ul key="bullets" className="mt-1 flex flex-col gap-1">
        {bullets.map((b, i) => (
          <li
            key={`b-${i}`}
            className="flex items-start gap-1.5 text-[14px] leading-relaxed"
            style={{ color: 'var(--aurora-ink-soft)' }}
          >
            <span
              className="mt-2 h-1 w-1 shrink-0 rounded-full"
              style={{ background: 'var(--aurora-gold)' }}
              aria-hidden="true"
            />
            <span>{renderWithHighlights(b, highlights)}</span>
          </li>
        ))}
      </ul>,
    );
  }
  if (paragraphs.length === 0 && bullets.length === 0) {
    nodes.push(
      <p
        key="fallback"
        className="text-[14px] leading-relaxed"
        style={{ color: 'var(--aurora-ink)' }}
      >
        {turn.content}
      </p>,
    );
  }
  return <div className="flex flex-col gap-1.5">{nodes}</div>;
}

function renderWithHighlights(text: string, highlights: string[]): ReactNode {
  if (highlights.length === 0) return text;
  const sorted = [...highlights].filter(Boolean).sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return text;
  const pattern = sorted.map(escapeRegExp).join('|');
  const regex = new RegExp(`(${pattern})`, 'g');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    sorted.includes(part) ? (
      <mark
        key={i}
        className="rounded-sm px-0.5"
        style={{ background: 'rgba(168,133,47,0.18)', color: 'var(--aurora-gold)' }}
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function bindingLabel(binding: QuickCardBinding): string {
  return binding.title;
}

function composeVisibleContent(content: string, bindings: QuickCardBinding[]): string {
  if (bindings.length === 0) return content;
  const header = bindings.map((binding) => `【${bindingLabel(binding)}】`).join(' ');
  return `${header}\n${content}`;
}

function parseBoundContent(content: string): { boundLabels: string[]; body: string } {
  const [firstLine, ...restLines] = content.split('\n');
  const matches = Array.from(firstLine.matchAll(/【([^】]+)】/g));
  if (matches.length === 0) {
    return { boundLabels: [], body: content };
  }
  return {
    boundLabels: matches.map((match) => match[1]),
    body: restLines.join('\n').trimStart(),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describeSourceRef(ref: string): string {
  const turnMatch = ref.match(/turn[_-]?(\d+)/i);
  if (turnMatch) {
    const n = parseInt(turnMatch[1], 10);
    return `基于用户第 ${n} 轮回答`;
  }
  if (/original_input|scenario/i.test(ref)) {
    return '基于原始输入';
  }
  return '基于会话记录';
}

function describeUpdateMark(mark: string): string {
  const idx = mark.indexOf('=');
  if (idx === -1) return mark;
  const field = mark.slice(0, idx).trim();
  return MARK_LABELS[field] ?? field;
}
