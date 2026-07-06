export { TRAINING_ROUTING_CASE_CONTEXT } from './training-routing-case-context';
export { TRAINING_ROLEPLAY_ANSWER } from './training-roleplay-answer';
export { TRAINING_STRUCTURING_COVERAGE_UPDATE } from './training-structuring-coverage-update';
export { TRAINING_VALIDATION_QUESTION_QUALITY } from './training-validation-question-quality';
export { TRAINING_COACHING_NEXT_HINT } from './training-coaching-next-hint';
export { TRAINING_COMPOSITION_FEEDBACK_REPORT } from './training-composition-feedback-report';

import { TRAINING_ROUTING_CASE_CONTEXT } from './training-routing-case-context';
import { TRAINING_ROLEPLAY_ANSWER } from './training-roleplay-answer';
import { TRAINING_STRUCTURING_COVERAGE_UPDATE } from './training-structuring-coverage-update';
import { TRAINING_VALIDATION_QUESTION_QUALITY } from './training-validation-question-quality';
import { TRAINING_COACHING_NEXT_HINT } from './training-coaching-next-hint';
import { TRAINING_COMPOSITION_FEEDBACK_REPORT } from './training-composition-feedback-report';

export const ALL_TRAINING_SKILLS = [
  TRAINING_ROUTING_CASE_CONTEXT,
  TRAINING_ROLEPLAY_ANSWER,
  TRAINING_STRUCTURING_COVERAGE_UPDATE,
  TRAINING_VALIDATION_QUESTION_QUALITY,
  TRAINING_COACHING_NEXT_HINT,
  TRAINING_COMPOSITION_FEEDBACK_REPORT,
];

// 写权限白名单校验：训练 Skill 只能写以下表
export const TRAINING_ALLOWED_WRITE_TARGETS = new Set([
  'training_questions.disclosure_rule_hit',
  'training_questions.quality_label',
  'training_role_answers',
  'training_feedback',
]);

// 禁止写的表（任何训练 Skill 都不得写）
export const TRAINING_FORBIDDEN_WRITE_TARGETS = new Set([
  'quick_sessions',
  'quick_turns',
  'projects',
  'project_members',
  'project_intakes',
  'requirements',
  'requirement_versions',
  'baselines',
  'baseline_items',
  'formal_map_snapshots',
  'review_actions',
  'changes',
  'change_impacts',
]);

export function isTrainingWriteAllowed(target: string): boolean {
  return TRAINING_ALLOWED_WRITE_TARGETS.has(target) && !TRAINING_FORBIDDEN_WRITE_TARGETS.has(target);
}
