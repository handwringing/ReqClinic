import type { SkillManifest } from '../types';

export const TRAINING_COMPOSITION_FEEDBACK_REPORT: SkillManifest = {
  skillId: 'training.composition.feedback_report',
  skillVersion: '1.0.0',
  category: 'composition',
  supportedModes: ['training'],
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  promptVersion: 'training-composition-feedback-report-v1',
  allowedStateTransitions: ['summarizing', 'feedback_ready'],
  allowedWrites: ['training_feedback'],
  requiredDomainPacks: [],
  validators: ['trainingFeedbackOutputSchema'],
};
