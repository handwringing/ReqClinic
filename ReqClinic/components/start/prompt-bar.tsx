'use client';

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getApiClient } from '@/lib/api';
import { PRODUCT_TERMS } from '@/lib/product-language';

const MAX_LENGTH = 10000;
const NEED_HINT = '这句话还不够像一个需求，请补充你想做什么、给谁用、希望得到什么结果。';

interface ModelHealth {
  ai?: {
    model_api_ready?: boolean;
    api_key_configured?: boolean | null;
  };
}

function looksLikeNeed(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^[\d\s.,，。:：;；!?！？_-]+$/.test(text)) return false;
  const compact = text.replace(/\s+/g, '');
  if (/^[a-zA-Z0-9_-]+$/.test(compact) && !/[一-龥]/.test(compact)) return false;
  if (/[一-龥]/.test(text) && /想|需要|希望|做|写|生成|设计|开发|策划|整理|分析|优化|搭建|制作|创建|准备|确认|改/.test(text)) {
    return true;
  }
  return /[一-龥]/.test(text) && text.length >= 8;
}

function backendRootUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) return null;
  return baseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
}

async function hasModelApiAccess(): Promise<boolean> {
  const rootUrl = backendRootUrl();
  if (!rootUrl) return false;
  try {
    const res = await fetch(`${rootUrl}/health`, {
      cache: 'no-store',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const health = (await res.json()) as ModelHealth;
    return health.ai?.model_api_ready === true || health.ai?.api_key_configured === true;
  } catch {
    return false;
  }
}

export function PromptBar() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const composingRef = useRef(false);
  const submittingRef = useRef(false);

  const handleSubmit = useCallback(async () => {
    const value = input.trim();
    if (submittingRef.current) return;
    if (!value) {
      setHintVisible(true);
      setValidationMessage(null);
      return;
    }
    if (!looksLikeNeed(value)) {
      setHintVisible(true);
      setValidationMessage(NEED_HINT);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    let keepSubmitting = false;
    try {
      const modelReady = await hasModelApiAccess();
      if (!modelReady) {
        setApiKeyDialogOpen(true);
        setHintVisible(false);
        setValidationMessage(null);
        return;
      }
      const session = await getApiClient().createQuickSession({
        source_kind: 'custom',
        original_input: value,
      });
      keepSubmitting = true;
      router.push(`/quick/${session.id}`);
    } catch {
      // Keep the current inline behavior: failed entry simply returns control.
    } finally {
      if (!keepSubmitting) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }, [input, router]);

  const scrollToCases = useCallback(() => {
    setApiKeyDialogOpen(false);
    document.querySelector('.mode-case-grid')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (composingRef.current) return;
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  const canSubmit = input.trim().length > 0 && !submitting;

  return (
    <form
      className="prompt-card"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="field-label">
        <span>从一句话开始</span>
        <span className="req">*</span>
        <span className="opt">{PRODUCT_TERMS.customInput}</span>
      </div>
      <textarea
        value={input}
        onChange={(e) => {
          setInput(e.target.value.slice(0, MAX_LENGTH));
          if (hintVisible) setHintVisible(false);
          if (validationMessage) setValidationMessage(null);
        }}
        onFocus={() => {
          if (!input.trim()) setHintVisible(true);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={handleKeyDown}
        readOnly={submitting}
        placeholder="用一句话说说你想做什么，问诊助手会从第一个问题开始追问。"
        className="aurora-textarea"
        aria-label="一句话需求输入"
      />

      {hintVisible && (
        <div className="mode-chip-row">
          <span className="mode-chip">{validationMessage ? '再补充一点' : '从一句话开始'}</span>
          <span className="mode-chip-hint">
            {validationMessage ?? '也可以直接点击下方示例，先体验完整问诊流程。'}
          </span>
        </div>
      )}

      <button type="submit" className="submit-btn" disabled={!canSubmit}>
        <span>{submitting ? '正在进入…' : '开始问诊'}</span>
        <span className="arrow">{submitting ? '·' : '→'}</span>
      </button>

      <div className="consent-row">
        <span style={{ fontSize: '12px', color: 'var(--aurora-muted)', fontStyle: 'italic' }}>
          {input.length}/{MAX_LENGTH}
        </span>
      </div>

      {apiKeyDialogOpen && (
        <div className="model-key-modal" role="dialog" aria-modal="true" aria-labelledby="model-key-title">
          <div className="model-key-panel">
            <div className="model-key-kicker">{PRODUCT_TERMS.modelUnavailableKicker}</div>
            <h2 id="model-key-title">{PRODUCT_TERMS.modelUnavailableTitle}</h2>
            <p>
              当前环境还没有可用的模型服务，暂时不能从你输入的内容开始问诊。
              你可以先点击下方示例，体验问诊助手如何追问、整理需求和生成简报。
            </p>
            <div className="model-key-actions">
              <button type="button" className="model-key-secondary" onClick={() => setApiKeyDialogOpen(false)}>
                知道了
              </button>
              <button type="button" className="model-key-primary" onClick={scrollToCases}>
                {PRODUCT_TERMS.viewExamples}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
