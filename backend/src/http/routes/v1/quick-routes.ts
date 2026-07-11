import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RouteRegistry, RouteContext, Actor } from '../../route-registry';
import { ApiError } from '../../errors';
import { generateId } from '../../../shared/id';
import { now, addDays } from '../../../shared/time';
import { QuickSessionRepo } from '../../../repo/quick-session-repo';
import type { QuickTurnRepo } from '../../../repo/quick-turn-repo';
import type { QuickUnknownRepo } from '../../../repo/quick-unknown-repo';
import type { BriefRepo } from '../../../repo/brief-repo';
import { UpgradeRepo } from '../../../repo/upgrade-repo';
import { ProjectRepo } from '../../../repo/project-repo';
import { IntakeRepo } from '../../../repo/intake-repo';
import { JobRepo } from '../../../repo/job-repo';
import type { MemberRepo } from '../../../repo/member-repo';
import { UserRepo } from '../../../repo/user-repo';
import type { AgreementRepo } from '../../../repo/agreement-repo';
import { resolveFormalUserId } from '../../formal-actor';
import { enqueueFormalGuidanceJob } from '../../formal-job';
import type {
  QuickSession,
  QuickTurn,
  QuickUnknown,
  BriefVersion,
} from '../../../db/schema/quick';

/**
 * Quick-consult routes (Task 14, §5A).
 *
 * Registers all 21 quick-session operationIds onto the route registry. The
 * handlers own business-logic orchestration across the quick-session, turn,
 * unknown, brief, upgrade, project, member and intake repos.
 *
 * Async endpoints (202 + job_id) are placeholders — the real Job queue is
 * wired up in Task 20.
 */

export interface QuickRouteDeps {
  quickSessionRepo: QuickSessionRepo;
  quickTurnRepo: QuickTurnRepo;
  quickUnknownRepo: QuickUnknownRepo;
  briefRepo: BriefRepo;
  upgradeRepo: UpgradeRepo;
  projectRepo: ProjectRepo;
  memberRepo: MemberRepo;
  intakeRepo: IntakeRepo;
  jobRepo?: JobRepo;
  userRepo?: UserRepo;
  agreementRepo?: AgreementRepo;
}

// ── constants ───────────────────────────────────────────────────────────────

const COVERAGE_SLOTS = [
  'expected_outcome',
  'target_user',
  'core_scenario',
  'scope_boundary',
  'completion_criteria',
  'constraints_risks',
] as const;

const VALID_VIEW_TYPES = new Set(['simple', 'exec']);

// ── zod request schemas ─────────────────────────────────────────────────────

const createQuickSessionSchema = z.object({
  original_input: z.string().min(1).max(10000),
  intent: z.string().nullable().optional(),
  decision_intent: z.string().nullable().optional(),
  source_kind: z.enum(['custom', 'sample', 'training_fixture', 'internal_test']),
  source_case_id: z.string().nullable().optional(),
});

const QUICK_NEED_HINT = '这句话还不够像一个需求，请补充你想做什么、给谁用、希望得到什么结果。';

function looksLikeQuickNeed(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^[\d\s.,，。:：;；!?！？_-]+$/.test(text)) return false;
  const compact = text.replace(/\s+/g, '');
  if (/^[a-zA-Z0-9_-]+$/.test(compact) && !/[一-龥]/.test(compact)) return false;
  if (/[一-龥]/.test(text) && /想|需要|希望|做|写|生成|设计|开发|策划|整理|分析|优化|搭建|制作|创建|准备|确认|改/.test(text)) {
    return true;
  }
  return /[一-龥]/.test(text) && text.length >= 8;
}

const postMessageSchema = z.object({
  action: z.enum(['answer', 'skip', 'unknown']).optional().default('answer'),
  content: z.string().nullable().optional(),
  question_id: z.string().nullable().optional(),
  bound_refs: z
    .array(
      z.object({
        card_id: z.string(),
        card_title: z.string(),
        card_version: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

const understandingReviewSchema = z.object({
  action: z.enum(['correct', 'accept', 'modify', 'uncertain', 'return']),
});

const topicChangeSchema = z.object({
  action: z.enum(['append', 'new_session', 'defer']),
});

const optionPreferenceSchema = z.object({
  option_id: z.string().min(1),
  matches_ai_recommendation: z.boolean().optional(),
  is_preferred: z.boolean().optional(),
});

const briefRequestSchema = z.object({
  accept_incomplete: z.boolean().optional().default(false),
});

const briefExportSchema = z.object({
  view_type: z.enum(['simple', 'exec']),
  export_type: z.enum(['copy', 'download']),
});

const briefFeedbackSchema = z.object({
  rating: z.enum([
    'usable_with_minor_or_no_edits',
    'needs_major_revision',
    'not_usable',
  ]),
  expected_use: z.string().nullable().optional(),
});

const upgradeSchema = z.object({
  brief_version: z.number().int().min(1).optional(),
  expected_quick_session_version: z.number().int().min(1).optional(),
});

// ── helpers ─────────────────────────────────────────────────────────────────

function toRepoActor(actor: Actor): { kind: 'user' | 'guest'; id: string } {
  if (actor.kind === 'user' && actor.userId) {
    return { kind: 'user', id: actor.userId };
  }
  if (actor.kind === 'guest' && actor.guestSessionId) {
    return { kind: 'guest', id: actor.guestSessionId };
  }
  throw ApiError.unauthenticated();
}

function validateBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.validationError(result.error.flatten().fieldErrors);
  }
  return result.data;
}

function parseVersionParam(params: Record<string, string>): number {
  const raw = params.version;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw ApiError.validationError({ version: 'must be a positive integer' });
  }
  return n;
}

function assertViewType(viewType: string): string {
  if (!VALID_VIEW_TYPES.has(viewType)) {
    throw ApiError.validationError({
      viewType: `must be one of: ${Array.from(VALID_VIEW_TYPES).join(', ')}`,
    });
  }
  return viewType;
}

function parseCoverageSlots(json: string): Array<{
  slot_id: string;
  status: string;
  last_updated: string | null;
  label?: string;
  is_blocking?: boolean;
}> {
  try {
    const data = JSON.parse(json);
    if (data && Array.isArray(data.slots)) {
      return data.slots;
    }
  } catch {
    // fall through to default
  }
  return COVERAGE_SLOTS.map((slot_id) => ({
    slot_id,
    status: 'not_started',
    last_updated: null,
  }));
}

function parseRuntimeSnapshot(json: string): Record<string, any> | null {
  try {
    const data = JSON.parse(json);
    if (data && typeof data === 'object') return data as Record<string, any>;
  } catch {
    // fall through
  }
  return null;
}

function parseQuickOptions(json: string): Array<Record<string, unknown>> {
  const snapshot = parseRuntimeSnapshot(json);
  const options = snapshot?.options;
  if (!Array.isArray(options)) return [];
  return options
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const option = item as Record<string, any>;
      return {
        id: String(option.id ?? ''),
        title: String(option.title ?? ''),
        description: String(option.description ?? ''),
        pros: Array.isArray(option.pros) ? option.pros.map(String) : [],
        cons: Array.isArray(option.cons) ? option.cons.map(String) : [],
        is_recommended: option.isRecommended === true || option.is_recommended === true,
      };
    })
    .filter((item) => item.id && item.title);
}

function parseQuickRecommendation(json: string): string | null {
  const snapshot = parseRuntimeSnapshot(json);
  return typeof snapshot?.recommendation === 'string' && snapshot.recommendation.trim()
    ? snapshot.recommendation
    : null;
}

function serializeSession(
  session: QuickSession,
  briefVersion: BriefVersion | null,
) {
  return {
    id: session.id,
    version: session.version,
    status: session.status,
    original_input: session.originalInput,
    source_kind: session.sourceKind,
    source_case_id: session.sourceCaseId ?? null,
    intent: session.intent ?? null,
    decision_intent: session.decisionIntent ?? null,
    coverage_slots: parseCoverageSlots(session.coverageSlotsJson),
    quick_options: parseQuickOptions(session.coverageSlotsJson),
    recommendation: parseQuickRecommendation(session.coverageSlotsJson),
    current_understanding_version: session.currentUnderstandingVersion,
    current_brief_version: briefVersion?.version ?? null,
    created_at: session.createdAt,
    updated_at: session.lastActiveAt,
  };
}

function serializeTurn(turn: QuickTurn) {
  return {
    id: turn.id,
    turn_index: turn.turnIndex,
    role: turn.role,
    content: turn.content,
    question_id: turn.questionId ?? null,
    understanding_version: turn.understandingVersion ?? null,
    created_at: turn.createdAt,
  };
}

function serializeUnknown(u: QuickUnknown) {
  return {
    id: u.id,
    question: u.description,
    impact: '',
    is_blocking: u.isBlocking === 1,
    suggested_responsible: null,
    suggested_info_needed: null,
    review_condition: null,
    created_at: u.createdAt,
    resolved_at: u.resolvedAt,
    status: u.resolvedAt ? 'resolved' : 'open',
  };
}

function serializeRuntimeUnknown(session: QuickSession, item: Record<string, any>) {
  return {
    id: String(item.id ?? generateId('qu')),
    question: String(item.question ?? item.label ?? '待确认信息'),
    impact: String(item.impact ?? ''),
    is_blocking: item.isBlocking === true || item.is_blocking === true,
    suggested_responsible: null,
    suggested_info_needed: item.label ?? null,
    review_condition: null,
    created_at: session.lastActiveAt,
    resolved_at: null,
    status: 'open',
  };
}

function serializeBriefVersion(bv: BriefVersion) {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(bv.snapshotJson);
  } catch {
    snapshot = {};
  }
  return {
    brief_version: bv.version,
    snapshot,
    generated_at: bv.generatedAt,
    is_incomplete: bv.isIncomplete === 1,
    blocking_unknowns_count: bv.blockingUnknownCount,
    non_blocking_unknowns_count: countNonBlockingUnknowns(snapshot),
  };
}

function serializeBriefVersionSummary(bv: BriefVersion) {
  return {
    brief_version: bv.version,
    generated_at: bv.generatedAt,
    is_incomplete: bv.isIncomplete === 1,
    blocking_unknown_count: bv.blockingUnknownCount,
    blocking_unknowns_count: bv.blockingUnknownCount,
    non_blocking_unknowns_count: countNonBlockingUnknowns(snapshotFromBrief(bv)),
  };
}

function renderBriefView(snapshot: unknown, viewType: string): string {
  const s = (snapshot ?? {}) as Record<string, unknown>;
  const storedViews = s.views as Record<string, unknown> | undefined;
  const directView = storedViews?.[viewType];
  if (typeof directView === 'string' && directView.trim()) {
    return directView;
  }
  const titleMap: Record<string, string> = {
    simple: '概述',
    exec: '详细报告',
  };
  const parts: string[] = [];
  parts.push(`# 需求简报（${titleMap[viewType] ?? viewType}）`);
  if (s.original_input) parts.push(`## 原始想法\n\n${s.original_input}`);
  if (s.expected_outcome) parts.push(`## 期望结果\n\n${s.expected_outcome}`);
  if (Array.isArray(s.target_users) && s.target_users.length) {
    parts.push(`## 目标用户\n\n${(s.target_users as string[]).join('、')}`);
  }
  if (s.core_scenario) parts.push(`## 核心场景\n\n${s.core_scenario}`);
  if (Array.isArray(s.scope_included) && s.scope_included.length) {
    parts.push(
      `## 本次范围\n\n${(s.scope_included as string[]).map((x) => `- ${x}`).join('\n')}`,
    );
  }
  if (Array.isArray(s.scope_excluded) && s.scope_excluded.length) {
    parts.push(
      `## 明确不做\n\n${(s.scope_excluded as string[]).map((x) => `- ${x}`).join('\n')}`,
    );
  }
  if (Array.isArray(s.core_requirements) && s.core_requirements.length) {
    parts.push(
      `## 核心需求\n\n${(s.core_requirements as unknown[]).map((r) => `- ${JSON.stringify(r)}`).join('\n')}`,
    );
  }
  if (Array.isArray(s.completion_criteria) && s.completion_criteria.length) {
    parts.push(
      `## 完成条件\n\n${(s.completion_criteria as unknown[]).map((c) => `- ${JSON.stringify(c)}`).join('\n')}`,
    );
  }
  if (Array.isArray(s.candidate_options) && s.candidate_options.length) {
    parts.push(
      `## 候选方案\n\n${(s.candidate_options as unknown[]).map((o) => `- ${JSON.stringify(o)}`).join('\n')}`,
    );
  }
  if (Array.isArray(s.constraints_risks) && s.constraints_risks.length) {
    parts.push(
      `## 约束与风险\n\n${(s.constraints_risks as unknown[]).map((c) => `- ${JSON.stringify(c)}`).join('\n')}`,
    );
  }
  if (Array.isArray(s.unknowns) && s.unknowns.length) {
    parts.push(
      `## 待确认问题\n\n${(s.unknowns as unknown[]).map((u) => `- ${JSON.stringify(u)}`).join('\n')}`,
    );
  }
  if (s.recommended_next_step) {
    parts.push(`## 建议下一步\n\n${s.recommended_next_step}`);
  }
  parts.push(
    '\n> 本简报为非正式项目基线，缺失内容应显示为“待确认 / 尚未提供 / 不适用”。',
  );
  return parts.join('\n\n');
}

function snapshotFromBrief(bv: BriefVersion): unknown {
  try {
    return JSON.parse(bv.snapshotJson);
  } catch {
    return {};
  }
}

function countNonBlockingUnknowns(snapshot: unknown): number {
  const s = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, any> : {};
  const unknowns = Array.isArray(s.unknowns) ? s.unknowns : [];
  return unknowns.filter((item: any) => item?.is_blocking === false || item?.isBlocking === false).length;
}

function hashQuickSession(session: QuickSession): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: session.id,
        originalInput: session.originalInput,
        status: session.status,
        version: session.version,
      }),
      'utf8',
    )
    .digest('hex');
}

function hashBriefVersion(bv: BriefVersion): string {
  return createHash('sha256').update(bv.snapshotJson, 'utf8').digest('hex');
}

/**
 * Build a 202 Accepted async-job envelope.
 *
 * TODO: Task 20 接入真实 Job 队列 — replace the placeholder job_id with a
 * real enqueued job and return its id/status_url.
 */
function asyncJobResponse(): {
  data: { job_id: string; status: string; status_url: string };
  meta: Record<string, unknown>;
  statusCode: number;
} {
  const jobId = generateId('job');
  return {
    data: {
      job_id: jobId,
      status: 'queued',
      status_url: `/api/v1/ai-jobs/${jobId}`,
    },
    meta: {},
    statusCode: 202,
  };
}

function enqueueQuickJob(input: {
  ctx: RouteContext;
  jobRepo?: JobRepo;
  session: QuickSession;
  actor: { kind: 'user' | 'guest'; id: string };
  taskType: string;
  payload: Record<string, unknown>;
}): {
  data: { job_id: string; status: string; status_url: string };
  meta: Record<string, unknown>;
  statusCode: number;
} {
  if (!input.jobRepo) return asyncJobResponse();
  const payloadJson = JSON.stringify({
    ...input.payload,
    quick_session_id: input.session.id,
    request_id: input.ctx.requestId,
  });
  const inputHash = createHash('sha256').update(payloadJson, 'utf8').digest('hex');
  const job = input.jobRepo.create({
    scopeKind: 'quick_session',
    quickSessionId: input.session.id,
    taskType: input.taskType,
    payloadJson,
    inputHash,
    dedupeKey: inputHash.slice(0, 16),
    createdByKind: input.actor.kind,
    createdByUserId: input.actor.kind === 'user' ? input.actor.id : undefined,
    createdByGuestSessionId: input.actor.kind === 'guest' ? input.actor.id : undefined,
  });
  return {
    data: {
      job_id: job.id,
      status: job.status,
      status_url: `/api/v1/ai-jobs/${job.id}`,
    },
    meta: {},
    statusCode: 202,
  };
}

function briefVersionNotFound(): ApiError {
  return new ApiError(404, 'BRIEF_VERSION_NOT_FOUND', 'Brief version not found');
}

// ── registration ────────────────────────────────────────────────────────────

export function registerQuickRoutes(
  registry: RouteRegistry,
  deps: QuickRouteDeps,
): void {
  const {
    quickSessionRepo,
    quickTurnRepo,
    quickUnknownRepo,
    briefRepo,
    upgradeRepo,
    intakeRepo,
    jobRepo,
  } = deps;

  // 1. createQuickSession — POST /quick-sessions (协议关口)
  registry.register(
    'createQuickSession',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const body = validateBody(createQuickSessionSchema, ctx.body);
      if (body.source_kind === 'custom' && !looksLikeQuickNeed(body.original_input)) {
        throw ApiError.validationError(
          { original_input: QUICK_NEED_HINT },
          QUICK_NEED_HINT,
        );
      }
      const session = quickSessionRepo.create({
        actorKind: repoActor.kind,
        userId: repoActor.kind === 'user' ? repoActor.id : undefined,
        guestSessionId: repoActor.kind === 'guest' ? repoActor.id : undefined,
        sourceKind: body.source_kind,
        sourceCaseId: body.source_case_id ?? null,
        originalIdea: body.original_input,
        targetUseCase: body.decision_intent ?? undefined,
      });
      quickTurnRepo.create({
        quickSessionId: session.id,
        role: 'user',
        content: body.original_input,
        messageType: 'answer',
      });
      const job = enqueueQuickJob({
        ctx,
        jobRepo,
        session,
        actor: repoActor,
        taskType: 'next_question',
        payload: {
          event: 'session_created',
          original_input: body.original_input,
          source_kind: body.source_kind,
          source_case_id: body.source_case_id ?? null,
        },
      });
      return {
        data: {
          ...serializeSession(session, null),
          active_job_id: job.data.job_id,
        },
        meta: { active_job_id: job.data.job_id },
        statusCode: 201,
      };
    },
    { requireAgreement: true, idempotent: true },
  );

  // 2. getQuickSession — GET /quick-sessions/:id
  registry.register('getQuickSession', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    const latestBrief = briefRepo.findLatestVersion(session.id);
    return {
      ...serializeSession(session, latestBrief),
      active_job_id: jobRepo?.findLatestActiveForQuickSession(session.id)?.id ?? null,
    };
  });

  // 3. deleteQuickSession — DELETE /quick-sessions/:id (软删除)
  registry.register(
    'deleteQuickSession',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      quickSessionRepo.softDelete(session.id, repoActor);
      const row = ctx.db.raw
        .prepare(
          'SELECT id, created_at FROM delete_tasks WHERE target_id = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(session.id) as { id: string; created_at: string } | undefined;
      if (!row) {
        throw ApiError.conflict(
          'INTERNAL_ERROR',
          'Failed to create delete task',
        );
      }
      return {
        data: {
          delete_task_id: row.id,
          scope: 'quick_session',
          target_id: session.id,
          status: 'pending',
          estimated_purge_at: addDays(row.created_at, 30),
        },
        meta: {},
        statusCode: 202,
      };
    },
    { idempotent: true },
  );

  // 4. listQuickSessionMessages — GET /quick-sessions/:id/messages
  registry.register('listQuickSessionMessages', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    const { items, nextCursor } = quickTurnRepo.listBySession(session.id, {
      limit: ctx.query.limit,
      cursor: ctx.query.cursor,
    });
    // Derive the current pending question from the latest AI turn carrying a
    // question_id.
    const latestQuestions = quickTurnRepo.listLatestQuestions(session.id, 10);
    const pending = latestQuestions.find((t) => t.questionId !== null);
    const currentQuestion = pending
      ? {
          question_id: pending.questionId!,
          text: pending.content,
          topic: 'expected_outcome',
          blocking: false,
        }
      : null;
    return {
      data: {
        items: items.map(serializeTurn),
        current_question: currentQuestion,
      },
      meta: {
        cursor: nextCursor ?? null,
        has_more: nextCursor !== null,
      },
    };
  });

  // 5. postQuickSessionMessage — POST /quick-sessions/:id/messages (协议关口, 202+job)
  registry.register(
    'postQuickSessionMessage',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const body = validateBody(postMessageSchema, ctx.body);
      // Persist the user's answer/skip/unknown as a turn.
      const content =
        body.content ?? (body.action === 'skip' ? '[skipped]' : '[unknown]');
      quickTurnRepo.create({
        quickSessionId: session.id,
        role: 'user',
        content,
        messageType: body.action,
      });
      return enqueueQuickJob({
        ctx,
        jobRepo,
        session,
        actor: repoActor,
        taskType: 'next_question',
        payload: {
          event: 'user_answer',
          action: body.action,
          content,
          question_id: body.question_id ?? null,
          bound_refs: body.bound_refs ?? [],
        },
      });
    },
    { requireAgreement: true, idempotent: true },
  );

  // 6. getQuickSessionCoverage — GET /quick-sessions/:id/coverage
  registry.register('getQuickSessionCoverage', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    return { slots: parseCoverageSlots(session.coverageSlotsJson) };
  });

  // 7. getQuickSessionUnderstanding — GET /quick-sessions/:id/understanding
  registry.register('getQuickSessionUnderstanding', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    const runtimeSnapshot = parseRuntimeSnapshot(session.coverageSlotsJson);
    const understanding = runtimeSnapshot?.understanding;
    return {
      session_id: session.id,
      version: session.currentUnderstandingVersion,
      understanding_version: session.currentUnderstandingVersion,
      summary: understanding?.summary ?? null,
      slots: Object.fromEntries(
        Object.entries((understanding?.slots ?? {}) as Record<string, any>).map(
          ([key, value]) => [key, value?.value ?? null],
        ),
      ),
      coverage_slots: parseCoverageSlots(session.coverageSlotsJson),
      updated_at: runtimeSnapshot?.updated_at ?? session.lastActiveAt,
      updated_by: runtimeSnapshot?.updated_by ?? 'system',
    };
  });

  // 8. listQuickSessionUnknowns — GET /quick-sessions/:id/unknowns
  registry.register('listQuickSessionUnknowns', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    const runtimeSnapshot = parseRuntimeSnapshot(session.coverageSlotsJson);
    if (Array.isArray(runtimeSnapshot?.unknowns)) {
      const runtimeUnknowns = runtimeSnapshot.unknowns.map((item: Record<string, any>) =>
        serializeRuntimeUnknown(session, item),
      );
      const statusFilter = ctx.query.status;
      const filtered =
        statusFilter === 'blocking'
          ? runtimeUnknowns.filter((u) => u.is_blocking)
          : statusFilter === 'non_blocking'
            ? runtimeUnknowns.filter((u) => !u.is_blocking)
            : runtimeUnknowns;
      return {
        data: { items: filtered },
        meta: { cursor: null, has_more: false },
      };
    }
    const all = quickUnknownRepo.listBySession(session.id);
    const statusFilter = ctx.query.status;
    const filtered =
      statusFilter === 'blocking'
        ? all.filter((u) => u.isBlocking === 1)
        : statusFilter === 'non_blocking'
          ? all.filter((u) => u.isBlocking === 0)
          : all;
    return {
      data: { items: filtered.map(serializeUnknown) },
      meta: { cursor: null, has_more: false },
    };
  });

  // 9. reviewQuickSessionUnderstanding — POST .../understanding-review (协议关口, 202+job)
  registry.register(
    'reviewQuickSessionUnderstanding',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const body = validateBody(understandingReviewSchema, ctx.body);
      return enqueueQuickJob({
        ctx,
        jobRepo,
        session,
        actor: repoActor,
        taskType: 'understanding_review',
        payload: {
          event: 'understanding_review',
          action: body.action === 'accept' ? 'correct' : body.action,
        },
      });
    },
    { requireAgreement: true, idempotent: true },
  );

  // 10. handleQuickSessionTopicChange — POST .../topic-change
  registry.register(
    'handleQuickSessionTopicChange',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const body = validateBody(topicChangeSchema, ctx.body);
      let newSessionId: string | null = null;
      if (body.action === 'new_session') {
        const created = quickSessionRepo.create({
          actorKind: repoActor.kind,
          userId: repoActor.kind === 'user' ? repoActor.id : undefined,
          guestSessionId: repoActor.kind === 'guest' ? repoActor.id : undefined,
          sourceKind: session.sourceKind,
          originalIdea: session.originalInput,
        });
        newSessionId = created.id;
      }
      // append / defer: no new session; coverage re-evaluation happens via AI job.
      return {
        data: { new_session_id: newSessionId },
        meta: {},
        statusCode: 200,
      };
    },
    { idempotent: true },
  );

  // 11. recordQuickSessionOptionPreference — POST .../option-preferences (协议关口, 202+job)
  registry.register(
    'recordQuickSessionOptionPreference',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const body = validateBody(optionPreferenceSchema, ctx.body);
      const latestBrief = briefRepo.findLatestVersion(session.id);
      const preference =
        body.matches_ai_recommendation ?? body.is_preferred ?? false;
      briefRepo.recordOptionPreference({
        quickSessionId: session.id,
        optionId: body.option_id,
        preference,
        briefVersionId: latestBrief?.id,
      });
      return enqueueQuickJob({
        ctx,
        jobRepo,
        session,
        actor: repoActor,
        taskType: 'option_comparison',
        payload: {
          event: 'option_preference',
          option_id: body.option_id,
          matches_ai_recommendation: preference,
        },
      });
    },
    { requireAgreement: true, idempotent: true },
  );

  // 12. listQuickSessionBriefVersions — GET .../briefs
  registry.register('listQuickSessionBriefVersions', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    const { items, nextCursor } = briefRepo.listVersions(session.id, {
      limit: ctx.query.limit,
      cursor: ctx.query.cursor,
    });
    return {
      data: items.map(serializeBriefVersionSummary),
      meta: {
        cursor: nextCursor ?? null,
        has_more: nextCursor !== null,
      },
    };
  });

  // 13. generateQuickSessionBrief — POST .../briefs (协议关口, 202+job)
  registry.register(
    'generateQuickSessionBrief',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const body = validateBody(briefRequestSchema, ctx.body);
      return enqueueQuickJob({
        ctx,
        jobRepo,
        session,
        actor: repoActor,
        taskType: 'brief_generation',
        payload: {
          event: 'brief_generation',
          accept_incomplete: body.accept_incomplete,
        },
      });
    },
    { requireAgreement: true, idempotent: true },
  );

  // 14. getQuickSessionBriefVersion — GET .../briefs/:version
  registry.register('getQuickSessionBriefVersion', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    const version = parseVersionParam(ctx.params);
    const bv = briefRepo.findVersion(session.id, version);
    if (!bv) throw briefVersionNotFound();
    return serializeBriefVersion(bv);
  });

  // 15. getBriefView — GET .../briefs/:version/views/:viewType
  registry.register('getBriefView', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    const version = parseVersionParam(ctx.params);
    const viewType = assertViewType(ctx.params.viewType);
    const bv = briefRepo.findVersion(session.id, version);
    if (!bv) throw briefVersionNotFound();
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(bv.snapshotJson);
    } catch {
      snapshot = {};
    }
    return {
      view_type: viewType,
      rendered_content: renderBriefView(snapshot, viewType),
      brief_version: bv.version,
    };
  });

  // 16. exportQuickSessionBrief — POST .../briefs/:version/exports
  registry.register(
    'exportQuickSessionBrief',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const version = parseVersionParam(ctx.params);
      const bv = briefRepo.findVersion(session.id, version);
      if (!bv) throw briefVersionNotFound();
      const body = validateBody(briefExportSchema, ctx.body);
      const exportRow = briefRepo.createExport({
        briefVersionId: bv.id,
        format: body.export_type,
        viewType: body.view_type,
      });
      return {
        export_id: exportRow.id,
        expires_at: exportRow.expiresAt,
      };
    },
    { idempotent: true },
  );

  // 17. downloadQuickSessionBrief — GET .../briefs/:version/download
  registry.register('downloadQuickSessionBrief', async (ctx: RouteContext) => {
    const repoActor = toRepoActor(ctx.actor);
    const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
    const version = parseVersionParam(ctx.params);
    const bv = briefRepo.findVersion(session.id, version);
    if (!bv) throw briefVersionNotFound();

    // If an export_id is supplied, verify it is still valid (not expired).
    if (ctx.query.export_id) {
      const result = briefRepo.findExport(ctx.query.export_id);
      if (!result || result.exportRow.briefVersionId !== bv.id) {
        throw briefVersionNotFound();
      }
      if (result.expired) {
        throw new ApiError(410, 'RESOURCE_GONE', '导出已过期或被回收。');
      }
    }

    const viewType = ctx.query.view_type
      ? assertViewType(ctx.query.view_type)
      : 'exec';
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(bv.snapshotJson);
    } catch {
      snapshot = {};
    }
    const content = renderBriefView(snapshot, viewType);
    return {
      data: {
        content,
        content_type: 'text/markdown; charset=utf-8',
        filename: `brief-${bv.version}-${viewType}.md`,
      },
      meta: {},
      statusCode: 200,
    };
  });

  // 18. submitBriefUsefulnessFeedback — POST .../briefs/:version/usefulness-feedback
  registry.register(
    'submitBriefUsefulnessFeedback',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const version = parseVersionParam(ctx.params);
      const bv = briefRepo.findVersion(session.id, version);
      if (!bv) throw briefVersionNotFound();
      const body = validateBody(briefFeedbackSchema, ctx.body);
      const scoreMap: Record<string, number> = {
        usable_with_minor_or_no_edits: 5,
        needs_major_revision: 3,
        not_usable: 1,
      };
      briefRepo.submitFeedback({
        briefVersionId: bv.id,
        usefulnessScore: scoreMap[body.rating] ?? 0,
        comment: body.expected_use ?? undefined,
      });
      return { feedback_id: generateId('buf') };
    },
    { idempotent: true },
  );

  // 19. abandonQuickSession — POST .../abandon
  registry.register(
    'abandonQuickSession',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const updated = quickSessionRepo.abandon(session.id);
      return {
        data: {
          id: updated.id,
          status: updated.status,
          abandoned_at: updated.lastActiveAt,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { idempotent: true },
  );

  // 20. archiveQuickSession — POST .../archive
  registry.register(
    'archiveQuickSession',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const updated = quickSessionRepo.archive(session.id);
      return {
        data: {
          id: updated.id,
          status: updated.status,
          archived_at: updated.archivedAt,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { idempotent: true },
  );

  // 21. upgradeQuickSession — POST .../upgrade (协议关口, 原子事务)
  registry.register(
    'upgradeQuickSession',
    async (ctx: RouteContext) => {
      const repoActor = toRepoActor(ctx.actor);
      const session = quickSessionRepo.findByIdForActor(ctx.params.id, repoActor);
      const body = validateBody(upgradeSchema, ctx.body);
      if (session.sourceKind === 'sample') {
        throw ApiError.conflict(
          'SAMPLE_UPGRADE_UNSUPPORTED',
          '参考案例不支持直接升级，请从正式项目入口新建项目。',
        );
      }
      const userId = await resolveFormalUserId(ctx, {
        userRepo: deps.userRepo ?? new UserRepo(ctx.db.db),
        agreementRepo: deps.agreementRepo,
      });

      // Reject duplicate upgrades first — idempotent retries are handled by
      // the idempotency layer; a second explicit upgrade (even with the
      // updated version) is a conflict. This check precedes the
      // optimistic-concurrency check so a duplicate surfaces as
      // UPGRADE_FAILED rather than VERSION_CONFLICT after the version bump.
      if (upgradeRepo.hasUpgraded(session.id)) {
        throw ApiError.conflict(
          'UPGRADE_FAILED',
          'Quick session has already been upgraded',
        );
      }

      // Optimistic-concurrency check on the quick-session version.
      const expectedQuickSessionVersion = body.expected_quick_session_version ?? session.version;
      if (session.version !== expectedQuickSessionVersion) {
        throw ApiError.versionConflict();
      }

      const bv = body.brief_version
        ? briefRepo.findVersion(session.id, body.brief_version)
        : briefRepo.findLatestVersion(session.id);
      if (!bv) throw briefVersionNotFound();

      const sessionHash = hashQuickSession(session);
      const briefHash = hashBriefVersion(bv);

      try {
        // Single atomic transaction: project + owner member + intake +
        // upgrade_record + mark session upgraded. Any failure rolls back
        // everything, leaving the session in its prior state.
        const result = ctx.db.db.transaction((tx) => {
          const txProjectRepo = new ProjectRepo(tx);
          const txIntakeRepo = new IntakeRepo(tx);
          const txUpgradeRepo = new UpgradeRepo(tx);
          const txSessionRepo = new QuickSessionRepo(tx);
          const txJobRepo = new JobRepo(tx);

          const project = txProjectRepo.create({
            ownerId: userId,
            name: session.originalInput.slice(0, 100),
            description: session.originalInput,
          });

          txIntakeRepo.create({
            projectId: project.id,
            originalText: session.originalInput,
            decisionIntent: session.decisionIntent ?? undefined,
            submittedBy: userId,
            sourceQuickSessionId: session.id,
            sourceBriefVersionId: bv.id,
            sourceQuickSessionHash: sessionHash,
            sourceBriefSnapshotHash: briefHash,
          });

          const upgradeRecord = txUpgradeRepo.create({
            quickSessionId: session.id,
            projectId: project.id,
            briefSnapshotHash: briefHash,
          });

          txSessionRepo.markUpgraded(session.id, project.id);
          const job = enqueueFormalGuidanceJob({
            ctx,
            jobRepo: txJobRepo,
            projectId: project.id,
            userId,
            payload: {
              event: 'quick_session_upgraded',
              source_kind: 'quick_upgrade',
              source_quick_session_id: session.id,
              source_brief_version_id: bv.id,
              quick_brief_snapshot: snapshotFromBrief(bv),
              quick_session_original_input: session.originalInput,
            },
          });

          return { project, upgradeRecord, job };
        });

        return {
          data: {
            project_id: result.project.id,
            upgrade_record_id: result.upgradeRecord.id,
            job_id: result.job.job_id,
            status: result.job.status,
            status_url: result.job.status_url,
          },
          meta: {},
          statusCode: 201,
        };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw ApiError.upgradeFailed(
          err instanceof Error ? err.message : 'Unknown upgrade failure',
        );
      }
    },
    { requireAgreement: true, requireActor: 'any', idempotent: true },
  );
}
