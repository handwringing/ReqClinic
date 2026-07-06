export const SKILL_CATEGORIES = [
  'routing',
  'elicitation',
  'structuring',
  'validation',
  'decisioning',
  'composition',
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
export type AgentMode = 'quick' | 'formal' | 'training';

export interface SkillManifest {
  skillId: string;
  skillVersion: string;
  category: SkillCategory;
  supportedModes: AgentMode[];
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  promptVersion: string;
  allowedStateTransitions: string[];
  allowedWrites: string[];
  requiredDomainPacks: string[];
  validators: string[];
}

export interface AgentPlanStep {
  skillId: string;
  skillVersion: string;
}

export interface AgentPlan {
  planId: string;
  planVersion: string;
  agentId: string;
  mode: AgentMode;
  taskTypes: string[];
  steps: AgentPlanStep[];
}

export interface ResolveAgentPlanInput {
  scopeKind: 'formal_project' | 'quick_session' | 'training_attempt' | string;
  taskType: string;
  state?: string | null;
  domainProfileId?: string | null;
}
