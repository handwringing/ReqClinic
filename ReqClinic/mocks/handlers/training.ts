import type { MockRouteRegistry } from '../registry';
import type { MockSessionStore } from '../session-store';
import type {
  UUID,
  TrainingCase,
  TrainingAttempt,
  TrainingFeedback,
  PaginatedResponse,
} from '@/lib/api/types';
import { generateUUID } from '@/lib/utils/id';
import { ApiClientError } from '@/lib/api/errors';
import { trainingFixture } from './_fixtures';

// 表达训练 Mock：案例列表、尝试、提问/总结（异步）、反馈、重试、完成。

const DEFAULT_CASES: TrainingCase[] = [
  {
    id: '00000000-0000-4000-8000-000000000301',
    title: '与销售总监澄清“提升转化率”的真实目标',
    category: '目标澄清',
    difficulty: 'medium',
    version: '2026.07.01',
    description: '练习通过追问区分业务目标与解决方案设想。',
  },
  {
    id: '00000000-0000-4000-8000-000000000302',
    title: '识别“访客通行”场景中的隐性利益相关方',
    category: '利益相关方识别',
    difficulty: 'hard',
    version: '2026.07.01',
    description: '练习挖掘被忽略的二级利益相关方及其关注点。',
  },
  {
    id: '00000000-0000-4000-8000-000000000303',
    title: '把“系统要快”转写为可度量的需求',
    category: '需求工程化',
    difficulty: 'easy',
    version: '2026.07.01',
    description: '练习将模糊诉求转化为可验收的工程化需求。',
  },
];

function cases(): TrainingCase[] {
  const fx = trainingFixture();
  const fxCases: any[] = fx?.cases ?? [];
  return fxCases.length > 0
    ? fxCases.map(
        (c: any): TrainingCase => ({
          id: c.id ?? generateUUID(),
          title: c.title ?? '训练案例',
          category: c.category ?? '通用',
          difficulty: c.difficulty ?? 'medium',
          version: c.version ?? '2026.07.01',
          description: c.description ?? '',
        })
      )
    : DEFAULT_CASES;
}

function getAttempts(store: MockSessionStore): Record<string, TrainingAttempt> {
  return store.get<Record<string, TrainingAttempt>>('training_attempts') ?? {};
}
function setAttempts(store: MockSessionStore, attempts: Record<string, TrainingAttempt>): void {
  store.set('training_attempts', attempts);
}

function accepted() {
  return { job_id: generateUUID(), status: 'accepted' as const };
}

export function registerTrainingHandlers(registry: MockRouteRegistry, store: MockSessionStore): void {
  registry.register(
    'listTrainingCases',
    async (request: { category?: string; difficulty?: 'easy' | 'medium' | 'hard'; limit?: number; offset?: number }) => {
      let items = cases();
      if (request.category) items = items.filter((c) => c.category === request.category);
      if (request.difficulty) items = items.filter((c) => c.difficulty === request.difficulty);
      const limit = request.limit ?? 20;
      const offset = request.offset ?? 0;
      const paged = items.slice(offset, offset + limit);
      return { items: paged, total: items.length, limit, offset } as PaginatedResponse<TrainingCase>;
    }
  );

  // 任务规约中的 getTrainingCaseVersion：按 id + version 返回案例版本详情。
  registry.register('getTrainingCaseVersion', async (request: { id: UUID; version?: string }) => {
    const found = cases().find((c) => c.id === request.id);
    if (!found) {
      throw new ApiClientError(404, 'NOT_FOUND', '训练案例不存在', generateUUID());
    }
    return {
      case_id: found.id,
      case_version: found.version,
      title: found.title,
      category: found.category,
      difficulty: found.difficulty,
      description: found.description,
      role_label: '需求分析师',
      practice_goal: '通过追问澄清目标、角色、场景、边界与验收口径',
      visible_constraints: ['不直接给出答案', '只在被问到时披露隐藏信息'],
      evaluation_dimensions_public: ['目标澄清', '利益相关方覆盖', '需求工程化'],
      status: 'active' as const,
    };
  });

  registry.register('createTrainingAttempt', async (request: {
    case_id: UUID;
    case_version: string;
    difficulty?: 'easy' | 'medium' | 'hard' | null;
    source_kind?: TrainingAttempt['source_kind'];
  }) => {
    const attempt: TrainingAttempt = {
      attempt_id: generateUUID(),
      case_id: request.case_id,
      case_version: request.case_version,
      source_kind: request.source_kind ?? 'sample',
      status: 'interviewing',
      question_count: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
    };
    const attempts = getAttempts(store);
    attempts[attempt.attempt_id] = attempt;
    setAttempts(store, attempts);
    return attempt;
  });

  registry.register('getTrainingAttempt', async (request: { id: UUID }) => {
    const attempts = getAttempts(store);
    const attempt = attempts[request.id];
    if (!attempt) {
      throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', generateUUID());
    }
    return attempt;
  });

  registry.register('postTrainingQuestion', async () => accepted());

  registry.register('postTrainingSummary', async (request: { attempt_id: UUID; summary: string }) => {
    const attempts = getAttempts(store);
    const attempt = attempts[request.attempt_id];
    if (attempt) {
      attempt.status = 'feedback_ready';
      attempts[request.attempt_id] = attempt;
      setAttempts(store, attempts);
    }
    return accepted();
  });

  registry.register('getTrainingFeedback', async (request: { attempt_id: UUID }) => {
    const attempts = getAttempts(store);
    if (!attempts[request.attempt_id]) {
      throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', generateUUID());
    }
    const feedback: TrainingFeedback = {
      coverage_score: 0.72,
      missing_dimensions: ['约束与风险', '验证'],
      improvement_suggestions: [
        '应追问时间限制和资源约束',
        '可提出可观察的完成条件',
      ],
      dimension_breakdown: [
        {
          dimension: '目标澄清',
          status: 'covered',
          evidence: '已追问目标用户和使用场景',
          comment: '覆盖充分',
        },
        {
          dimension: '利益相关方覆盖',
          status: 'partial',
          evidence: '讨论集中于访客与被访者',
          comment: '未提及前台安保人员',
        },
        {
          dimension: '需求工程化',
          status: 'missing',
          evidence: '未给出可验收的工程化口径',
          comment: '验收标准缺少时间约束',
        },
      ],
      improvement_examples: [
        {
          before: '你想做哪些功能？',
          after: '在时间、预算或平台限制下，哪些功能必须第一版完成？',
          reason: '把开放追问改成带约束的范围澄清',
        },
        {
          before: '系统要快。',
          after: '高峰期 95% 请求在 500ms 内返回。',
          reason: '把模糊诉求改成可观察的完成标准',
        },
      ],
    };
    return feedback;
  });

  registry.register('retryTrainingAttempt', async (request: { attempt_id: UUID }) => {
    const attempts = getAttempts(store);
    const prior = attempts[request.attempt_id];
    if (!prior) {
      throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', generateUUID());
    }
    const attempt: TrainingAttempt = {
      attempt_id: generateUUID(),
      case_id: prior.case_id,
      case_version: prior.case_version,
      source_kind: prior.source_kind ?? 'sample',
      status: 'interviewing',
      question_count: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
    };
    attempts[attempt.attempt_id] = attempt;
    setAttempts(store, attempts);
    return attempt;
  });

  registry.register('completeTrainingAttempt', async (request: { attempt_id: UUID }) => {
    const attempts = getAttempts(store);
    const attempt = attempts[request.attempt_id];
    if (!attempt) {
      throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', generateUUID());
    }
    attempt.status = 'completed';
    attempt.completed_at = new Date().toISOString();
    attempts[request.attempt_id] = attempt;
    setAttempts(store, attempts);
    return attempt;
  });
}
