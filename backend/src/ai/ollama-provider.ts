import type { AiInvokeInput, AiInvokeResult, AiProvider } from './provider';
import { promptVersionFor } from './prompt-versions';
import { buildJsonMessages, estimateTokens, parseJsonObject, trimSlash } from './json-prompt';

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    content?: string;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements AiProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = trimSlash(options.baseUrl ?? 'http://localhost:11434');
    this.model = options.model ?? 'qwen3.5:9b';
    this.temperature = options.temperature ?? 0.2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
    const promptVersion = promptVersionFor(input.taskType);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: 'json',
          think: false,
          options: {
            temperature: this.temperature,
          },
          messages: buildJsonMessages(input),
        }),
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const raw = (await response.json()) as OllamaChatResponse;
    const content = raw.message?.content ?? '';
    const output = parseJsonObject(content, 'Ollama');

    return {
      output,
      provider: 'ollama',
      model: raw.model ?? this.model,
      promptVersion,
      inputTokens: raw.prompt_eval_count ?? estimateTokens(JSON.stringify(input.payload)),
      outputTokens: raw.eval_count ?? estimateTokens(content),
      thinkingMode: 'disabled',
      usageEstimated: raw.prompt_eval_count === undefined && raw.eval_count === undefined,
    };
  }
}
