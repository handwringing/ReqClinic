import type { SkillManifest } from '../types';

export const TRAINING_ROLEPLAY_ANSWER: SkillManifest = {
  skillId: 'training.roleplay.answer',
  skillVersion: '1.0.0',
  category: 'elicitation',
  supportedModes: ['training'],
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  promptVersion: 'training-roleplay-answer-v1',
  allowedStateTransitions: ['interviewing'],
  allowedWrites: ['training_questions.disclosure_rule_hit', 'training_role_answers'],
  requiredDomainPacks: [],
  validators: ['trainingRoleAnswerOutputSchema'],
};
