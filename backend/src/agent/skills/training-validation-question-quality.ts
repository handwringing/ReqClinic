import type { SkillManifest } from '../types';

export const TRAINING_VALIDATION_QUESTION_QUALITY: SkillManifest = {
  skillId: 'training.validation.question_quality',
  skillVersion: '1.0.0',
  category: 'validation',
  supportedModes: ['training'],
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  promptVersion: 'training-validation-question-quality-v1',
  allowedStateTransitions: ['interviewing'],
  allowedWrites: ['training_questions.quality_label'],
  requiredDomainPacks: [],
  validators: ['trainingQuestionQualitySchema'],
};
