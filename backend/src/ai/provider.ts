/**
 * AI provider interface (§9).
 *
 * A provider wraps a single model backend (e.g. a hosted LLM or a deterministic
 * stub) behind a uniform `invoke` contract. The JobWorker is the only caller in
 * production; tests and the StubProvider exercise it directly.
 *
 * `taskType` selects the prompt template and output schema gate; `payload`
 * carries the task-specific input. `domainPackVersions` lets a provider pin
 * domain-pack manifest revisions into the prompt context for reproducibility.
 */

export interface AiInvokeInput {
  /** Logical task selector, e.g. `domain_profile`, `analysis_extraction`. */
  taskType: string;
  /** Task-specific input payload (already validated upstream). */
  payload: unknown;
  /**
   * Optional map of `packId → version` pinning the domain-pack manifests the
   * prompt should reference. Forwarded so providers can embed deterministic
   * manifest revisions into the prompt and audit trail.
   */
  domainPackVersions?: Record<string, string>;
}

export type AiThinkingMode = 'unset' | 'enabled' | 'disabled';

export interface SkillInvocationAudit {
  skillId: string;
  skillVersion: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  promptVersion: string;
  provider: string | null;
  model: string | null;
  thinkingMode: AiThinkingMode | null;
  inputTokens: number;
  outputTokens: number;
  usageEstimated: boolean;
}

export interface AiInvokeResult {
  /** Structured output already parsed into a JS value. */
  output: unknown;
  /** Provider identifier, e.g. `stub`, `openai`. */
  provider: string;
  /** Model identifier, e.g. `stub-v1`, `gpt-4o`. */
  model: string;
  /** Prompt template version used for this task. */
  promptVersion: string;
  /** Token usage for billing/audit. */
  inputTokens: number;
  outputTokens: number;
  /** Thinking/reasoning mode sent to the provider for this call. */
  thinkingMode?: AiThinkingMode;
  /** True when token usage came from a local estimate instead of provider usage. */
  usageEstimated?: boolean;
  /** Optional per-skill audit projection for controlled agent runtimes. */
  skillAudits?: SkillInvocationAudit[];
}

export interface AiProvider {
  invoke(input: AiInvokeInput): Promise<AiInvokeResult>;
}
