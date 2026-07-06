'use client';

import {
  ChevronRight,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, LongWaitProgress } from '@/components/ui';
import { getApiClient } from '@/lib/api';
import type { FormalMapMessage } from '@/lib/api/types';
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
  onSubmitted,
}: FormalAiPanelProps) {
  const [draft, setDraft] = useState('');
  const [bindings, setBindings] = useState<FormalBinding[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasUserMessage = messages.some((message) => message.role === 'user');

  useEffect(() => {
    if (!externalBinding) return;
    setBindings((prev) => [
      ...prev.filter((item) => item.id !== externalBinding.id),
      {
        id: externalBinding.id,
        title: externalBinding.title,
        detail: externalBinding.detail,
      },
    ]);
  }, [externalBinding]);

  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [collapsed, messages.length, bindings.length, activeModule?.id, activeJobId]);

  if (collapsed) {
    return (
      <aside
        className="formal-ai-panel formal-ai-panel--collapsed"
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
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || submitting || activeJobId) return;
    setSubmitting(true);
    setErrorText('');
    try {
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

  return (
    <aside
      className="formal-ai-panel"
      style={{
        width: 'clamp(320px, 27vw, 390px)',
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
            module={activeModule}
            activeJobId={activeJobId}
            hasUserMessage={hasUserMessage}
          />
        )}
        {messages.length === 0 && (
          <FormalMessageBubble
            message={{
              id: 'local-initial-question',
              project_id: projectId,
              role: 'assistant',
              content: activeModule?.questions[0] ?? '我会根据需求地图继续追问。先确认最影响范围和交付的一个问题。',
              message_type: 'question',
              bound_refs: [],
              created_at: new Date().toISOString(),
            }}
          />
        )}
        {messages.map((message) => (
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
        <div className="inline-composer-field" style={{ minHeight: 88 }}>
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
          <textarea
            className="app-textarea inline-composer-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={activeJobId ? '正在更新地图，请稍候。' : '回答当前问题；也可以先从需求地图加入节点。'}
            rows={3}
            disabled={Boolean(activeJobId) || submitting}
            style={{ minHeight: 64 }}
          />
        </div>
        {errorText && <div className="formal-ai-error">{errorText}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            className="app-btn-primary"
            disabled={!draft.trim() || submitting || Boolean(activeJobId)}
            style={{ padding: '8px 14px', fontSize: 13 }}
          >
            <Send size={15} strokeWidth={1.5} aria-hidden="true" />
            {submitting ? '正在发送' : '发送'}
          </button>
        </div>
      </form>
    </aside>
  );
}

function FormalAiContextCard({
  module,
  activeJobId,
  hasUserMessage,
}: {
  module: QuickDemoGuidanceModule;
  activeJobId?: string | null;
  hasUserMessage: boolean;
}) {
  const firstQuestion = module.questions[0] ?? '当前节点暂无待确认问题。';

  return (
    <section className="formal-ai-context-card" aria-label="当前地图节点">
      <div className="app-label">当前节点</div>
      <h2>{module.title}</h2>
      <p>{module.summary}</p>
      <div className="formal-ai-context-card__question">
        <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>
          {activeJobId
            ? hasUserMessage
              ? '正在根据你的回答更新当前节点。'
              : '正在根据项目说明生成当前节点。'
            : firstQuestion}
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
              title={`${binding.title} · ${binding.detail}`}
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

