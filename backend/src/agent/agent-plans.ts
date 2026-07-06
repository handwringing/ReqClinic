import type { AgentMode, AgentPlan, ResolveAgentPlanInput } from './types';
import { defaultSkillRegistry, type SkillRegistry } from './skill-registry';
import { FORMAL_SKILL_MANIFESTS } from './formal-schemas';

export const ORCHESTRATOR_AGENT_ID = 'reqclinic.orchestrator';

export const QUICK_CONSULT_PLAN: AgentPlan = {
  planId: 'quick_consult',
  planVersion: '1.0.0',
  agentId: ORCHESTRATOR_AGENT_ID,
  mode: 'quick',
  taskTypes: [
    'domain_profile',
    'project_candidates',
    'brief_generation',
    'understanding_review',
    'next_question',
    'option_comparison',
  ],
  steps: [
    { skillId: 'quick.routing.domain_risk', skillVersion: '1.0.0' },
    { skillId: 'quick.structuring.understanding_patch', skillVersion: '1.0.0' },
    { skillId: 'quick.validation.coverage_gate', skillVersion: '1.0.0' },
    { skillId: 'quick.elicitation.next_question', skillVersion: '1.0.0' },
    { skillId: 'quick.decisioning.options', skillVersion: '1.0.0' },
    { skillId: 'quick.composition.brief_views', skillVersion: '1.0.0' },
  ],
};

export const FORMAL_GUIDANCE_PLAN: AgentPlan = {
  planId: 'formal_guidance_report',
  planVersion: '1.0.0',
  agentId: ORCHESTRATOR_AGENT_ID,
  mode: 'formal',
  taskTypes: ['formal_guidance'],
  steps: FORMAL_SKILL_MANIFESTS.map((skill) => ({
    skillId: skill.skillId,
    skillVersion: skill.skillVersion,
  })),
};

export const FORMAL_RESERVED_PLAN: AgentPlan = {
  planId: 'formal_reserved',
  planVersion: '0.1.0',
  agentId: ORCHESTRATOR_AGENT_ID,
  mode: 'formal',
  taskTypes: ['domain_profile', 'project_candidates', 'analysis_extraction', 'brief_generation'],
  steps: [
    { skillId: 'formal.routing.reserved', skillVersion: '0.1.0' },
  ],
};

export const TRAINING_PRACTICE_PLAN: AgentPlan = {
  planId: 'training_practice',
  planVersion: '1.0.0',
  agentId: ORCHESTRATOR_AGENT_ID,
  mode: 'training',
  taskTypes: ['training_response', 'training_feedback'],
  steps: [
    { skillId: 'training.routing.case_context', skillVersion: '1.0.0' },
    { skillId: 'training.roleplay.answer', skillVersion: '1.0.0' },
    { skillId: 'training.structuring.coverage_update', skillVersion: '1.0.0' },
    { skillId: 'training.validation.question_quality', skillVersion: '1.0.0' },
    { skillId: 'training.coaching.next_hint', skillVersion: '1.0.0' },
    { skillId: 'training.composition.feedback_report', skillVersion: '1.0.0' },
  ],
};

export const AGENT_PLANS = [
  QUICK_CONSULT_PLAN,
  FORMAL_GUIDANCE_PLAN,
  FORMAL_RESERVED_PLAN,
  TRAINING_PRACTICE_PLAN,
] as const;

export function resolveAgentPlan(
  input: ResolveAgentPlanInput,
  registry: SkillRegistry = defaultSkillRegistry,
): AgentPlan {
  const mode = modeFromScope(input.scopeKind);
  const plan = AGENT_PLANS.find(
    (candidate) =>
      candidate.mode === mode &&
      (candidate.taskTypes.includes(input.taskType) || candidate.planId.endsWith('_reserved')),
  );
  if (!plan) {
    throw new Error(`No agent plan for ${input.scopeKind}/${input.taskType}`);
  }
  for (const step of plan.steps) {
    const skill = registry.get(step.skillId, step.skillVersion);
    if (!skill.supportedModes.includes(plan.mode) && !plan.planId.endsWith('_reserved')) {
      throw new Error(`Skill ${step.skillId}@${step.skillVersion} does not support ${plan.mode}`);
    }
  }
  return plan;
}

export function modeFromScope(scopeKind: string): AgentMode {
  switch (scopeKind) {
    case 'quick_session':
      return 'quick';
    case 'formal_project':
      return 'formal';
    case 'training_attempt':
      return 'training';
    default:
      throw new Error(`Unknown agent scope: ${scopeKind}`);
  }
}
