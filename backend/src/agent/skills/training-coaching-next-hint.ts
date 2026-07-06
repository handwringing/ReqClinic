import type { SkillManifest } from '../types';

export const TRAINING_COACHING_NEXT_HINT: SkillManifest = {
  skillId: 'training.coaching.next_hint',
  skillVersion: '1.0.0',
  category: 'decisioning',
  supportedModes: ['training'],
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  promptVersion: 'training-coaching-next-hint-v1',
  allowedStateTransitions: ['interviewing'],
  allowedWrites: [],
  requiredDomainPacks: [],
  validators: [],
};
