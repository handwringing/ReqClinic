export const QUICK_STATIC_CASE_IDS = [
  'ai-poster-website',
  'campus-marketplace',
  'aigc-education-paper',
  'gym-renewal-service',
  'corporate-website-outsourcing',
  'ai-interview-assistant-capstone',
  'social-anxiety-coach',
] as const;

export const FORMAL_STATIC_CASE_IDS = ['aster', 'outsourcing', 'capstone'] as const;

export const TRAINING_STATIC_CASE_IDS = [
  'trn_case_001',
  'trn_case_002',
  'trn_case_003',
  'trn_case_004',
  'trn_case_005',
  'trn_case_006',
  'trn_case_007',
  'trn_case_008',
] as const;

export const FORMAL_CUSTOM_PROJECT_ID = 'formal-custom-demo';

export function quickStaticSessionId(sourceCaseId: string): string {
  return `quick-sample-${sourceCaseId}`;
}

export function formalStaticProjectId(sourceCaseId: string): string {
  return `formal-sample-${sourceCaseId}`;
}

export function formalQuickUpgradeProjectId(sourceCaseId: string): string {
  return `formal-upgrade-${sourceCaseId}`;
}

export function trainingStaticAttemptId(caseId: string): string {
  return `training-sample-${caseId}`;
}

export function trainingRetryAttemptId(caseId: string): string {
  return `training-retry-${caseId}`;
}

export function staticFormalProjectSourceCase(projectId: string): string | null {
  if (projectId.startsWith('formal-sample-')) {
    return projectId.slice('formal-sample-'.length);
  }
  if (projectId.startsWith('formal-upgrade-')) {
    return projectId.slice('formal-upgrade-'.length);
  }
  return null;
}

export function staticTrainingAttemptCase(attemptId: string): string | null {
  if (attemptId.startsWith('training-sample-')) {
    return attemptId.slice('training-sample-'.length);
  }
  if (attemptId.startsWith('training-retry-')) {
    return attemptId.slice('training-retry-'.length);
  }
  return null;
}
