import { z } from 'zod';

export const FORMAL_SKILL_MANIFESTS = [
  {
    skillId: 'formal.routing.source_context',
    skillVersion: '1.0.0',
    category: 'routing' as const,
    inputSchemaVersion: 'formal_source_context_input.v1',
    outputSchemaVersion: 'formal_source_context_output.v1',
    promptVersion: 'frc-prompt-v1',
  },
  {
    skillId: 'formal.structuring.domain_framing',
    skillVersion: '1.0.0',
    category: 'structuring' as const,
    inputSchemaVersion: 'formal_domain_framing_input.v1',
    outputSchemaVersion: 'formal_domain_framing_output.v1',
    promptVersion: 'fdf-prompt-v1',
  },
  {
    skillId: 'formal.structuring.module_planning',
    skillVersion: '1.0.0',
    category: 'structuring' as const,
    inputSchemaVersion: 'formal_module_planning_input.v1',
    outputSchemaVersion: 'formal_module_planning_output.v1',
    promptVersion: 'fmp-prompt-v1',
  },
  {
    skillId: 'formal.elicitation.module_question',
    skillVersion: '1.0.0',
    category: 'elicitation' as const,
    inputSchemaVersion: 'formal_module_question_input.v1',
    outputSchemaVersion: 'formal_module_question_output.v1',
    promptVersion: 'fmq-prompt-v1',
  },
  {
    skillId: 'formal.decisioning.module_options',
    skillVersion: '1.0.0',
    category: 'decisioning' as const,
    inputSchemaVersion: 'formal_module_options_input.v1',
    outputSchemaVersion: 'formal_module_options_output.v1',
    promptVersion: 'fmo-prompt-v1',
  },
  {
    skillId: 'formal.composition.guidance_report',
    skillVersion: '1.0.0',
    category: 'composition' as const,
    inputSchemaVersion: 'formal_guidance_input.v1',
    outputSchemaVersion: 'formal_guidance_output.v1',
    promptVersion: 'fgr-prompt-v1',
  },
  {
    skillId: 'formal.validation.consistency_review',
    skillVersion: '1.0.0',
    category: 'validation' as const,
    inputSchemaVersion: 'formal_consistency_input.v1',
    outputSchemaVersion: 'formal_consistency_output.v1',
    promptVersion: 'fcr-prompt-v1',
  },
] as const;

export type FormalModuleStatus =
  | '已整理'
  | '正在梳理'
  | '建议确认'
  | '待补充'
  | '有方案可选';

export const formalModuleStatusSchema = z.enum([
  '已整理',
  '正在梳理',
  '建议确认',
  '待补充',
  '有方案可选',
]);

export const formalMapOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  fit: z.string(),
  tradeoff: z.string(),
  recommended: z.boolean().default(false),
});

export const formalMapModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: formalModuleStatusSchema,
  summary: z.string(),
  known: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  options: z.array(formalMapOptionSchema).default([]),
  relatedModuleIds: z.array(z.string()).default([]),
});

export const formalGuidanceStateSchema = z.object({
  status: z.enum(['eliciting', 'review_ready']),
  coveredModuleCount: z.number().int().nonnegative(),
  totalModuleCount: z.number().int().positive(),
  unresolvedCount: z.number().int().nonnegative(),
  reportReady: z.boolean(),
  completionReason: z.string().nullable(),
});

export const formalMapSnapshotSchema = z.object({
  result_type: z.literal('formal_map_snapshot').default('formal_map_snapshot'),
  title: z.string(),
  summary: z.string(),
  projectType: z.string(),
  sourceContext: z.string(),
  currentModuleId: z.string(),
  nextQuestion: z.string().nullable(),
  guidanceState: formalGuidanceStateSchema.default({
    status: 'eliciting',
    coveredModuleCount: 0,
    totalModuleCount: 1,
    unresolvedCount: 1,
    reportReady: false,
    completionReason: null,
  }),
  generationSteps: z.array(
    z.object({
      label: z.string(),
      state: z.enum(['done', 'active', 'pending']),
    }),
  ),
  modules: z.array(formalMapModuleSchema).min(3).max(12),
  unresolvedItems: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string(),
      impact: z.string(),
    }),
  ).default([]),
  reportProjection: z.object({
    overview: z.string(),
    detailedReport: z.string(),
  }),
  qualityNotes: z.array(z.string()).default([]),
}).passthrough();

export type FormalMapSnapshotOutput = z.infer<typeof formalMapSnapshotSchema>;
export type FormalMapModule = z.infer<typeof formalMapModuleSchema>;
