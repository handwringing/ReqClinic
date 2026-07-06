/**
 * taskType → promptVersion mapping (§9).
 *
 * Centralised so the StubProvider, JobWorker and ai_runs audit row all agree on
 * the prompt revision that produced an output. Bumping a version here is the
 * single lever for forcing re-validation against an updated schema gate.
 */

export const PROMPT_VERSIONS: Readonly<Record<string, string>> = {
  domain_profile: 'dp-prompt-v3',
  project_candidates: 'pc-prompt-v1',
  analysis_extraction: 'ax-prompt-v2',
  brief_generation: 'bg-prompt-v2',
  understanding_review: 'ur-prompt-v1',
  training_question: 'tq-prompt-v1',
  training_response: 'trp-prompt-v1',
  training_feedback: 'tfb-prompt-v1',
  'quick.routing.domain_risk': 'qr-prompt-v1',
  'quick.structuring.understanding_patch': 'qs-prompt-v2',
  'quick.validation.coverage_gate': 'qv-prompt-v1',
  'quick.elicitation.next_question': 'qe-prompt-v2',
  'quick.decisioning.options': 'qd-prompt-v2',
  'quick.composition.brief_views': 'qc-prompt-v3',
  formal_guidance: 'fg-prompt-v1',
  'formal.composition.guidance_report': 'fgr-prompt-v1',
};

/** Resolve the prompt version for a taskType, defaulting to `unknown-v0`. */
export function promptVersionFor(taskType: string): string {
  return PROMPT_VERSIONS[taskType] ?? 'unknown-v0';
}
