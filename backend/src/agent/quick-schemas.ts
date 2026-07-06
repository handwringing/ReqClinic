import { z } from 'zod';

export const QUICK_SLOT_IDS = [
  'expected_outcome',
  'target_user',
  'core_scenario',
  'scope_boundary',
  'completion_criteria',
  'constraints_risks',
] as const;

export type QuickSlotId = (typeof QUICK_SLOT_IDS)[number];

export const quickSlotIdSchema = z.enum(QUICK_SLOT_IDS);

export const quickSlotStatusSchema = z.enum([
  'confirmed',
  'partial',
  'inferred',
  'missing',
]);

export type QuickSlotStatus = z.infer<typeof quickSlotStatusSchema>;

export const quickSlotValueSchema = z.object({
  value: z.string().nullable(),
  status: quickSlotStatusSchema,
  source: z.enum(['user', 'assistant_inferred', 'system_default']).default('system_default'),
});

export const quickUnderstandingSchema = z.object({
  summary: z.string(),
  slots: z.record(quickSlotIdSchema, quickSlotValueSchema),
});

export type QuickUnderstanding = z.infer<typeof quickUnderstandingSchema>;

export const quickTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export type QuickTurn = z.infer<typeof quickTurnSchema>;

export const quickUnknownSchema = z.object({
  id: z.string(),
  slot: quickSlotIdSchema,
  label: z.string(),
  question: z.string(),
  impact: z.string(),
  priorityScore: z.number().min(0).max(100),
  status: z.enum(['待确认', '系统推测', '尚未提供', '影响较大，建议先确认']),
  isBlocking: z.boolean(),
});

export type QuickUnknown = z.infer<typeof quickUnknownSchema>;

export const quickQualityIssueSchema = z.object({
  dimension: z.enum([
    '完整性',
    '清晰度',
    '一致性',
    '可验证性',
    '范围边界',
    '未知项',
  ]),
  userLabel: z.string(),
  internalCode: z.string(),
  severity: z.enum(['info', 'warning', 'blocking']),
  evidence: z.string().optional(),
  suggestedQuestion: z.string().optional(),
  priorityScore: z.number().min(0).max(100),
});

export type QuickQualityIssue = z.infer<typeof quickQualityIssueSchema>;

export const quickRoutingOutputSchema = z.object({
  mode: z.literal('quick'),
  domainPackId: z.string(),
  candidateDomainPacks: z.array(z.string()),
  riskFlags: z.array(z.string()),
  routingReason: z.string(),
});

export type QuickRoutingOutput = z.infer<typeof quickRoutingOutputSchema>;

export const quickStructuringOutputSchema = z.object({
  understanding: quickUnderstandingSchema,
  changedSlots: z.array(quickSlotIdSchema),
});

export type QuickStructuringOutput = z.infer<typeof quickStructuringOutputSchema>;

export const quickValidationOutputSchema = z.object({
  canEnterReview: z.boolean(),
  nextQuestionSlot: quickSlotIdSchema.nullable(),
  unknowns: z.array(quickUnknownSchema),
  qualityIssues: z.array(quickQualityIssueSchema),
});

export type QuickValidationOutput = z.infer<typeof quickValidationOutputSchema>;

export const quickElicitationOutputSchema = z.object({
  question: z.string().nullable(),
  slot: quickSlotIdSchema.nullable(),
  rationale: z.string(),
});

export type QuickElicitationOutput = z.infer<typeof quickElicitationOutputSchema>;

export const quickDecisioningOutputSchema = z.object({
  options: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      isRecommended: z.boolean(),
    }),
  ),
  recommendation: z.string(),
});

export type QuickDecisioningOutput = z.infer<typeof quickDecisioningOutputSchema>;

export const quickBriefSnapshotSchema = z.object({
  originalInput: z.string(),
  understanding: quickUnderstandingSchema,
  unknowns: z.array(quickUnknownSchema),
  options: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      isRecommended: z.boolean(),
    }),
  ),
  qualityIssues: z.array(quickQualityIssueSchema),
});

export type QuickBriefSnapshot = z.infer<typeof quickBriefSnapshotSchema>;

export const quickCompositionOutputSchema = z.object({
  snapshot: quickBriefSnapshotSchema,
  views: z.object({
    simple: z.string(),
    exec: z.string(),
  }),
});

export type QuickCompositionOutput = z.infer<typeof quickCompositionOutputSchema>;

export const quickRuntimeOutputSchema = z.object({
  routing: quickRoutingOutputSchema,
  structuring: quickStructuringOutputSchema,
  validation: quickValidationOutputSchema,
  elicitation: quickElicitationOutputSchema,
  decisioning: quickDecisioningOutputSchema,
  composition: quickCompositionOutputSchema,
});

export type QuickRuntimeOutput = z.infer<typeof quickRuntimeOutputSchema>;
