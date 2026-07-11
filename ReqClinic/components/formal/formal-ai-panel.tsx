'use client';

import {
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  GitBranch,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, LongWaitProgress } from '@/components/ui';
import { ModelUnavailableDialog } from '@/components/common/model-unavailable-dialog';
import { getApiClient } from '@/lib/api';
import { useModelApiGate } from '@/lib/use-model-api-gate';
import type { FormalGuidanceState, FormalMapMessage } from '@/lib/api/types';
import type { FormalDemoBranchChoice, FormalDemoBranchStep } from '@/lib/formal-demo-branches';
import type { QuickDemoGuidanceModule } from '@/lib/quick-demo-cases';

export interface FormalBinding {
  id: string;
  title: string;
  detail: string;
}

export interface FormalAiPanelProps {
  side?: 'left' | 'right';
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  projectTitle: string;
  projectId: string;
  activeModule?: QuickDemoGuidanceModule;
  externalBinding?: FormalBinding & { nonce: number };
  messages: FormalMapMessage[];
  activeJobId?: string | null;
  isGuidedDemo?: boolean;
  panelWidth?: number;
  requiredBindingId?: string;
  demoNotice?: string | null;
  demoFlowComplete?: boolean;
  demoBranchStep?: FormalDemoBranchStep | null;
  selectedDemoBranchChoiceId?: string | null;
  demoStepNumber?: number;
  demoStepTotal?: number;
  formalGuidanceState?: FormalGuidanceState | null;
  onDemoBranchChoice?: (choiceId: string) => void;
  onDemoStepComplete?: () => void;
  onOpenReport?: () => void;
  onSubmitted: (jobId?: string | null) => void;
}

export function FormalAiPanel({
  side = 'right',
  collapsed,
  onToggle,
  projectTitle,
  projectId,
  activeModule,
  externalBinding,
  messages,
  activeJobId,
  isGuidedDemo = false,
  panelWidth = 390,
  requiredBindingId,
  demoNotice,
  demoFlowComplete = false,
  demoBranchStep,
  selectedDemoBranchChoiceId,
  demoStepNumber = 1,
  demoStepTotal = 1,
  formalGuidanceState,
  onDemoBranchChoice,
  onDemoStepComplete,
  onOpenReport,
  onSubmitted,
}: FormalAiPanelProps) {
  const [draft, setDraft] = useState('');
  const [bindings, setBindings] = useState<FormalBinding[]>([]);
  const [localMessages, setLocalMessages] = useState<FormalMapMessage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');
  const { modelDialogOpen, requireModelApi, dismissModelDialog } = useModelApiGate({
    skip: isGuidedDemo,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleMessages = [...messages, ...localMessages];
  const hasUserMessage = visibleMessages.some((message) => message.role === 'user');
  const selectedDemoBranchChoice =
    demoBranchStep?.choices.find((choice) => choice.id === selectedDemoBranchChoiceId) ?? null;
  const isBranchDecision = isGuidedDemo && !!demoBranchStep && !demoFlowComplete;
  const formalReviewReady = !isGuidedDemo && formalGuidanceState?.status === 'review_ready';
  const hasRequiredBinding =
    !isGuidedDemo ||
    demoFlowComplete ||
    !requiredBindingId ||
    bindings.some((binding) => binding.id === requiredBindingId);

  useEffect(() => {
    if (!externalBinding) return;
    setErrorText('');
    const nextBinding = {
        id: externalBinding.id,
        title: externalBinding.title,
        detail: externalBinding.detail,
    };
    setBindings((prev) => (
      isGuidedDemo
        ? [nextBinding]
        : [
            ...prev.filter((item) => item.id !== externalBinding.id),
            nextBinding,
          ]
    ));
  }, [externalBinding, isGuidedDemo]);

  useEffect(() => {
    setLocalMessages([]);
    setDraft('');
    setBindings([]);
    setErrorText('');
  }, [projectId]);

  useEffect(() => {
    if (!isGuidedDemo) return;
    setDraft('');
    setBindings([]);
    setErrorText('');
  }, [isGuidedDemo, activeModule?.id]);

  useEffect(() => {
    if (!isGuidedDemo || !demoBranchStep) return;
    setDraft(selectedDemoBranchChoice?.answer ?? '');
  }, [demoBranchStep, isGuidedDemo, selectedDemoBranchChoice?.answer]);

  useEffect(() => {
    const container = scrollRef.current;
    if (collapsed || !container) return;
    let cancelled = false;
    let secondFrame: number | null = null;
    const align = () => {
      if (isBranchDecision) {
        const decision = container.querySelector<HTMLElement>('.formal-ai-branch-decision');
        if (!decision) {
          container.scrollTop = 0;
          return;
        }
        const topDelta = decision.getBoundingClientRect().top - container.getBoundingClientRect().top;
        container.scrollTop = Math.max(0, container.scrollTop + topDelta - 8);
        return;
      }
      container.scrollTop = container.scrollHeight;
    };
    const firstFrame = window.requestAnimationFrame(() => {
      align();
      secondFrame = window.requestAnimationFrame(align);
      void document.fonts?.ready.then(() => {
        if (!cancelled) align();
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [
    activeJobId,
    activeModule?.id,
    bindings.length,
    collapsed,
    demoBranchStep?.id,
    isBranchDecision,
    localMessages.length,
    messages.length,
  ]);

  if (collapsed) {
    return (
      <aside
        className="formal-ai-panel formal-ai-panel--collapsed page-motion-panel--left"
        style={{
          width: 48,
          height: '100%',
          minHeight: 0,
          background: 'rgba(245, 241, 232, 0.55)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderLeft: side === 'right' ? '1px solid var(--aurora-hair)' : undefined,
          borderRight: side === 'left' ? '1px solid var(--aurora-hair)' : undefined,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 0',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          aria-label="展开分析引导面板"
          onClick={() => onToggle(false)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 4,
            color: 'var(--aurora-gold)',
            display: 'inline-flex',
          }}
        >
          <ChevronRight
            size={18}
            strokeWidth={1.5}
            style={{ transform: side === 'right' ? 'rotate(180deg)' : undefined }}
          />
        </button>
        <button
          type="button"
          onClick={() => onToggle(false)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            fontFamily: 'var(--font-fraunces), var(--font-noto-serif-sc), serif',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--aurora-ink-soft)',
            letterSpacing: '0.2em',
            padding: '8px 0',
            flex: 1,
          }}
        >
          分析引导
        </button>
      </aside>
    );
  }

  function removeBinding(id: string) {
    setBindings((prev) => prev.filter((item) => item.id !== id));
    if (isGuidedDemo && id === requiredBindingId) {
      setDraft('');
      setErrorText('先重新加入当前节点，再填入回答。');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || submitting || activeJobId) return;
    if (isGuidedDemo && demoFlowComplete) return;
    if (isGuidedDemo && demoBranchStep && !selectedDemoBranchChoice) {
      setErrorText('先选择一个处理方向，再确认这次判断。');
      return;
    }
    if (isGuidedDemo && !hasRequiredBinding) {
      setErrorText(`先点「${activeModule?.title ?? '当前节点'}」节点上的“加入”。`);
      return;
    }
    if (!(await requireModelApi())) return;
    setSubmitting(true);
    setErrorText('');
    try {
      if (isGuidedDemo) {
        const now = new Date().toISOString();
        const moduleTitle = activeModule?.title ?? '当前节点';
        const userMessage: FormalMapMessage = {
          id: `local-user-${Date.now()}`,
          project_id: projectId,
          role: 'user',
          content: selectedDemoBranchChoice?.title ?? text,
          message_type: 'answer',
          bound_refs: bindings.map((binding) => ({
            id: binding.id,
            title: binding.title,
            detail: binding.detail,
            kind: 'map_node',
          })),
          created_at: now,
        };
        const assistantMessage: FormalMapMessage = {
          id: `local-assistant-${Date.now()}`,
          project_id: projectId,
          role: 'assistant',
          content: selectedDemoBranchChoice
            ? `已按「${selectedDemoBranchChoice.title}」更新「${moduleTitle}」。${selectedDemoBranchChoice.consequence}`
            : `回答已纳入「${moduleTitle}」节点。请继续按照下方提示确认下一项，完成后可以查看报告。`,
          message_type: 'status',
          bound_refs: [],
          created_at: now,
        };
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        setLocalMessages((prev) => [...prev, userMessage, assistantMessage]);
        setDraft('');
        setBindings([]);
        onDemoStepComplete?.();
        return;
      }
      const result = await getApiClient().postFormalProjectMessage({
        project_id: projectId,
        content: text,
        bound_refs: bindings.map((binding) => ({
          id: binding.id,
          title: binding.title,
          detail: binding.detail,
          kind: 'map_node',
        })),
      });
      setDraft('');
      setBindings([]);
      onSubmitted(result.job_id);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : '发送失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemoAnswer() {
    if (submitting || activeJobId) return;
    if (demoFlowComplete) return;
    if (!hasRequiredBinding) {
      setErrorText(`先点「${activeModule?.title ?? '当前节点'}」节点上的“加入”。`);
      return;
    }
    setErrorText('');
    setDraft(buildDemoFormalAnswer(activeModule, projectTitle));
  }

  function selectDemoBranchChoice(choice: FormalDemoBranchChoice) {
    if (submitting || activeJobId || demoFlowComplete) return;
    setErrorText('');
    setDraft(choice.answer);
    onDemoBranchChoice?.(choice.id);
  }

  return (
    <>
    <aside
      className="formal-ai-panel page-motion-panel--left"
      style={{
        width: panelWidth,
        height: '100%',
        minHeight: 0,
        background: 'rgba(245, 241, 232, 0.55)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderLeft: side === 'right' ? '1px solid var(--aurora-hair)' : undefined,
        borderRight: side === 'left' ? '1px solid var(--aurora-hair)' : undefined,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div
        style={{
          height: 44,
          flexShrink: 0,
          padding: '0 8px 0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--aurora-hair)',
        }}
      >
        <span className="app-label" style={{ fontSize: 11 }}>
          分析引导
        </span>
        <button
          type="button"
          aria-label="折叠分析引导面板"
          onClick={() => onToggle(true)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            color: 'var(--aurora-muted)',
            display: 'inline-flex',
          }}
        >
          <ChevronRight
            size={16}
            strokeWidth={1.5}
            style={{ transform: side === 'left' ? 'rotate(180deg)' : undefined }}
          />
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {activeModule && (
          <FormalAiContextCard
            key={`${activeModule.id}-${demoBranchStep?.id ?? 'linear'}-${activeJobId ? 'busy' : 'ready'}`}
            module={activeModule}
            activeJobId={activeJobId}
            hasUserMessage={hasUserMessage}
            questionOverride={demoBranchStep?.prompt}
            reviewReady={formalReviewReady}
          />
        )}
        {isGuidedDemo && demoBranchStep && !demoFlowComplete && (
          <DemoBranchDecision
            step={demoBranchStep}
            selectedChoiceId={selectedDemoBranchChoiceId}
            stepNumber={demoStepNumber}
            stepTotal={demoStepTotal}
            onSelect={selectDemoBranchChoice}
          />
        )}
        {visibleMessages.length === 0 && !isBranchDecision && (
          <FormalMessageBubble
            message={{
              id: 'local-initial-question',
              project_id: projectId,
              role: 'assistant',
              content:
                demoBranchStep?.prompt ??
                activeModule?.questions[0] ??
                '我们先确认最影响范围和交付的问题。',
              message_type: 'question',
              bound_refs: [],
              created_at: new Date().toISOString(),
            }}
          />
        )}
        {visibleMessages.map((message) => (
          <FormalMessageBubble key={message.id} message={message} />
        ))}
        {activeJobId && (
          <LongWaitProgress
            compact
            className="formal-ai-waiting"
            title={hasUserMessage ? '正在整理回答' : '正在整理项目说明'}
            description={
              hasUserMessage
                ? '地图和报告会自动更新，请先不要重复发送。'
                : '会先生成地图，再提出最需要确认的问题。'
            }
            steps={hasUserMessage ? ['读取回答', '更新节点', '准备下一问'] : ['读取说明', '生成地图', '准备第一问']}
          />
        )}
      </div>

      {isBranchDecision ? (
        <form
          className="formal-ai-decision-footer"
          onSubmit={(event) => void submit(event)}
        >
          <div className="formal-ai-decision-footer__status" role="status" aria-live="polite">
            <strong>
              {selectedDemoBranchChoice
                ? `已选择：${selectedDemoBranchChoice.title}`
                : '请选择一个处理方向'}
            </strong>
            <p>
              {selectedDemoBranchChoice
                ? selectedDemoBranchChoice.consequence
                : '每个方向都会改变后续优先确认的内容，选中后再继续。'}
            </p>
          </div>
          {(demoNotice || errorText) && (
            <div className="formal-ai-demo-notice" role="status" aria-live="polite">
              {errorText || demoNotice}
            </div>
          )}
          <button
            type="submit"
            className="app-btn-primary formal-ai-decision-footer__action"
            disabled={
              !selectedDemoBranchChoice ||
              !draft.trim() ||
              !hasRequiredBinding ||
              submitting ||
              Boolean(activeJobId)
            }
          >
            {submitting ? '正在确认' : '确认并继续'}
            <ChevronRight size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </form>
      ) : isGuidedDemo && demoFlowComplete ? (
        <section className="formal-ai-complete-action" role="status" aria-live="polite">
          <div className="formal-ai-complete-action__copy">
            <CheckCircle2 size={18} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <strong>{demoStepTotal} 项关键判断已完成</strong>
              <p>处理路线已经更新到需求地图，可以查看本轮整理结果。</p>
            </div>
          </div>
          <button
            type="button"
            className="app-btn-primary formal-ai-complete-action__button"
            onClick={onOpenReport}
            disabled={!onOpenReport}
          >
            <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
            查看本轮报告
          </button>
        </section>
      ) : (
        <form
          style={{
            flexShrink: 0,
            borderTop: '1px solid var(--aurora-hair)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
          onSubmit={(event) => void submit(event)}
        >
          {!isGuidedDemo && formalGuidanceState && (
            <div
              className={`formal-ai-guidance-state ${formalReviewReady ? 'is-ready' : 'is-eliciting'}`}
              role="status"
              aria-live="polite"
            >
              {formalReviewReady
                ? <CheckCircle2 size={17} strokeWidth={1.5} aria-hidden="true" />
                : <Circle size={17} strokeWidth={1.5} aria-hidden="true" />}
              <div>
                <strong>
                  {formalReviewReady
                    ? '本轮关键模块已覆盖'
                    : `已覆盖 ${formalGuidanceState.coveredModuleCount} / ${formalGuidanceState.totalModuleCount} 个关键模块`}
                </strong>
                <p>
                  {formalReviewReady
                    ? '可以复核本轮报告；项目没有固定轮数，仍可选择节点继续补充。'
                    : `还有 ${formalGuidanceState.unresolvedCount} 项关键问题，系统会按缺口继续追问。`}
                </p>
              </div>
              {formalReviewReady && (
                <button type="button" onClick={onOpenReport} disabled={!onOpenReport}>
                  <FileText size={14} strokeWidth={1.5} aria-hidden="true" />
                  查看报告
                </button>
              )}
            </div>
          )}
          {isGuidedDemo && (
            <div className="formal-ai-demo-guide" role="note">
              <span>先在「{activeModule?.title ?? '当前节点'}」点击“加入对话”，再填入本步回答。</span>
              <button
                type="button"
                className="app-chip app-chip-sage"
                onClick={fillDemoAnswer}
                disabled={Boolean(activeJobId) || submitting || !hasRequiredBinding}
              >
                填入回答
              </button>
            </div>
          )}
          {isGuidedDemo && (demoNotice || errorText) && (
            <div className="formal-ai-demo-notice" role="status" aria-live="polite">
              {errorText || demoNotice}
            </div>
          )}
          <div className="inline-composer-field" style={{ minHeight: 88 }}>
            {bindings.length > 0 && (
              <div className="inline-composer-reference-strip" aria-label="已加入对话的节点">
                {bindings.map((binding) => (
                <span
                  key={binding.id}
                  className="inline-reference-token"
                  title={`${binding.title} · ${binding.detail}`}
                >
                  <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  <span className="inline-reference-token__label">{binding.title}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${binding.title}`}
                    className="inline-reference-token__remove"
                    onClick={() => removeBinding(binding.id)}
                  >
                    <X className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </span>
                ))}
              </div>
            )}
            <textarea
              className={`app-textarea inline-composer-textarea ${isGuidedDemo ? 'inline-composer-textarea--locked' : ''}`}
              value={draft}
              onChange={(event) => {
                if (isGuidedDemo) return;
                setDraft(event.target.value);
              }}
              placeholder={activeJobId
                ? '正在更新地图，请稍候。'
                : isGuidedDemo
                  ? `先在「${activeModule?.title ?? '当前节点'}」点击“加入对话”，再点击“填入回答”。`
                  : formalReviewReady
                    ? '继续补充信息，或从需求地图加入想深入的节点。'
                    : '回答当前问题；也可以先从需求地图加入节点。'}
              rows={3}
              disabled={Boolean(activeJobId) || submitting}
              readOnly={isGuidedDemo}
              style={{ minHeight: 64 }}
            />
          </div>
          {!isGuidedDemo && errorText && <div className="formal-ai-error">{errorText}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              className="app-btn-primary"
              disabled={
                !draft.trim() ||
                submitting ||
                Boolean(activeJobId) ||
                (isGuidedDemo && !hasRequiredBinding)
              }
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              <Send size={15} strokeWidth={1.5} aria-hidden="true" />
              {submitting ? '正在发送' : formalReviewReady ? '发送补充' : '发送'}
            </button>
          </div>
        </form>
      )}
    </aside>
      <ModelUnavailableDialog
        open={modelDialogOpen}
        title="暂时不能继续追问"
        description="当前模型服务不可用，暂时不能继续整理需求地图。你已填写的内容会保留，服务恢复后可以直接重试。"
        onDismiss={dismissModelDialog}
      />
    </>
  );
}

function DemoBranchDecision({
  step,
  selectedChoiceId,
  stepNumber,
  stepTotal,
  onSelect,
}: {
  step: FormalDemoBranchStep;
  selectedChoiceId?: string | null;
  stepNumber: number;
  stepTotal: number;
  onSelect: (choice: FormalDemoBranchChoice) => void;
}) {
  return (
    <section
      className="formal-ai-branch-decision page-motion-stage"
      data-branch-case={step.id.split('_')[0]}
      aria-label="当前处理方向"
    >
      <div className="formal-ai-branch-decision__head">
        <span className="app-label">
          <GitBranch size={13} strokeWidth={1.5} aria-hidden="true" />
          关键判断 {stepNumber} / {stepTotal}
        </span>
        <strong>选择处理方向</strong>
        <p>{step.context}</p>
      </div>
      <div className="formal-ai-branch-decision__choices" role="group" aria-label={step.prompt}>
        {step.choices.map((choice) => {
          const selected = choice.id === selectedChoiceId;
          return (
            <button
              key={choice.id}
              type="button"
              className={`formal-ai-branch-choice ${selected ? 'is-selected' : ''}`}
              aria-pressed={selected}
              data-branch-choice={choice.id}
              onClick={() => onSelect(choice)}
            >
              <span className="formal-ai-branch-choice__main">
                <span className="formal-ai-branch-choice__indicator" aria-hidden="true">
                  {selected
                    ? <CheckCircle2 size={17} strokeWidth={1.7} />
                    : <Circle size={17} strokeWidth={1.5} />}
                </span>
                <span className="formal-ai-branch-choice__copy">
                  <strong>{choice.title}</strong>
                  <small>{choice.consequence}</small>
                </span>
                <em>{choice.routeLabel}</em>
              </span>
              <span className="formal-ai-branch-choice__action">
                {selected ? '已选择' : '选择此方向'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function buildDemoFormalAnswer(module?: QuickDemoGuidanceModule, projectTitle?: string): string {
  const question = module?.questions?.[0] ?? '';
  const title = module?.title ?? '';
  if (/权限|角色|使用/.test(title + question)) {
    return '先由项目负责人确认规则，普通使用者只提交或查看自己的内容，管理员负责审核、记录和异常处理。';
  }
  if (/范围|栏目|内容|交付/.test(title + question)) {
    return '首版只覆盖最关键的使用路径和必须交付内容，暂时不做会明显拉长周期的扩展能力。';
  }
  if (/验收|标准|里程碑|成功/.test(title + question)) {
    return '验收时按可运行流程、关键页面、移动端适配和待确认清单逐项检查，不把未确认内容写成最终承诺。';
  }
  if (/风险|边界|变更/.test(title + question)) {
    return '成本、周期和责任边界需要提前写清楚；不确定项先保留为待确认，后续再决定是否进入正式范围。';
  }
  if (/方案|取舍/.test(title + question)) {
    return '优先选择能最快验证核心目标的方案，复杂能力放到后续版本，避免首版范围失控。';
  }
  return `${projectTitle ?? '这个项目'}先按当前节点继续确认：首版聚焦最重要的目标、对象、场景和完成标准，暂不把未确认内容当成最终承诺。`;
}

function FormalAiContextCard({
  module,
  activeJobId,
  hasUserMessage,
  questionOverride,
  reviewReady = false,
}: {
  module: QuickDemoGuidanceModule;
  activeJobId?: string | null;
  hasUserMessage: boolean;
  questionOverride?: string;
  reviewReady?: boolean;
}) {
  const firstQuestion = questionOverride ?? module.questions[0] ?? '当前节点暂无待确认问题。';

  return (
    <section className="formal-ai-context-card" aria-label="当前地图节点">
      <div className="app-label">当前节点</div>
      <h2>{module.title}</h2>
      <p>{module.summary}</p>
      <div className="formal-ai-context-card__question page-motion-question">
        <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>
          {activeJobId
            ? hasUserMessage
              ? '正在根据你的回答更新当前节点。'
              : '正在根据项目说明生成当前节点。'
            : reviewReady
              ? '本轮状态：关键问题已覆盖，仍可继续补充。'
              : `当前追问：${firstQuestion}`}
        </span>
      </div>
      <div className="formal-ai-context-card__mini">
        <MiniFact label="已明确" value={module.known.length} />
        <MiniFact label="初步判断" value={module.assumptions.length} />
        <MiniFact label="待确认" value={module.questions.length} />
      </div>
    </section>
  );
}

function MiniFact({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <strong>{value}</strong>
      {label}
    </span>
  );
}

function FormalMessageBubble({ message }: { message: FormalMapMessage }) {
  const isUser = message.role === 'user';
  return (
    <div
      className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
      style={{ animation: 'message-slide-in 200ms cubic-bezier(0,0,0.2,1)' }}
    >
      <div className="flex items-center gap-1.5">
        {!isUser && (
          <Avatar variant="ai" size={24} aria-label="助手">
            问
          </Avatar>
        )}
        <span className="text-[11px]" style={{ color: 'var(--aurora-muted)' }}>
          {isUser ? '我' : '助手'}
        </span>
      </div>
      <div
        className="max-w-[92%] rounded-lg px-3 py-2 text-[13px] leading-relaxed"
        style={{
          background: isUser ? 'rgba(168,133,47,0.10)' : 'var(--aurora-card-bg)',
          border: isUser
            ? '1px solid rgba(168,133,47,0.22)'
            : '1px solid var(--aurora-card-border)',
          color: 'var(--aurora-ink)',
          boxShadow: isUser ? undefined : 'var(--aurora-shadow-soft)',
        }}
      >
        <div className="inline-message-content">
          {message.bound_refs?.map((binding) => (
            <span
              key={binding.id}
              className="inline-message-reference-token"
              title={binding.detail ? `${binding.title} · ${binding.detail}` : binding.title}
            >
              <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className="inline-reference-token__label">{binding.title}</span>
            </span>
          ))}
          <span className="inline-message-body">{message.content}</span>
        </div>
      </div>
    </div>
  );
}

