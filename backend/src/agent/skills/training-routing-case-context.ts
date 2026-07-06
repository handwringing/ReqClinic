import type { SkillManifest } from '../types';

export const TRAINING_ROUTING_CASE_CONTEXT: SkillManifest = {
  skillId: 'training.routing.case_context',
  skillVersion: '1.0.0',
  category: 'routing',
  supportedModes: ['training'],
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  promptVersion: 'training-routing-case-context-v1',
  allowedStateTransitions: ['interviewing'],
  allowedWrites: [],
  requiredDomainPacks: [],
  validators: [],
};
