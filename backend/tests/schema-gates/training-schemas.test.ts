import { describe, it, expect } from 'vitest';
import {
  trainingRoleAnswerOutputSchema,
  trainingCoverageUpdateSchema,
  trainingQuestionQualitySchema,
  trainingFeedbackOutputSchema,
} from '../../src/ai/schema-gates/training-schemas';
import { SCHEMA_GATES, validateOutput } from '../../src/ai/schema-gates';

/**
 * Expression-training Schema Gate tests (Task 1.1).
 *
 * Verifies that the four Zod schemas defined in
 * `src/ai/schema-gates/training-schemas.ts` accept well-formed payloads and
 * reject the structural violations enumerated in 08 plan §5.3 / §6.2.
 */

const validRoleAnswerPayload = {
  result_type: 'training_response',
  role_answer: {
    content: '我们这次活动主要面向大一新生。',
    tone: 'customer',
    disclosed_rule_ids: ['rule_target_user'],
    safe_to_show: true,
  },
  coach_projection: {
    next_hint: '试着问一下活动规模预期。',
    question_quality_note: '问题聚焦目标用户，但还可以更具体。',
    visible_progress_label: '已覆盖：目标用户',
  },
};

const validFeedbackPayload = {
  result_type: 'training_feedback',
  score: {
    total: 72,
    max: 100,
    label: '良好',
  },
  dimensions: [
    {
      dimension: 'coverage',
      score: 18,
      max: 25,
      evidence: '用户覆盖了目标用户、规模、时间三个维度。',
      improvement: '建议补充预算相关追问。',
    },
  ],
  missed_high_value_questions: ['活动预算大概多少？'],
  improvement_examples: [
    {
      before: '活动怎么样？',
      after: '活动预期覆盖多少人？预算上限是多少？',
      reason: '原问题过于宽泛，无法形成可执行结论。',
    },
  ],
  summary_review: {
    accuracy: '基本准确，但遗漏了预算约束。',
    missing_points: ['预算约束', '风险预案'],
    unsupported_claims: ['活动一定能办成'],
    improved_summary: '本次活动面向大一新生，预计 200 人，预算待定。',
  },
};

describe('trainingRoleAnswerOutputSchema', () => {
  it('accepts a well-formed training_response payload', () => {
    const parsed = trainingRoleAnswerOutputSchema.safeParse(validRoleAnswerPayload);
    expect(parsed.success).toBe(true);
  });

  it('rejects missing role_answer.content', () => {
    const payload = {
      ...validRoleAnswerPayload,
      role_answer: {
        ...validRoleAnswerPayload.role_answer,
        content: undefined,
      },
    };
    const parsed = trainingRoleAnswerOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('rejects an out-of-enum tone', () => {
    const payload = {
      ...validRoleAnswerPayload,
      role_answer: {
        ...validRoleAnswerPayload.role_answer,
        tone: 'manager',
      },
    };
    const parsed = trainingRoleAnswerOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('rejects safe_to_show !== true', () => {
    const payload = {
      ...validRoleAnswerPayload,
      role_answer: {
        ...validRoleAnswerPayload.role_answer,
        safe_to_show: false,
      },
    };
    const parsed = trainingRoleAnswerOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('allows extra debugging metadata via passthrough', () => {
    const payload = {
      ...validRoleAnswerPayload,
      debug_trace: { latency_ms: 120 },
    };
    const parsed = trainingRoleAnswerOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});

describe('trainingCoverageUpdateSchema', () => {
  const validPayload = {
    hit_dimensions: ['target_user', 'scale'],
    disclosed_rule_ids: ['rule_target_user'],
    coverage_progress_label: '已覆盖 2/5 维度',
  };

  it('accepts a well-formed coverage update', () => {
    const parsed = trainingCoverageUpdateSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
  });

  it('rejects missing hit_dimensions', () => {
    const payload = {
      ...validPayload,
      hit_dimensions: undefined,
    };
    const parsed = trainingCoverageUpdateSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-array disclosed_rule_ids', () => {
    const payload = {
      ...validPayload,
      disclosed_rule_ids: 'rule_target_user',
    };
    const parsed = trainingCoverageUpdateSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});

describe('trainingQuestionQualitySchema', () => {
  const validPayload = {
    quality_label: 'too_broad',
    reason: '问题覆盖范围过大，难以形成可执行结论。',
    suggestion: '请将问题聚焦在预算上限上。',
  };

  it('accepts a well-formed quality verdict', () => {
    const parsed = trainingQuestionQualitySchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
  });

  it('accepts a null suggestion', () => {
    const payload = { ...validPayload, suggestion: null };
    const parsed = trainingQuestionQualitySchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('rejects a quality_label outside the enum', () => {
    const payload = {
      ...validPayload,
      quality_label: 'perfect',
    };
    const parsed = trainingQuestionQualitySchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing reason', () => {
    const payload = {
      ...validPayload,
      reason: undefined,
    };
    const parsed = trainingQuestionQualitySchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});

describe('trainingFeedbackOutputSchema', () => {
  it('accepts a well-formed training_feedback payload', () => {
    const parsed = trainingFeedbackOutputSchema.safeParse(validFeedbackPayload);
    expect(parsed.success).toBe(true);
  });

  it('rejects missing improvement_examples', () => {
    const payload = {
      ...validFeedbackPayload,
      improvement_examples: undefined,
    };
    const parsed = trainingFeedbackOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('rejects improvement_examples entries missing before/after/reason', () => {
    const payload = {
      ...validFeedbackPayload,
      improvement_examples: [
        { before: '活动怎么样？', after: '预计覆盖多少人？' },
      ],
    };
    const parsed = trainingFeedbackOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('rejects a negative score.total', () => {
    const payload = {
      ...validFeedbackPayload,
      score: { ...validFeedbackPayload.score, total: -5 },
    };
    const parsed = trainingFeedbackOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('rejects a wrong result_type', () => {
    const payload = {
      ...validFeedbackPayload,
      result_type: 'training_response',
    };
    const parsed = trainingFeedbackOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('allows extra debugging metadata via passthrough', () => {
    const payload = {
      ...validFeedbackPayload,
      debug: { model: 'stub-v1' },
    };
    const parsed = trainingFeedbackOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});

describe('SCHEMA_GATES registration', () => {
  it('registers the training_response gate', () => {
    expect(SCHEMA_GATES.training_response).toBe(trainingRoleAnswerOutputSchema);
  });

  it('registers the training_feedback gate', () => {
    expect(SCHEMA_GATES.training_feedback).toBe(trainingFeedbackOutputSchema);
  });

  it('validates a training_response payload through validateOutput', () => {
    const gate = validateOutput('training_response', validRoleAnswerPayload);
    expect(gate.ok).toBe(true);
  });

  it('fails a malformed training_response payload through validateOutput', () => {
    const gate = validateOutput('training_response', { result_type: 'wrong' });
    expect(gate.ok).toBe(false);
    expect(gate.error).toBeDefined();
  });

  it('validates a training_feedback payload through validateOutput', () => {
    const gate = validateOutput('training_feedback', validFeedbackPayload);
    expect(gate.ok).toBe(true);
  });
});
