import type { ApiTransport } from './transport';
import { ApiClientError } from './errors';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RouteSpec {
  method: HttpMethod;
  path: (request: any) => string;
  body?: (request: any) => unknown;
  query?: (request: any) => Record<string, string | number | boolean | undefined>;
  gated?: boolean;
  demo?: boolean;
}

const DEFAULT_BASE_URL = 'http://localhost:4000/api/v1';
const GUEST_SESSION_READY_KEY = 'reqclinic_guest_session_ready';

export class HttpTransport implements ApiTransport {
  private readonly baseUrl: string;
  private readyPromise: Promise<void> | null = null;

  constructor(baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request<TReq = unknown, TRes = unknown>(
    operationId: string,
    request?: TReq,
    options?: { idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<TRes> {
    const spec = routeFor(operationId);
    if (spec.demo) {
      return handleDemoOperation(operationId, request) as TRes;
    }
    if (spec.gated) {
      await this.ensureReady(options?.signal);
    }

    const response = await this.fetchJson(spec, request, options);
    return normalizeResponse(operationId, response.data, response.meta, request) as TRes;
  }

  private async ensureReady(signal?: AbortSignal): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.prepareGuestAndConsent(signal).catch((err) => {
        this.readyPromise = null;
        throw err;
      });
    }
    await this.readyPromise;
  }

  private async prepareGuestAndConsent(signal?: AbortSignal): Promise<void> {
    if (!hasGuestSessionReadyMarker()) {
      await this.rawFetch(
        'createGuestSession',
        { method: 'POST', path: () => '/guest-sessions', body: () => ({}) },
        undefined,
        { signal },
      );
      markGuestSessionReady();
    } else {
      try {
        await this.rawFetch('getCurrentGuestSession', { method: 'GET', path: () => '/guest-sessions/current' }, undefined, { signal });
      } catch {
        await this.rawFetch(
          'createGuestSession',
          { method: 'POST', path: () => '/guest-sessions', body: () => ({}) },
          undefined,
          { signal },
        );
      }
      markGuestSessionReady();
    }
    const agreement = await this.rawFetch('getActiveAgreement', { method: 'GET', path: () => '/agreements/active' }, undefined, { signal });
    const agreementId = (agreement.data as any)?.id;
    if (agreementId) {
      await this.rawFetch(
        'acceptAgreement',
        {
          method: 'POST',
          path: () => `/agreements/${encodeURIComponent(agreementId)}/accept`,
          body: () => ({ scope: 'all' }),
        },
        undefined,
        { idempotencyKey: stableKey(`accept:${agreementId}`), signal },
      );
    }
  }

  private async fetchJson<TReq>(
    spec: RouteSpec,
    request?: TReq,
    options?: { idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<{ data: unknown; meta: Record<string, unknown> }> {
    return this.rawFetch('', spec, request, options);
  }

  private async rawFetch<TReq>(
    operationId: string,
    spec: RouteSpec,
    request?: TReq,
    options?: { idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<{ data: unknown; meta: Record<string, unknown> }> {
    const query = spec.query?.(request) ?? {};
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        qs.set(key, String(value));
      }
    }
    const url = `${this.baseUrl}${spec.path(request)}${qs.size ? `?${qs}` : ''}`;
    const headers: Record<string, string> = {};
    const bodyValue = spec.body ? spec.body(request) : request;
    const hasBody = spec.method !== 'GET' && spec.method !== 'DELETE' && bodyValue !== undefined;
    if (hasBody) headers['content-type'] = 'application/json';
    if (options?.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    const res = await fetch(url, {
      method: spec.method,
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: hasBody ? JSON.stringify(bodyValue) : undefined,
      signal: options?.signal,
    });

    if (res.status === 204) return { data: undefined, meta: {} };
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = json?.error ?? {};
      throw new ApiClientError(
        res.status,
        err.code ?? 'HTTP_ERROR',
        err.message ?? `${operationId || 'request'} failed`,
        err.request_id ?? '',
        err.details,
      );
    }
    return {
      data: json?.data ?? json,
      meta: json?.meta ?? {},
    };
  }
}

function hasGuestSessionReadyMarker(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(GUEST_SESSION_READY_KEY) === '1';
  } catch {
    return true;
  }
}

function markGuestSessionReady(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_SESSION_READY_KEY, '1');
  } catch {
    // Non-sensitive marker only; failing to store it should not block the app.
  }
}

export function createHttpTransport(): HttpTransport {
  return new HttpTransport();
}

function routeFor(operationId: string): RouteSpec {
  const routes: Record<string, RouteSpec> = {
    createGuestSession: { method: 'POST', path: () => '/guest-sessions', body: () => ({}) },
    getCurrentGuestSession: { method: 'GET', path: () => '/guest-sessions/current' },
    getActiveAgreement: { method: 'GET', path: () => '/agreements/active' },
    acceptAgreement: {
      method: 'POST',
      path: (r) => `/agreements/${encodeURIComponent(r.agreement_id)}/accept`,
      body: (r) => ({ scope: r.scope ?? 'all' }),
    },

    createQuickSession: {
      method: 'POST',
      path: () => '/quick-sessions',
      body: (r) => ({
        original_input: r.original_input,
        source_kind: r.source_kind ?? 'custom',
        source_case_id: r.source_case_id ?? null,
      }),
      gated: true,
    },
    getQuickSession: { method: 'GET', path: (r) => `/quick-sessions/${encodeURIComponent(r.id)}` },
    listQuickSessionMessages: {
      method: 'GET',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.id)}/messages`,
      query: (r) => ({ limit: r.limit, cursor: r.cursor }),
    },
    postQuickSessionMessage: {
      method: 'POST',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/messages`,
      body: (r) => ({
        action: 'answer',
        content: r.content,
        question_id: r.question_id ?? null,
        bound_refs: r.bound_refs ?? [],
      }),
      gated: true,
    },
    getQuickSessionCoverage: { method: 'GET', path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/coverage` },
    getQuickSessionUnderstanding: { method: 'GET', path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/understanding` },
    listQuickSessionUnknowns: { method: 'GET', path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/unknowns` },
    reviewQuickSessionUnderstanding: {
      method: 'POST',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/understanding-review`,
      body: (r) => ({ action: r.action === 'accept' ? 'correct' : r.action }),
      gated: true,
    },
    recordQuickSessionOptionPreference: {
      method: 'POST',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/option-preferences`,
      body: (r) => ({
        option_id: r.option_id,
        matches_ai_recommendation: r.matches_ai_recommendation ?? r.is_preferred ?? false,
      }),
      gated: true,
    },
    listQuickSessionBriefVersions: { method: 'GET', path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/briefs` },
    generateQuickSessionBrief: {
      method: 'POST',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/briefs`,
      body: () => ({ accept_incomplete: true }),
      gated: true,
    },
    getQuickSessionBriefVersion: {
      method: 'GET',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/briefs/${encodeURIComponent(r.version)}`,
    },
    getBriefView: {
      method: 'GET',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/briefs/${encodeURIComponent(r.brief_version)}/views/${encodeURIComponent(r.view_type)}`,
    },
    exportQuickSessionBrief: {
      method: 'POST',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/briefs/${encodeURIComponent(r.brief_version)}/exports`,
      body: (r) => ({ view_type: 'exec', export_type: r.formats?.[0] ?? 'download' }),
    },
    downloadQuickSessionBrief: {
      method: 'GET',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id ?? '')}/briefs/${encodeURIComponent(r.brief_version ?? 1)}/download`,
      query: (r) => ({ export_id: r.export_id, view_type: r.format ?? 'exec' }),
    },
    abandonQuickSession: { method: 'POST', path: (r) => `/quick-sessions/${encodeURIComponent(r.id)}/abandon`, body: () => ({}) },
    archiveQuickSession: { method: 'POST', path: (r) => `/quick-sessions/${encodeURIComponent(r.id)}/archive`, body: () => ({}) },
    upgradeQuickSession: {
      method: 'POST',
      path: (r) => `/quick-sessions/${encodeURIComponent(r.session_id)}/upgrade`,
      body: (r) => ({
        ...(typeof r.brief_version === 'number' ? { brief_version: r.brief_version } : {}),
        ...(typeof r.expected_quick_session_version === 'number'
          ? { expected_quick_session_version: r.expected_quick_session_version }
          : {}),
        source_kind: r.source_kind ?? 'quick_upgrade',
        source_case_id: r.source_case_id ?? null,
      }),
      gated: true,
    },

    createProject: {
      method: 'POST',
      path: () => '/projects',
      body: (r) => ({
        initial_request: r.initial_request,
        name: r.title ?? r.name ?? null,
        description: r.description ?? r.initial_request ?? null,
        decision_intent: r.decision_intent ?? null,
        selected_work_type: r.selected_work_type ?? null,
        candidate_roles: r.candidate_roles ?? [],
        candidate_constraints: r.candidate_constraints ?? [],
        source_kind: r.source_kind ?? 'custom',
        source_case_id: r.source_case_id ?? null,
      }),
      gated: true,
    },
    createIntake: { method: 'POST', path: () => '', demo: true },
    getProject: { method: 'GET', path: (r) => `/projects/${encodeURIComponent(r.id)}`, gated: true },
    getFormalMapSnapshot: { method: 'GET', path: (r) => `/projects/${encodeURIComponent(r.project_id)}/formal-map`, gated: true },
    postFormalProjectMessage: {
      method: 'POST',
      path: (r) => `/projects/${encodeURIComponent(r.project_id)}/formal-messages`,
      body: (r) => ({
        content: r.content,
        bound_refs: r.bound_refs ?? [],
      }),
      gated: true,
    },
    listMembers: { method: 'GET', path: () => '', demo: true },
    addMember: { method: 'POST', path: () => '', demo: true },
    listSources: { method: 'GET', path: () => '', demo: true },
    listConflicts: { method: 'GET', path: () => '', demo: true },

    listTrainingCases: {
      method: 'GET',
      path: () => '/training-cases',
      query: (r) => ({
        limit: r?.limit,
        cursor: r?.cursor,
        category: r?.category,
        difficulty: r?.difficulty,
      }),
      gated: true,
    },
    getTrainingCaseVersion: {
      method: 'GET',
      path: (r) => `/training-cases/${encodeURIComponent(r.id)}/versions/${encodeURIComponent(r.version)}`,
      gated: true,
    },
    createTrainingAttempt: {
      method: 'POST',
      path: () => '/training-attempts',
      body: (r) => ({
        case_id: r.case_id,
        case_version: r.case_version,
        difficulty: r.difficulty ?? null,
        source_kind: r.source_kind ?? 'sample',
      }),
      gated: true,
    },
    getTrainingAttempt: {
      method: 'GET',
      path: (r) => `/training-attempts/${encodeURIComponent(r.attempt_id ?? r.id)}`,
      gated: true,
    },
    postTrainingQuestion: {
      method: 'POST',
      path: (r) => `/training-attempts/${encodeURIComponent(r.attempt_id)}/questions`,
      body: (r) => ({ question: r.question }),
      gated: true,
    },
    postTrainingSummary: {
      method: 'POST',
      path: (r) => `/training-attempts/${encodeURIComponent(r.attempt_id)}/summary`,
      body: (r) => ({ summary: r.summary }),
      gated: true,
    },
    getTrainingFeedback: {
      method: 'GET',
      path: (r) => `/training-attempts/${encodeURIComponent(r.attempt_id ?? r.id)}/feedback`,
      gated: true,
    },
    retryTrainingAttempt: {
      method: 'POST',
      path: (r) => `/training-attempts/${encodeURIComponent(r.attempt_id ?? r.id)}/retry`,
      body: () => ({}),
      gated: true,
    },
    completeTrainingAttempt: {
      method: 'POST',
      path: (r) => `/training-attempts/${encodeURIComponent(r.attempt_id ?? r.id)}/complete`,
      body: () => ({}),
      gated: true,
    },

    getJobStatus: { method: 'GET', path: (r) => `/ai-jobs/${encodeURIComponent(r.job_id)}` },
    cancelJob: { method: 'POST', path: (r) => `/ai-jobs/${encodeURIComponent(r.job_id)}/cancel`, body: () => ({ reason: 'cancelled' }) },
  };
  const route = routes[operationId];
  if (!route) throw new Error(`Http handler not registered for operation: ${operationId}`);
  return route;
}

function normalizeResponse(operationId: string, data: any, meta: Record<string, unknown>, request: any): unknown {
  switch (operationId) {
    case 'createQuickSession':
      return { ...normalizeQuickSession(data), active_job_id: meta.active_job_id ?? data?.active_job_id };
    case 'getQuickSession':
      return normalizeQuickSession(data);
    case 'listQuickSessionMessages':
      return {
        items: (data?.items ?? []).map(normalizeTurn),
        total: data?.items?.length ?? 0,
        limit: request?.limit ?? data?.items?.length ?? 0,
        offset: request?.offset ?? 0,
        current_question: data?.current_question ?? null,
      };
    case 'getQuickSessionCoverage':
      return normalizeCoverage(data?.slots ?? data ?? []);
    case 'getQuickSessionUnderstanding':
      return {
        session_id: data?.session_id ?? request?.session_id,
        version: data?.version ?? data?.understanding_version ?? 0,
        summary: data?.summary ?? '',
        slots: data?.slots ?? {},
        coverage_slots: normalizeCoverage(data?.coverage_slots ?? []),
      };
    case 'listQuickSessionUnknowns':
      return (data?.items ?? data ?? []).map((item: any) => ({
        id: item.id,
        session_id: request?.session_id,
        question: item.question,
        is_blocking: item.is_blocking,
        impact: item.impact ?? '',
        suggested_owner: item.suggested_responsible ?? item.suggested_owner,
      }));
    case 'postQuickSessionMessage':
    case 'reviewQuickSessionUnderstanding':
    case 'recordQuickSessionOptionPreference':
    case 'generateQuickSessionBrief':
      return { job_id: data?.job_id, status: 'accepted' };
    case 'listQuickSessionBriefVersions':
      return (data ?? []).map(normalizeBriefVersionSummary);
    case 'getQuickSessionBriefVersion':
      return normalizeBriefVersion(data, request?.session_id);
    case 'getBriefView':
      return {
        view_type: data?.view_type,
        brief_version: data?.brief_version,
        content: data?.rendered_content ?? data?.content ?? '',
      };
    case 'exportQuickSessionBrief':
      return { export_id: data?.export_id, expires_at: data?.expires_at, formats: ['markdown'] };
    case 'downloadQuickSessionBrief':
      return data?.content ?? data ?? '';
    case 'createProject':
      return {
        job_id: data?.job_id,
        project_id: data?.project_id,
        status: data?.status === 'queued' ? 'accepted' : data?.status ?? 'accepted',
        status_url: data?.status_url,
      };
    case 'getProject':
      return normalizeProject(data);
    case 'getFormalMapSnapshot':
      return normalizeFormalMap(data, request);
    case 'postFormalProjectMessage':
      return { job_id: data?.job_id, status: 'accepted' };
    case 'getJobStatus':
    case 'cancelJob':
      return normalizeJob(data);
    case 'listTrainingCases': {
      const items = Array.isArray(data) ? data : (data?.items ?? []);
      return {
        items: items.map(normalizeTrainingCase),
        total: items.length,
        limit: request?.limit ?? 50,
        offset: request?.offset ?? 0,
        next_cursor: data?.next_cursor ?? data?.cursor ?? null,
        has_more: Boolean(data?.next_cursor ?? data?.has_more),
      };
    }
    case 'getTrainingCaseVersion':
      return normalizeTrainingCaseVersion(data);
    case 'createTrainingAttempt':
    case 'getTrainingAttempt':
    case 'retryTrainingAttempt':
    case 'completeTrainingAttempt':
      return normalizeTrainingAttempt(data);
    case 'postTrainingQuestion':
    case 'postTrainingSummary':
      return { job_id: data?.job_id, status: data?.status ?? 'accepted', status_url: data?.status_url };
    case 'getTrainingFeedback':
      return normalizeTrainingFeedback(data);
    default:
      return data;
  }
}

function normalizeTrainingCase(item: any): Record<string, unknown> {
  const difficultyLevels = Array.isArray(item?.difficulty_levels) ? item.difficulty_levels : [];
  return {
    id: item?.id,
    title: item?.title ?? item?.name ?? '',
    category: item?.category ?? 'general',
    difficulty: difficultyLevels[0] ?? 'easy',
    version: item?.version ?? item?.latest_version ?? '1',
    description: item?.description ?? '',
  };
}

function normalizeTrainingCaseVersion(data: any): Record<string, unknown> {
  const publicBrief = data?.public_brief ?? {};
  return {
    case_id: data?.case_id ?? data?.id,
    case_version: data?.case_version ?? data?.version,
    title: data?.title ?? data?.name ?? '',
    category: data?.category ?? 'general',
    difficulty: data?.difficulty ?? 'easy',
    description: publicBrief.description ?? data?.description ?? '',
    role_label: publicBrief.role_label ?? '',
    practice_goal: publicBrief.practice_goal ?? '',
    visible_constraints: Array.isArray(publicBrief.visible_constraints) ? publicBrief.visible_constraints : [],
    evaluation_dimensions_public: Array.isArray(data?.evaluation_dimensions) ? data.evaluation_dimensions : [],
    status: data?.status ?? 'active',
  };
}

function normalizeTrainingAttempt(data: any): Record<string, unknown> {
  return {
    attempt_id: data?.attempt_id ?? data?.id,
    case_id: data?.case_id,
    case_version: data?.case_version,
    source_kind: data?.source_kind ?? (
      data?.case_version === 'demo' || String(data?.case_id ?? '').startsWith('demo-training')
        ? 'sample'
        : undefined
    ),
    status: data?.status ?? 'not_started',
    question_count: data?.question_count ?? 0,
    started_at: data?.started_at,
    completed_at: data?.completed_at ?? null,
    messages: Array.isArray(data?.messages) ? data.messages : [],
    coach_projection: data?.coach_projection ?? null,
  };
}

function normalizeTrainingFeedback(data: any): Record<string, unknown> {
  return {
    coverage_score: data?.coverage_score ?? 0,
    missing_dimensions: Array.isArray(data?.missing_dimensions) ? data.missing_dimensions : [],
    improvement_suggestions: Array.isArray(data?.improvement_suggestions) ? data.improvement_suggestions : [],
    dimension_breakdown: Array.isArray(data?.dimension_breakdown) ? data.dimension_breakdown : [],
    improvement_examples: Array.isArray(data?.improvement_examples) ? data.improvement_examples : [],
  };
}

function normalizeProject(data: any): Record<string, unknown> {
  return {
    id: data?.id,
    title: data?.title ?? data?.name ?? '正式项目',
    description: data?.description ?? null,
    status: normalizeProjectStatus(data?.status),
    source_kind: data?.source_kind,
    source_case_id: data?.source_case_id ?? null,
    version: data?.version ?? 1,
    created_by: data?.created_by ?? data?.owner_id ?? '',
    created_at: data?.created_at,
    updated_at: data?.updated_at,
  };
}

function normalizeProjectStatus(value: unknown): string {
  const text = String(value ?? 'draft');
  const map: Record<string, string> = {
    Draft: 'draft',
    Ingesting: 'ingesting',
    Eliciting: 'eliciting',
    Reviewing: 'reviewing',
    Baselined: 'baselined',
    Reporting: 'reporting',
    Released: 'released',
    Changing: 'changing',
    Archived: 'archived',
  };
  return map[text] ?? text.toLowerCase();
}

function normalizeFormalMap(data: any, request: any): Record<string, unknown> {
  return {
    project_id: data?.project_id ?? request?.project_id,
    active_job_id: data?.active_job_id ?? null,
    snapshot: data?.snapshot ?? null,
    messages: Array.isArray(data?.messages) ? data.messages : [],
  };
}

function normalizeQuickSession(data: any): Record<string, unknown> {
  return {
    id: data?.id,
    version: data?.version ?? 1,
    status: data?.status,
    source_kind: data?.source_kind,
    source_case_id: data?.source_case_id ?? undefined,
    original_input: data?.original_input,
    quick_options: Array.isArray(data?.quick_options)
      ? data.quick_options.map(normalizeQuickOption)
      : [],
    recommendation: data?.recommendation ?? null,
    current_understanding_version: data?.current_understanding_version ?? data?.understanding_version ?? 0,
    brief_version: data?.current_brief_version ?? data?.brief_version ?? 0,
    created_at: data?.created_at,
    updated_at: data?.updated_at,
    active_job_id: data?.active_job_id,
  };
}

function normalizeQuickOption(option: any): Record<string, unknown> {
  return {
    id: option?.id,
    title: option?.title ?? '',
    description: option?.description ?? '',
    pros: Array.isArray(option?.pros) ? option.pros.map(String) : [],
    cons: Array.isArray(option?.cons) ? option.cons.map(String) : [],
    is_recommended: option?.is_recommended === true || option?.isRecommended === true,
  };
}

function normalizeTurn(turn: any): Record<string, unknown> {
  return {
    id: turn.id,
    session_id: turn.session_id,
    role: turn.role === 'ai' ? 'assistant' : turn.role,
    content: turn.content,
    structured_content: turn.structured_content,
    source_refs: turn.source_refs,
    update_marks: turn.update_marks,
    follow_ups: turn.follow_ups,
    referenced_card_ids: turn.referenced_card_ids,
    created_at: turn.created_at,
  };
}

function normalizeCoverage(slots: any[]): unknown[] {
  return slots.map((slot) => ({
    name: slot.name ?? slot.slot_id,
    label: slot.label ?? slotLabel(slot.name ?? slot.slot_id),
    state: slot.state ?? slot.status ?? 'not_started',
    is_blocking: slot.is_blocking ?? ['expected_outcome', 'completion_criteria'].includes(slot.name ?? slot.slot_id),
  }));
}

function normalizeBriefVersionSummary(item: any): Record<string, unknown> {
  return {
    version: item.version ?? item.brief_version,
    session_id: item.session_id,
    generated_at: item.generated_at,
    is_incomplete: item.is_incomplete,
    blocking_unknowns_count: item.blocking_unknowns_count ?? item.blocking_unknown_count ?? 0,
    non_blocking_unknowns_count: item.non_blocking_unknowns_count ?? 0,
  };
}

function normalizeBriefVersion(item: any, sessionId?: string): Record<string, unknown> {
  return {
    version: item.version ?? item.brief_version,
    session_id: item.session_id ?? sessionId,
    generated_at: item.generated_at,
    is_incomplete: item.is_incomplete,
    blocking_unknowns_count: item.blocking_unknowns_count ?? item.blocking_unknown_count ?? 0,
    non_blocking_unknowns_count: item.non_blocking_unknowns_count ?? 0,
    snapshot: item.snapshot,
  };
}

function normalizeJob(data: any): Record<string, unknown> {
  return {
    id: data?.id ?? data?.job_id,
    status: data?.status,
    result_type: data?.result?.result_type ?? data?.task,
    progress: data?.progress ?? 0,
    current_step: data?.current_step,
    error: data?.last_error_code ? { code: data.last_error_code, message: data.last_error_code } : undefined,
    result: data?.result,
    created_at: data?.created_at,
    updated_at: data?.updated_at,
  };
}

function slotLabel(slot: string): string {
  const labels: Record<string, string> = {
    expected_outcome: '期望结果',
    target_user: '目标用户',
    core_scenario: '核心场景',
    scope_boundary: '范围说明',
    completion_criteria: '完成标准',
    constraints_risks: '风险与限制',
  };
  return labels[slot] ?? slot;
}

function stableKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0;
  }
  return `idem_${Math.abs(hash)}`;
}

type DemoTrainingAttemptStatus = 'not_started' | 'interviewing' | 'summarizing' | 'feedback_ready' | 'completed' | 'retrying';

interface DemoProject {
  id: string;
  title: string;
  status: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  description?: string | null;
  source_kind?: 'custom' | 'sample' | 'quick_upgrade';
  source_case_id?: string | null;
}

interface DemoMember {
  id: string;
  project_id: string;
  user_id: string;
  display_name: string;
  role: string;
  initials: string;
}

interface DemoTrainingCase {
  id: string;
  title: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  version: string;
  description: string;
}

interface DemoTrainingAttempt {
  attempt_id: string;
  case_id: string;
  case_version: string;
  status: DemoTrainingAttemptStatus;
  question_count: number;
  started_at: string;
  completed_at?: string | null;
  source_kind?: 'custom' | 'sample';
}

interface DemoTrainingFeedbackDimensionBreakdown {
  dimension: string;
  status: 'covered' | 'partial' | 'missing';
  evidence: string;
  comment: string;
}

interface DemoTrainingFeedbackImprovementExample {
  before: string;
  after: string;
  reason: string;
}

interface DemoTrainingFeedback {
  coverage_score: number;
  missing_dimensions: string[];
  improvement_suggestions: string[];
  dimension_breakdown: DemoTrainingFeedbackDimensionBreakdown[];
  improvement_examples: DemoTrainingFeedbackImprovementExample[];
}

interface DemoStore {
  projects: Record<string, DemoProject>;
  members: Record<string, DemoMember[]>;
  sources: Record<string, unknown[]>;
  conflicts: Record<string, unknown[]>;
  trainingAttempts: Record<string, DemoTrainingAttempt>;
  trainingFeedback: Record<string, DemoTrainingFeedback>;
}

const DEMO_STORE_KEY = 'reqclinic:http-demo-store.v1';
const DEMO_USER_ID = 'demo-user';

const DEMO_TRAINING_CASES: DemoTrainingCase[] = [
  {
    id: 'demo-training-outsourcing',
    title: '把企业官网外包说成可验收的交付范围',
    category: '外包采购',
    difficulty: 'medium',
    version: 'demo',
    description: '客户想找外包团队重做官网，但担心范围、交付物、验收和变更费用说不清。',
  },
  {
    id: 'demo-training-service',
    title: '追问健身房会员续费流程的关键卡点',
    category: '服务流程',
    difficulty: 'easy',
    version: 'demo',
    description: '店长说续费率下降，希望你通过追问找出目标指标、触点、角色分工和第一版改造范围。',
  },
  {
    id: 'demo-training-academic',
    title: '把生成式智能教育影响论文收窄成研究问题',
    category: '学术任务',
    difficulty: 'medium',
    version: 'demo',
    description: '学生想写生成式智能对教育的影响，但主题过宽，需要追问任务要求、研究问题和证据范围。',
  },
  {
    id: 'demo-training-collab',
    title: '梳理多人毕业设计的分工与验收标准',
    category: '协作项目',
    difficulty: 'hard',
    version: 'demo',
    description: '三人小组要做智能面试助手，范围、分工、数据边界和答辩验收都还没有完全说清楚。',
  },
];

function handleDemoOperation(operationId: string, request: any): unknown {
  const store = readDemoStore();
  switch (operationId) {
    case 'createProject': {
      const now = new Date().toISOString();
      const projectId = demoId('demo_project');
      const project: DemoProject = {
        id: projectId,
        title: request?.title?.trim() || '正式项目',
        status: 'draft',
        version: 1,
        created_by: DEMO_USER_ID,
        created_at: now,
        updated_at: now,
        description: request?.description ?? null,
        source_kind: request?.source_kind ?? 'custom',
        source_case_id: request?.source_case_id ?? null,
      };
      store.projects[projectId] = project;
      store.members[projectId] = [
        {
          id: demoId('demo_member'),
          project_id: projectId,
          user_id: DEMO_USER_ID,
          display_name: '项目负责人',
          role: 'owner',
          initials: '项',
        },
      ];
      store.sources[projectId] = [];
      store.conflicts[projectId] = [];
      writeDemoStore(store);
      return { job_id: projectId, project_id: projectId, status: 'accepted' };
    }
    case 'createIntake': {
      const project = store.projects[request?.project_id];
      if (project) {
        project.updated_at = new Date().toISOString();
        writeDemoStore(store);
      }
      return { job_id: request?.project_id ?? demoId('demo_job'), status: 'accepted' };
    }
    case 'getProject': {
      const project = store.projects[request?.id];
      if (!project) {
        throw new ApiClientError(404, 'NOT_FOUND', '项目不存在', demoId('demo_request'));
      }
      return project;
    }
    case 'listMembers':
      return store.members[request?.project_id] ?? [];
    case 'addMember': {
      const member: DemoMember = {
        id: demoId('demo_member'),
        project_id: request?.project_id,
        user_id: request?.user_id ?? demoId('demo_user'),
        display_name: request?.display_name ?? '项目成员',
        role: request?.role ?? 'observer',
        initials: initials(request?.display_name ?? '项目成员'),
      };
      const list = store.members[request?.project_id] ?? [];
      store.members[request?.project_id] = [...list, member];
      writeDemoStore(store);
      return member;
    }
    case 'listSources':
      return {
        items: store.sources[request?.project_id] ?? [],
        total: store.sources[request?.project_id]?.length ?? 0,
        limit: request?.limit ?? 50,
        offset: request?.offset ?? 0,
      };
    case 'listConflicts':
      return store.conflicts[request?.project_id] ?? [];

    case 'listTrainingCases': {
      let items = DEMO_TRAINING_CASES;
      if (request?.category) items = items.filter((item) => item.category === request.category);
      if (request?.difficulty) items = items.filter((item) => item.difficulty === request.difficulty);
      const offset = request?.offset ?? 0;
      const limit = request?.limit ?? 50;
      return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
    }
    case 'getTrainingCaseVersion': {
      const found = DEMO_TRAINING_CASES.find((item) => item.id === request?.id);
      if (!found) {
        throw new ApiClientError(404, 'NOT_FOUND', '训练案例不存在', demoId('demo_request'));
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
    }
    case 'createTrainingAttempt': {
      const now = new Date().toISOString();
      const attempt: DemoTrainingAttempt = {
        attempt_id: demoId('demo_training'),
        case_id: request?.case_id,
        case_version: request?.case_version ?? 'demo',
        source_kind: request?.source_kind ?? 'sample',
        status: 'interviewing',
        question_count: 0,
        started_at: now,
        completed_at: null,
      };
      store.trainingAttempts[attempt.attempt_id] = attempt;
      writeDemoStore(store);
      return attempt;
    }
    case 'getTrainingAttempt': {
      const attempt = store.trainingAttempts[request?.id];
      if (attempt) return attempt;
      throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', demoId('demo_request'));
    }
    case 'postTrainingQuestion': {
      const attempt = store.trainingAttempts[request?.attempt_id];
      if (!attempt) {
        throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', demoId('demo_request'));
      }
      attempt.question_count += 1;
      writeDemoStore(store);
      return { job_id: demoId('demo_job'), status: 'accepted' };
    }
    case 'postTrainingSummary': {
      const attempt = store.trainingAttempts[request?.attempt_id];
      if (!attempt) {
        throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', demoId('demo_request'));
      }
      attempt.status = 'feedback_ready';
      store.trainingFeedback[attempt.attempt_id] = buildTrainingFeedback();
      writeDemoStore(store);
      return { job_id: demoId('demo_job'), status: 'accepted' };
    }
    case 'getTrainingFeedback': {
      if (!store.trainingAttempts[request?.attempt_id]) {
        throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', demoId('demo_request'));
      }
      return store.trainingFeedback[request?.attempt_id] ?? buildTrainingFeedback();
    }
    case 'retryTrainingAttempt': {
      const prior = store.trainingAttempts[request?.attempt_id];
      if (!prior) {
        throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', demoId('demo_request'));
      }
      const attempt: DemoTrainingAttempt = {
        attempt_id: demoId('demo_training'),
        case_id: prior.case_id,
        case_version: prior.case_version,
        source_kind: prior.source_kind ?? 'sample',
        status: 'interviewing',
        question_count: 0,
        started_at: new Date().toISOString(),
        completed_at: null,
      };
      store.trainingAttempts[attempt.attempt_id] = attempt;
      writeDemoStore(store);
      return attempt;
    }
    case 'completeTrainingAttempt': {
      const attempt = store.trainingAttempts[request?.attempt_id];
      if (attempt) {
        attempt.status = 'completed';
        attempt.completed_at = new Date().toISOString();
        writeDemoStore(store);
        return attempt;
      }
      throw new ApiClientError(404, 'NOT_FOUND', '训练尝试不存在', demoId('demo_request'));
    }
    default:
      throw new Error(`Demo handler not registered for operation: ${operationId}`);
  }
}

function defaultDemoStore(): DemoStore {
  return {
    projects: {},
    members: {},
    sources: {},
    conflicts: {},
    trainingAttempts: {},
    trainingFeedback: {},
  };
}

function readDemoStore(): DemoStore {
  if (typeof window === 'undefined') return defaultDemoStore();
  const raw = window.localStorage.getItem(DEMO_STORE_KEY);
  if (!raw) return defaultDemoStore();
  try {
    return { ...defaultDemoStore(), ...JSON.parse(raw) };
  } catch {
    return defaultDemoStore();
  }
}

function writeDemoStore(store: DemoStore): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store));
}

function buildTrainingFeedback(): DemoTrainingFeedback {
  return {
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
        evidence: '已开始追问目标，但具体指标仍可更清楚。',
        comment: '覆盖充分，可继续追问判断口径',
      },
      {
        dimension: '角色覆盖',
        status: 'partial',
        evidence: '当前追问覆盖了使用者，但确认人还不够明确。',
        comment: '需要补充谁最终确认范围',
      },
      {
        dimension: '验收表达',
        status: 'missing',
        evidence: '总结里已有场景和边界，验收口径仍可量化。',
        comment: '完成标准可以再加入时间或数量口径',
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
}

function demoId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
  return `${prefix}_${random}`;
}

function initials(value: string): string {
  const clean = value.trim();
  return clean ? clean.slice(0, 2).toUpperCase() : '项';
}
