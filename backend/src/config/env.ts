import { z } from 'zod';

/**
 * Environment variable schema.
 *
 * Parsed once at module load and re-exported as a singleton `env` object so
 * that every part of the application reads from the same validated source.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DATABASE_PATH: z.string().min(1).default('./data/reqclinic.db'),
  SERVER_PEPPER: z.string().min(1).default('change-me-in-production'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  AI_PROVIDER: z.enum(['stub', 'ollama', 'openai_compatible']).default('stub'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('qwen3.5:9b'),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  OPENAI_COMPAT_BASE_URL: z.string().url().default('https://router.shengsuanyun.com/api/v1'),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
  OPENAI_COMPAT_MODEL: z.string().min(1).default('deepseek/deepseek-v4-flash'),
  OPENAI_COMPAT_PROVIDER_LABEL: z.string().min(1).default('shengsuanyun'),
  OPENAI_COMPAT_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  OPENAI_COMPAT_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
  OPENAI_COMPAT_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  OPENAI_COMPAT_JSON_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  OPENAI_COMPAT_REFERER: z.string().optional(),
  OPENAI_COMPAT_TITLE: z.string().min(1).default('ReqClinic'),
  OPENAI_COMPAT_THINKING: z.enum(['unset', 'enabled', 'disabled']).default('unset'),
  OPENAI_COMPAT_THINKING_TASKS: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  // Guard against running production with the default pepper.
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.SERVER_PEPPER === 'change-me-in-production'
  ) {
    throw new Error(
      'SERVER_PEPPER must be overridden from its default value in production.',
    );
  }

  if (
    result.data.AI_PROVIDER === 'openai_compatible' &&
    !result.data.OPENAI_COMPAT_API_KEY
  ) {
    throw new Error('OPENAI_COMPAT_API_KEY must be set when AI_PROVIDER=openai_compatible.');
  }

  return result.data;
}

export const env: Env = parseEnv();
