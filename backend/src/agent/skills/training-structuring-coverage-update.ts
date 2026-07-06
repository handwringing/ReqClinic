import type { SkillManifest } from '../types';

export const TRAINING_STRUCTURING_COVERAGE_UPDATE: SkillManifest = {
  skillId: 'training.structuring.coverage_update',
  skillVersion: '1.0.0',
  category: 'structuring',
  supportedModes: ['training'],
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  promptVersion: 'training-structuring-coverage-update-v1',
  allowedStateTransitions: ['interviewing'],
  allowedWrites: ['training_questions.disclosure_rule_hit'],
  requiredDomainPacks: [],
  validators: ['trainingCoverageUpdateSchema'],
};
