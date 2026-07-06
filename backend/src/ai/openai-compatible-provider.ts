import type { AiInvokeInput, AiInvokeResult, AiProvider } from './provider';
import { promptVersionFor } from './prompt-versions';
import { buildJsonMessages, estimateTokens, parseJsonObject, trimSlash } from './json-prompt';

export interface OpenAiCompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerLabel?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  referer?: string;
  title?: string;
  thinking?: 'unset' | 'enabled' | 'disabled';
  thinkingTaskTypes?: string[];
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    text?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export class OpenAiCompatibleProvider implements AiProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly providerLabel: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly jsonMode: boolean;
  private readonly referer?: string;
  private readonly title?: string;
  private readonly thinking: 'unset' | 'enabled' | 'disabled';
  private readonly thinkingTaskTypes: Set<string>;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.baseUrl = trimSlash(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.providerLabel = options.providerLabel ?? 'openai_compatible';
    this.temperature = options.temperature ?? 0.2;
    this.maxTokens = options.maxTokens ?? 4096;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.jsonMode = options.jsonMode ?? true;
    this.referer = options.referer;
    this.title = options.title;
    this.thinking = options.thinking ?? 'unset';
    this.thinkingTaskTypes = new Set(options.thinkingTaskTypes ?? []);
  }

  async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
    const promptVersion = promptVersionFor(input.taskType);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal: controller.signal,
        body: JSON.stringify(this.body(input)),
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new Error(`${this.providerLabel} request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const rawText = await response.text();
    const raw = parseResponseBody(rawText);
    if (!response.ok) {
      const message = raw?.error?.message ?? (rawText.slice(0, 300) || response.statusText);
      throw new Error(`${this.providerLabel} request failed: ${response.status} ${message}`);
    }

    const content = raw?.choices?.[0]?.message?.content ?? raw?.choices?.[0]?.text ?? '';
    if (!content.trim()) {
      throw new Error(`${this.providerLabel} returned empty content`);
    }

    const output = parseJsonObject(content, this.providerLabel);
    const inputTokens =
      raw?.usage?.prompt_tokens ??
      raw?.usage?.input_tokens ??
      estimateTokens(JSON.stringify(input.payload));
    const outputTokens =
      raw?.usage?.completion_tokens ??
      raw?.usage?.output_tokens ??
      estimateTokens(content);
    const usageEstimated =
      raw?.usage?.prompt_tokens === undefined &&
      raw?.usage?.input_tokens === undefined &&
      raw?.usage?.completion_tokens === undefined &&
      raw?.usage?.output_tokens === undefined;
    return {
      output,
      provider: this.providerLabel,
      model: raw?.model ?? this.model,
      promptVersion,
      inputTokens,
      outputTokens,
      thinkingMode: this.thinkingFor(input.taskType),
      usageEstimated,
    };
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };
    if (this.referer) headers['HTTP-Referer'] = this.referer;
    if (this.title) headers['X-Title'] = this.title;
    return headers;
  }

  private body(input: AiInvokeInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      stream: false,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      messages: buildJsonMessages(input),
    };
    if (this.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    const thinking = this.thinkingFor(input.taskType);
    if (thinking !== 'unset') {
      body.thinking = { type: thinking };
    }
    return body;
  }

  private thinkingFor(taskType: string): 'unset' | 'enabled' | 'disabled' {
    if (this.thinkingTaskTypes.has(taskType)) return 'enabled';
    return this.thinking;
  }
}

function parseResponseBody(text: string): ChatCompletionResponse | null {
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    return null;
  }
}
