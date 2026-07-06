import { env } from '../config/env';
import type { AiProvider } from './provider';
import { OllamaProvider } from './ollama-provider';
import { OpenAiCompatibleProvider } from './openai-compatible-provider';
import { StubProvider } from './stub-provider';

export function createAiProvider(): AiProvider {
  if (env.AI_PROVIDER === 'ollama') {
    return new OllamaProvider({
      baseUrl: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_MODEL,
      temperature: env.OLLAMA_TEMPERATURE,
      timeoutMs: env.OLLAMA_TIMEOUT_MS,
    });
  }
  if (env.AI_PROVIDER === 'openai_compatible') {
    return new OpenAiCompatibleProvider({
      baseUrl: env.OPENAI_COMPAT_BASE_URL,
      apiKey: env.OPENAI_COMPAT_API_KEY!,
      model: env.OPENAI_COMPAT_MODEL,
      providerLabel: env.OPENAI_COMPAT_PROVIDER_LABEL,
      temperature: env.OPENAI_COMPAT_TEMPERATURE,
      maxTokens: env.OPENAI_COMPAT_MAX_TOKENS,
      timeoutMs: env.OPENAI_COMPAT_TIMEOUT_MS,
      jsonMode: env.OPENAI_COMPAT_JSON_MODE,
      referer: env.OPENAI_COMPAT_REFERER,
      title: env.OPENAI_COMPAT_TITLE,
      thinking: env.OPENAI_COMPAT_THINKING,
      thinkingTaskTypes: splitCsv(env.OPENAI_COMPAT_THINKING_TASKS),
    });
  }
  return new StubProvider();
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
