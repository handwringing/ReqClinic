import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

import { RouteRegistry, type RouteContext } from '../src/http/route-registry';
import { loadOpenApi } from '../src/http/openapi-loader';
import { createAuthMiddleware } from '../src/http/middleware/auth';
import { createAgreementGate } from '../src/http/middleware/agreement-gate';
import { registerQuickRoutes } from '../src/http/routes/v1';
import { createTestDb, type AppDb } from './helpers/test-db';
import { QuickSessionRepo } from '../src/repo/quick-session-repo';
import { QuickTurnRepo } from '../src/repo/quick-turn-repo';
import { QuickUnknownRepo } from '../src/repo/quick-unknown-repo';
import { BriefRepo } from '../src/repo/brief-repo';
import { UpgradeRepo } from '../src/repo/upgrade-repo';
import { ProjectRepo } from '../src/repo/project-repo';
import { IntakeRepo } from '../src/repo/intake-repo';
import { MemberRepo } from '../src/repo/member-repo';
import { UserRepo } from '../src/repo/user-repo';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { AgreementRepo } from '../src/repo/agreement-repo';
import { agreementVersions } from '../src/db/schema/identity';
import { briefVersions } from '../src/db/schema/quick';
import { eq } from 'drizzle-orm';
import { env } from '../src/config/env';
import { now, addDays } from '../src/shared/time';
import { generateId } from '../src/shared/id';

/**
 * Route-level tests for the quick-consult endpoints (Task 14, 21 operationIds).
 *
 * Builds a standalone Fastify app with the RouteRegistry wired to an in-memory
 * SQLite database, the auth middleware (cookie-based actor resolution) and the
 * agreement gate (consent enforcement for AI-gated operations).
 *
 * Coverage map (21 operations):
 *  1. createQuickSession            POST   /quick-sessions
 *  2. getQuickSession               GET    /quick-sessions/:id
 *  3. deleteQuickSession            DELETE /quick-sessions/:id
 *  4. listQuickSessionMessages      GET    /quick-sessions/:id/messages
 *  5. postQuickSessionMessage       POST   /quick-sessions/:id/messages
 *  6. getQuickSessionCoverage       GET    /quick-sessions/:id/coverage
 *  7. getQuickSessionUnderstanding  GET    /quick-sessions/:id/understanding
 *  8. listQuickSessionUnknowns      GET    /quick-sessions/:id/unknowns
 *  9. reviewQuickSessionUnderstanding POST /quick-sessions/:id/understanding-review
 * 10. handleQuickSessionTopicChange POST   /quick-sessions/:id/topic-change
 * 11. recordQuickSessionOptionPreference POST /quick-sessions/:id/option-preferences
 * 12. listQuickSessionBriefVersions GET    /quick-sessions/:id/briefs
 * 13. generateQuickSessionBrief     POST   /quick-sessions/:id/briefs
 * 14. getQuickSessionBriefVersion   GET    /quick-sessions/:id/briefs/:version
 * 15. getBriefView                  GET    /quick-sessions/:id/briefs/:version/views/:viewType
 * 16. exportQuickSessionBrief       POST   /quick-sessions/:id/briefs/:version/exports
 * 17. downloadQuickSessionBrief     GET    /quick-sessions/:id/briefs/:version/download
 * 18. submitBriefUsefulnessFeedback POST   /quick-sessions/:id/briefs/:version/usefulness-feedback
 * 19. abandonQuickSession           POST   /quick-sessions/:id/abandon
 * 20. archiveQuickSession           POST   /quick-sessions/:id/archive
 * 21. upgradeQuickSession           POST   /quick-sessions/:id/upgrade
 */
describe('quick-consult routes (Task 14, 21 operationIds)', () => {
  let db: AppDb;
  let app: FastifyInstance;
  let quickSessionRepo: QuickSessionRepo;
  let quickTurnRepo: QuickTurnRepo;
  let quickUnknownRepo: QuickUnknownRepo;
  let briefRepo: BriefRepo;
  let upgradeRepo: UpgradeRepo;

  // ── User / guest fixtures ────────────────────────────────────────────────
  let ownerId: string;
  let noConsentId: string;
  let otherUserId: string;
  let guestSessionKey: string;
  let guestSessionId: string;
  let agreementVersionId: string;

  // ── Shared session fixture (created by owner, used across test blocks) ──
  let sessionId: string;

  beforeAll(async () => {
    db = createTestDb();

    // ── Wire up the app with the RouteRegistry ────────────────────────────
    app = Fastify({ logger: false });
    await app.register(cookie);

    const userRepo = new UserRepo(db.db);
    const guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);
    const agreementRepo = new AgreementRepo(db.db);
    const projectRepo = new ProjectRepo(db.db);
    const memberRepo = new MemberRepo(db.db);
    const intakeRepo = new IntakeRepo(db.db);

    quickSessionRepo = new QuickSessionRepo(db.db);
    quickTurnRepo = new QuickTurnRepo(db.db);
    quickUnknownRepo = new QuickUnknownRepo(db.db);
    briefRepo = new BriefRepo(db.db);
    upgradeRepo = new UpgradeRepo(db.db);

    const auth = createAuthMiddleware({ userRepo, guestSessionRepo });
    const agreementGate = createAgreementGate({ agreementRepo });

    const registry = new RouteRegistry(loadOpenApi());
    registerQuickRoutes(registry, {
      quickSessionRepo,
      quickTurnRepo,
      quickUnknownRepo,
      briefRepo,
      upgradeRepo,
      projectRepo,
      memberRepo,
      intakeRepo,
    });

    await registry.applyTo(app, db, {
      resolveActor: auth.resolveActor,
      checkAgreement: (ctx: RouteContext) => agreementGate.checkAgreement(ctx.actor),
    });
    await app.ready();

    // ── Seed users ────────────────────────────────────────────────────────
    const owner = await userRepo.create({
      displayName: 'Owner',
      authSubject: 'auth|owner',
      email: 'owner@example.com',
    });
    ownerId = owner.id;

    const noConsent = await userRepo.create({
      displayName: 'No Consent',
      authSubject: 'auth|noconsent',
    });
    noConsentId = noConsent.id;

    const other = await userRepo.create({
      displayName: 'Other User',
      authSubject: 'auth|other',
      email: 'other@example.com',
    });
    otherUserId = other.id;

    // ── Seed agreement version + consent for owner, other, guest ──────────
    agreementVersionId = generateId('agrv');
    const ts = now();
    await db.db
      .insert(agreementVersions)
      .values({
        id: agreementVersionId,
        version: '1.0.0',
        status: 'active',
        changeType: 'major',
        effectiveAt: ts,
        contentRef: 'test://agreement.md',
        createdAt: ts,
      });
    await agreementRepo.createConsent({
      agreementVersionId,
      actorKind: 'user',
      userId: ownerId,
    });
    await agreementRepo.createConsent({
      agreementVersionId,
      actorKind: 'user',
      userId: otherUserId,
    });

    // ── Seed guest session with consent ───────────────────────────────────
    const guestSession = await guestSessionRepo.create();
    guestSessionKey = guestSession.sessionKey;
    guestSessionId = guestSession.id;
    await agreementRepo.createConsent({
      agreementVersionId,
      actorKind: 'guest',
      guestSessionId,
    });

    // ── Create a shared quick session owned by owner ──────────────────────
    const session = quickSessionRepo.create({
      actorKind: 'user',
      userId: ownerId,
      sourceKind: 'custom',
      originalIdea: '我想做一个面向社区医院的在线问诊平台',
      targetUseCase: '确认 MVP 范围',
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function inject(
    method: string,
    url: string,
    opts: {
      body?: unknown;
      cookies?: Record<string, string>;
      query?: Record<string, string | string[]>;
    } = {},
  ): Promise<{ statusCode: number; body: any }> {
    const res = await app.inject({
      method,
      url,
      payload: opts.body as string | object | undefined,
      headers: opts.body !== undefined
        ? { 'content-type': 'application/json' }
        : undefined,
      cookies: opts.cookies,
      query: opts.query,
    });
    let body: any = res.body;
    const ct = res.headers['content-type'];
    if (typeof ct === 'string' && ct.includes('application/json')) {
      try {
        body = JSON.parse(res.body);
      } catch {
        body = res.body;
      }
    }
    return { statusCode: res.statusCode, body };
  }

  function asOwner(cookies: Record<string, string> = {}) {
    return { cookies: { auth_session: ownerId, ...cookies } };
  }

  function asNoConsent(cookies: Record<string, string> = {}) {
    return { cookies: { auth_session: noConsentId, ...cookies } };
  }

  function asOtherUser(cookies: Record<string, string> = {}) {
    return { cookies: { auth_session: otherUserId, ...cookies } };
  }

  function asGuest(cookies: Record<string, string> = {}) {
    return { cookies: { guest_session: guestSessionKey, ...cookies } };
  }

  /** Create a brief version directly via repo for brief/upgrade/feedback tests. */
  function createBriefVersionForSession(
    quickSessionId: string,
    snapshot: Record<string, unknown> = {},
  ) {
    return briefRepo.createVersion({
      quickSessionId,
      contentJson: JSON.stringify({
        original_input: '我想做一个面向社区医院的在线问诊平台',
        expected_outcome: '医生可在线排班、患者可预约挂号',
        target_users: ['社区医生', '患者'],
        core_scenario: '医生登录后台排班 → 患者选择时段预约',
        scope_included: ['排班管理', '预约挂号', '通知'],
        scope_excluded: ['在线支付', '电子病历'],
        core_requirements: [
          { id: 'R1', text: '医生可按周排班' },
        ],
        completion_criteria: [
          { id: 'C1', text: '排班页可保存并展示' },
        ],
        candidate_options: [
          { id: 'O1', text: 'MVP 仅做排班+预约' },
        ],
        constraints_risks: ['需对接医院 HIS'],
        unknowns: ['是否需要医保对接'],
        recommended_next_step: '升级为正式项目并细化需求',
        ...snapshot,
      }),
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. createQuickSession — POST /api/v1/quick-sessions
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /api/v1/quick-sessions (createQuickSession)', () => {
    it('returns 201 when authenticated user with valid consent', async () => {
      const res = await inject('POST', '/api/v1/quick-sessions', {
        body: {
          original_input: '我想做一个面向社区医院的在线问诊平台',
          intent: 'clarify_idea',
          decision_intent: '确认 MVP 范围',
          source_kind: 'custom',
          source_case_id: null,
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.id).toMatch(/^qs_/);
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.original_input).toBe(
        '我想做一个面向社区医院的在线问诊平台',
      );
      expect(res.body.data.source_kind).toBe('custom');
      expect(Array.isArray(res.body.data.coverage_slots)).toBe(true);
      expect(res.body.data.coverage_slots).toHaveLength(6);
      expect(res.body.data.current_understanding_version).toBe(0);
      expect(res.body.data.created_at).toBeTruthy();
      expect(res.body.meta.request_id).toBeTruthy();
    });

    it('returns 201 when guest with valid consent', async () => {
      const res = await inject('POST', '/api/v1/quick-sessions', {
        body: {
          original_input: '游客发起的快速问诊',
          source_kind: 'custom',
        },
        ...asGuest(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.id).toMatch(/^qs_/);
      expect(res.body.data.status).toBe('draft');
    });

    it('persists sample case id for demo sessions', async () => {
      const res = await inject('POST', '/api/v1/quick-sessions', {
        body: {
          original_input: '我想做一个智能海报生成网站',
          source_kind: 'sample',
          source_case_id: 'ai-poster-website',
        },
        ...asGuest(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.source_kind).toBe('sample');
      expect(res.body.data.source_case_id).toBe('ai-poster-website');

      const detail = await inject(
        'GET',
        `/api/v1/quick-sessions/${res.body.data.id}`,
        asGuest(),
      );
      expect(detail.statusCode).toBe(200);
      expect(detail.body.data.source_case_id).toBe('ai-poster-website');
    });

    it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject('POST', '/api/v1/quick-sessions', {
        body: {
          original_input: '无协议同意测试',
          source_kind: 'custom',
        },
        ...asNoConsent(),
      });
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
    });

    it('returns 400 VALIDATION_ERROR for missing original_input', async () => {
      const res = await inject('POST', '/api/v1/quick-sessions', {
        body: {
          source_kind: 'custom',
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid source_kind', async () => {
      const res = await inject('POST', '/api/v1/quick-sessions', {
        body: {
          original_input: '测试',
          source_kind: 'invalid_kind',
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. getQuickSession — GET /api/v1/quick-sessions/:id
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /api/v1/quick-sessions/:id (getQuickSession)', () => {
    it('returns 200 with session details for the owner', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(sessionId);
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.original_input).toContain('在线问诊平台');
      expect(res.body.data.coverage_slots).toHaveLength(6);
      expect(res.body.data.current_understanding_version).toBe(0);
    });

    it('returns quick options from the current runtime snapshot', async () => {
      const optionSession = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'custom',
        originalIdea: '我想做一个智能海报生成网站',
      });
      quickSessionRepo.updateRuntimeSnapshot({
        id: optionSession.id,
        status: 'understanding_review',
        understandingVersion: 1,
        coverageSlotsJson: JSON.stringify({
          slots: [],
          options: [
            {
              id: 'option_focused_v1',
              title: '先做聚焦版',
              description: '先验证核心场景。',
              pros: ['更容易控制范围'],
              cons: ['扩展内容后续再补'],
              isRecommended: true,
            },
          ],
          recommendation: '建议先验证核心场景。',
        }),
      });
      quickSessionRepo.updateStatus(optionSession.id, 'option_review');

      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${optionSession.id}`,
        asOwner(),
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.quick_options).toHaveLength(1);
      expect(res.body.data.quick_options[0].is_recommended).toBe(true);
      expect(res.body.data.recommendation).toBe('建议先验证核心场景。');
    });

    it('returns 404 NOT_FOUND for a non-owner (privacy: no existence leak)', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}`,
        asOtherUser(),
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 for a non-existent session', async () => {
      const res = await inject(
        'GET',
        '/api/v1/quick-sessions/qs_does_not_exist',
        asOwner(),
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. deleteQuickSession — DELETE /api/v1/quick-sessions/:id
  // ══════════════════════════════════════════════════════════════════════════

  describe('DELETE /api/v1/quick-sessions/:id (deleteQuickSession)', () => {
    it('returns 202 with delete_task_id for the owner (soft delete)', async () => {
      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'custom',
        originalIdea: '待删除的问诊会话',
      });

      const res = await inject(
        'DELETE',
        `/api/v1/quick-sessions/${session.id}`,
        asOwner(),
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.delete_task_id).toMatch(/^dt_/);
      expect(res.body.data.scope).toBe('quick_session');
      expect(res.body.data.target_id).toBe(session.id);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.estimated_purge_at).toBeTruthy();
    });

    it('returns 404 for a non-owner', async () => {
      const res = await inject(
        'DELETE',
        `/api/v1/quick-sessions/${sessionId}`,
        asOtherUser(),
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. listQuickSessionMessages — GET /api/v1/quick-sessions/:id/messages
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /api/v1/quick-sessions/:id/messages (listQuickSessionMessages)', () => {
    it('returns 200 with paginated message list (empty initially)', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/messages`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.current_question).toBeNull();
      expect(res.body.meta.cursor).toBeNull();
      expect(res.body.meta.has_more).toBe(false);
    });

    it('returns 404 for a non-owner', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/messages`,
        asOtherUser(),
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. postQuickSessionMessage — POST /api/v1/quick-sessions/:id/messages
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /api/v1/quick-sessions/:id/messages (postQuickSessionMessage)', () => {
    it('returns 202 + job_id placeholder when authenticated with consent', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/messages`,
        {
          body: {
            action: 'answer',
            content: '主要面向社区医生和患者',
            question_id: 'Q_001',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.job_id).toMatch(/^job_/);
      expect(res.body.data.status).toBe('queued');
      expect(res.body.data.status_url).toMatch(/^\/api\/v1\/ai-jobs\/job_/);
    });

    it('persists the user turn so listQuickSessionMessages returns it', async () => {
      const listRes = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/messages`,
        asOwner(),
      );
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.data.items.length).toBeGreaterThanOrEqual(1);
      const userTurn = listRes.body.data.items.find(
        (t: any) => t.role === 'user',
      );
      expect(userTurn).toBeDefined();
      expect(userTurn.content).toBe('主要面向社区医生和患者');
    });

    it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/messages`,
        {
          body: { action: 'answer', content: 'test' },
          ...asNoConsent(),
        },
      );
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
    });

    it('returns 404 for a non-owner', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/messages`,
        {
          body: { action: 'answer', content: 'test' },
          ...asOtherUser(),
        },
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid action', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/messages`,
        {
          body: { action: 'invalid_action', content: 'test' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. getQuickSessionCoverage — GET /api/v1/quick-sessions/:id/coverage
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /api/v1/quick-sessions/:id/coverage (getQuickSessionCoverage)', () => {
    it('returns 200 with 6 coverage slots', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/coverage`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data.slots)).toBe(true);
      expect(res.body.data.slots).toHaveLength(6);
      const slotIds = res.body.data.slots.map((s: any) => s.slot_id);
      expect(slotIds).toEqual([
        'expected_outcome',
        'target_user',
        'core_scenario',
        'scope_boundary',
        'completion_criteria',
        'constraints_risks',
      ]);
      // Fresh session: all slots should be not_started.
      for (const slot of res.body.data.slots) {
        expect(slot.status).toBe('not_started');
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. getQuickSessionUnderstanding — GET /api/v1/quick-sessions/:id/understanding
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /api/v1/quick-sessions/:id/understanding (getQuickSessionUnderstanding)', () => {
    it('returns 200 with understanding_version and updated_at', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/understanding`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.understanding_version).toBe(0);
      expect(res.body.data.updated_at).toBeTruthy();
      expect(res.body.data.updated_by).toBe('system');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. listQuickSessionUnknowns — GET /api/v1/quick-sessions/:id/unknowns
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /api/v1/quick-sessions/:id/unknowns (listQuickSessionUnknowns)', () => {
    it('returns 200 with empty list for a fresh session', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/unknowns`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items).toHaveLength(0);
    });

    it('returns 200 with unknowns filtered by status=blocking', async () => {
      // Seed a blocking and a non-blocking unknown directly via repo.
      quickUnknownRepo.create({
        quickSessionId: sessionId,
        slot: 'expected_outcome',
        question: '期望结果尚未明确',
        severity: 'blocking',
      });
      quickUnknownRepo.create({
        quickSessionId: sessionId,
        slot: 'user_object',
        question: '次要用户群待确认',
        severity: 'non_blocking',
      });

      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/unknowns?status=blocking`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].is_blocking).toBe(true);
    });

    it('returns 200 with non_blocking unknowns when status=non_blocking', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/unknowns?status=non_blocking`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].is_blocking).toBe(false);
    });

    it('returns all unknowns when no status filter', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/unknowns`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.items).toHaveLength(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 9. reviewQuickSessionUnderstanding — POST .../understanding-review
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST .../understanding-review (reviewQuickSessionUnderstanding)', () => {
    it('returns 202 + job_id placeholder', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/understanding-review`,
        {
          body: { action: 'correct' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.job_id).toMatch(/^job_/);
      expect(res.body.data.status).toBe('queued');
    });

    it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/understanding-review`,
        {
          body: { action: 'correct' },
          ...asNoConsent(),
        },
      );
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
    });

    it('returns 400 for invalid action', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/understanding-review`,
        {
          body: { action: 'invalid' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 10. handleQuickSessionTopicChange — POST .../topic-change
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST .../topic-change (handleQuickSessionTopicChange)', () => {
    it('returns 200 with new_session_id when action=new_session', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/topic-change`,
        {
          body: { action: 'new_session' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.new_session_id).toMatch(/^qs_/);
      expect(res.body.data.new_session_id).not.toBe(sessionId);
    });

    it('returns 200 with null new_session_id when action=defer', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/topic-change`,
        {
          body: { action: 'defer' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.new_session_id).toBeNull();
    });

    it('returns 400 for invalid action', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/topic-change`,
        {
          body: { action: 'invalid' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 11. recordQuickSessionOptionPreference — POST .../option-preferences
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST .../option-preferences (recordQuickSessionOptionPreference)', () => {
    it('returns 202 + job_id placeholder', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/option-preferences`,
        {
          body: {
            option_id: 'opt_mvp_only',
            matches_ai_recommendation: true,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.job_id).toMatch(/^job_/);
    });

    it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/option-preferences`,
        {
          body: {
            option_id: 'opt_mvp_only',
            matches_ai_recommendation: true,
          },
          ...asNoConsent(),
        },
      );
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when option_id is missing', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/option-preferences`,
        {
          body: { matches_ai_recommendation: true },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 12-13. listQuickSessionBriefVersions + generateQuickSessionBrief
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET + POST /briefs (list & generate brief versions)', () => {
    it('GET returns 200 with empty list when no briefs exist', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(0);
    });

    it('POST generateQuickSessionBrief returns 202 + job_id placeholder', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs`,
        {
          body: { accept_incomplete: false },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.job_id).toMatch(/^job_/);
      expect(res.body.data.status).toBe('queued');
    });

    it('POST returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs`,
        {
          body: { accept_incomplete: false },
          ...asNoConsent(),
        },
      );
      expect(res.statusCode).toBe(403);
    });

    it('GET returns 200 with list after a brief version is created via repo', async () => {
      createBriefVersionForSession(sessionId);

      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].brief_version).toBe(1);
      expect(res.body.data[0].generated_at).toBeTruthy();
      expect(res.body.data[0].is_incomplete).toBe(false);
      expect(res.body.data[0].blocking_unknown_count).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 14. getQuickSessionBriefVersion — GET .../briefs/:version
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET .../briefs/:version (getQuickSessionBriefVersion)', () => {
    it('returns 200 with the brief snapshot for an existing version', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/1`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.brief_version).toBe(1);
      expect(res.body.data.generated_at).toBeTruthy();
      expect(res.body.data.is_incomplete).toBe(false);
      expect(res.body.data.snapshot).toBeDefined();
      expect(res.body.data.snapshot.original_input).toContain('在线问诊平台');
    });

    it('returns 404 BRIEF_VERSION_NOT_FOUND for a non-existent version', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/999`,
        asOwner(),
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('BRIEF_VERSION_NOT_FOUND');
    });

    it('returns 400 for an invalid version parameter', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/abc`,
        asOwner(),
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 15. getBriefView — GET .../briefs/:version/views/:viewType
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET .../briefs/:version/views/:viewType (getBriefView)', () => {
    const viewTypes = ['simple', 'exec'];

    for (const viewType of viewTypes) {
      it(`returns 200 with rendered_content for viewType=${viewType}`, async () => {
        const res = await inject(
          'GET',
          `/api/v1/quick-sessions/${sessionId}/briefs/1/views/${viewType}`,
          asOwner(),
        );
        expect(res.statusCode).toBe(200);
        expect(res.body.data.view_type).toBe(viewType);
        expect(res.body.data.brief_version).toBe(1);
        expect(typeof res.body.data.rendered_content).toBe('string');
        expect(res.body.data.rendered_content).toContain('需求简报');
      });
    }

    it('returns 400 for an invalid viewType', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/views/invalid_view`,
        asOwner(),
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for a non-existent brief version', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/999/views/exec`,
        asOwner(),
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('BRIEF_VERSION_NOT_FOUND');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 16. exportQuickSessionBrief — POST .../briefs/:version/exports
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST .../briefs/:version/exports (exportQuickSessionBrief)', () => {
    it('returns 201 with export_id and 24h expires_at', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/exports`,
        {
          body: { view_type: 'exec', export_type: 'download' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.export_id).toMatch(/^be_/);
      expect(res.body.data.expires_at).toBeTruthy();
      // expires_at should be ~24h in the future.
      const expiresAt = new Date(res.body.data.expires_at).getTime();
      const nowMs = Date.now();
      const diffHours = (expiresAt - nowMs) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });

    it('returns 404 for a non-existent brief version', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs/999/exports`,
        {
          body: { view_type: 'exec', export_type: 'download' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid export_type', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/exports`,
        {
          body: { view_type: 'exec', export_type: 'invalid' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 17. downloadQuickSessionBrief — GET .../briefs/:version/download
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET .../briefs/:version/download (downloadQuickSessionBrief)', () => {
    it('returns 200 with markdown content when no export_id (internal generation)', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/download`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.content_type).toBe('text/markdown; charset=utf-8');
      expect(res.body.data.filename).toMatch(/^brief-1-/);
      expect(res.body.data.content).toContain('需求简报');
    });

    it('returns 200 with specified view_type=exec', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/download?view_type=exec`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.content).toContain('详细报告');
    });

    it('returns 410 RESOURCE_GONE when the export_id has expired', async () => {
      // Create an export, then manually expire it.
      const exportRes = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/exports`,
        {
          body: { view_type: 'exec', export_type: 'download' },
          ...asOwner(),
        },
      );
      const exportId = exportRes.body.data.export_id;

      // Force expiry by back-dating expires_at to 1 day ago.
      db.raw
        .prepare('UPDATE brief_exports SET expires_at = ? WHERE id = ?')
        .run(addDays(now(), -1), exportId);

      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/download?export_id=${exportId}`,
        asOwner(),
      );
      expect(res.statusCode).toBe(410);
      expect(res.body.error.code).toBe('RESOURCE_GONE');
    });

    it('returns 404 when the brief version does not exist', async () => {
      const res = await inject(
        'GET',
        `/api/v1/quick-sessions/${sessionId}/briefs/999/download`,
        asOwner(),
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('BRIEF_VERSION_NOT_FOUND');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 18. submitBriefUsefulnessFeedback — POST .../briefs/:version/usefulness-feedback
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST .../briefs/:version/usefulness-feedback (submitBriefUsefulnessFeedback)', () => {
    it('returns 201 with a feedback_id', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/usefulness-feedback`,
        {
          body: {
            rating: 'usable_with_minor_or_no_edits',
            expected_use: '交给开发团队',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.feedback_id).toMatch(/^buf_/);
    });

    it('returns 404 for a non-existent brief version', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs/999/usefulness-feedback`,
        {
          body: { rating: 'usable_with_minor_or_no_edits' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for an invalid rating', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/briefs/1/usefulness-feedback`,
        {
          body: { rating: 'invalid_rating' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 19. abandonQuickSession — POST .../abandon
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST .../abandon (abandonQuickSession)', () => {
    it('returns 200 with status=archived for a draft session', async () => {
      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'custom',
        originalIdea: '待放弃的会话',
      });

      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${session.id}/abandon`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(session.id);
      expect(res.body.data.status).toBe('archived');
      expect(res.body.data.abandoned_at).toBeTruthy();
    });

    it('returns 404 for a non-owner', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/abandon`,
        asOtherUser(),
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 20. archiveQuickSession — POST .../archive
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST .../archive (archiveQuickSession)', () => {
    it('returns 200 with status=archived and archived_at', async () => {
      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'custom',
        originalIdea: '待归档的会话',
      });

      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${session.id}/archive`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(session.id);
      expect(res.body.data.status).toBe('archived');
      expect(res.body.data.archived_at).toBeTruthy();
    });

    it('returns 404 for a non-owner', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sessionId}/archive`,
        asOtherUser(),
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 21. upgradeQuickSession — POST .../upgrade (atomic transaction)
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST .../upgrade (upgradeQuickSession)', () => {
    let upgradeSessionId: string;
    let upgradeSessionVersion: number;

    beforeAll(() => {
      // Create a fresh session with a brief version for upgrade tests.
      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'custom',
        originalIdea: '准备升级为正式项目的快速问诊',
        targetUseCase: '升级测试',
      });
      upgradeSessionId = session.id;
      upgradeSessionVersion = session.version;
      createBriefVersionForSession(upgradeSessionId);
    });

    it('returns 404 for a guest actor that cannot access the user quick session', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${upgradeSessionId}/upgrade`,
        {
          body: {
            brief_version: 1,
            expected_quick_session_version: upgradeSessionVersion,
          },
          ...asGuest(),
        },
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${upgradeSessionId}/upgrade`,
        {
          body: {
            brief_version: 1,
            expected_quick_session_version: upgradeSessionVersion,
          },
          ...asNoConsent(),
        },
      );
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
    });

    it('returns 409 when a reference case attempts to upgrade', async () => {
      const sample = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'sample',
        sourceCaseId: 'ai-poster-website',
        originalIdea: '参考案例不应创建正式项目',
      });
      createBriefVersionForSession(sample.id);

      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${sample.id}/upgrade`,
        {
          body: {
            brief_version: 1,
            expected_quick_session_version: sample.version,
          },
          ...asOwner(),
        },
      );

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('SAMPLE_UPGRADE_UNSUPPORTED');
      expect(upgradeRepo.findByQuickSession(sample.id)).toBeNull();
    });

    it('returns 201 with project_id and upgrade_record_id on success', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${upgradeSessionId}/upgrade`,
        {
          body: {
            brief_version: 1,
            expected_quick_session_version: upgradeSessionVersion,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.project_id).toMatch(/^prj_/);
      expect(res.body.data.upgrade_record_id).toMatch(/^up_/);

      // Verify the session is now marked upgraded.
      const updated = quickSessionRepo.findById(upgradeSessionId);
      expect(updated!.status).toBe('upgraded');
      expect(updated!.upgradedAt).toBeTruthy();

      // Verify the upgrade record exists.
      const upgradeRecord = upgradeRepo.findByQuickSession(upgradeSessionId);
      expect(upgradeRecord).not.toBeNull();
      expect(upgradeRecord!.status).toBe('succeeded');
      expect(upgradeRecord!.targetProjectId).toBe(res.body.data.project_id);

      // Verify the project intake has source_quick_session_id + hash snapshot.
      const intakeRepo = new IntakeRepo(db.db);
      const intake = intakeRepo.findLatest(res.body.data.project_id);
      expect(intake).not.toBeNull();
      expect(intake!.sourceQuickSessionId).toBe(upgradeSessionId);
      expect(intake!.sourceBriefSnapshotHash).toHaveLength(64);
      expect(intake!.sourceQuickSessionHash).toHaveLength(64);
    });

    it('returns 409 UPGRADE_FAILED on duplicate upgrade (even with stale version)', async () => {
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${upgradeSessionId}/upgrade`,
        {
          body: {
            brief_version: 1,
            // Use the original (now stale) version — the hasUpgraded check
            // fires before the version check, so this still surfaces as
            // UPGRADE_FAILED rather than VERSION_CONFLICT.
            expected_quick_session_version: upgradeSessionVersion,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('UPGRADE_FAILED');
    });

    it('returns 409 UPGRADE_FAILED and rolls back the transaction when the in-transaction upgrade-record insert collides', async () => {
      // Fresh session with a brief version.
      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'custom',
        originalIdea: '事务回滚升级测试',
      });
      const bv = createBriefVersionForSession(session.id);

      // Pre-insert an upgrade record with status='failed' and the same
      // idempotency key. hasUpgraded() only matches status='succeeded', so
      // the pre-flight check passes; but txUpgradeRepo.create() inside the
      // transaction hits the unique index (quick_session_id, idempotency_key)
      // and throws — which must roll back the project + intake inserts and
      // surface as UPGRADE_FAILED.
      db.raw
        .prepare(
          `INSERT INTO upgrade_records (id, quick_session_id, brief_version_id, target_project_id, idempotency_key, status, started_at)
           VALUES (?, ?, ?, NULL, ?, 'failed', ?)`,
        )
        .run(generateId('up'), session.id, bv.id, `upgrade-${session.id}`, now());

      const projectCountBefore = db.raw
        .prepare('SELECT COUNT(*) AS c FROM projects')
        .get() as { c: number };

      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${session.id}/upgrade`,
        {
          body: {
            brief_version: 1,
            expected_quick_session_version: session.version,
          },
          ...asOwner(),
        },
      );

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('UPGRADE_FAILED');

      // Rollback verification: the session is NOT marked upgraded, and no
      // new project was persisted by the failed upgrade attempt.
      const after = quickSessionRepo.findById(session.id);
      expect(after!.status).not.toBe('upgraded');
      expect(after!.upgradedAt).toBeNull();

      const projectCountAfter = db.raw
        .prepare('SELECT COUNT(*) AS c FROM projects')
        .get() as { c: number };
      expect(projectCountAfter.c).toBe(projectCountBefore.c);
    });

    it('returns 409 VERSION_CONFLICT when version is stale and not yet upgraded', async () => {
      // Fresh session with a brief version — not yet upgraded.
      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'custom',
        originalIdea: '版本冲突升级测试',
      });
      createBriefVersionForSession(session.id);

      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${session.id}/upgrade`,
        {
          body: {
            brief_version: 1,
            expected_quick_session_version: 999, // stale
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('returns 404 BRIEF_VERSION_NOT_FOUND when the brief version does not exist', async () => {
      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: ownerId,
        sourceKind: 'custom',
        originalIdea: '缺少简报的升级测试',
      });

      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${session.id}/upgrade`,
        {
          body: {
            brief_version: 1,
            expected_quick_session_version: session.version,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('BRIEF_VERSION_NOT_FOUND');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Registration parity — all 21 quick operationIds are mounted
  // ══════════════════════════════════════════════════════════════════════════

  describe('registration parity', () => {
    const expectedOperationIds = [
      'createQuickSession',
      'getQuickSession',
      'deleteQuickSession',
      'listQuickSessionMessages',
      'postQuickSessionMessage',
      'getQuickSessionCoverage',
      'getQuickSessionUnderstanding',
      'listQuickSessionUnknowns',
      'reviewQuickSessionUnderstanding',
      'handleQuickSessionTopicChange',
      'recordQuickSessionOptionPreference',
      'listQuickSessionBriefVersions',
      'generateQuickSessionBrief',
      'getQuickSessionBriefVersion',
      'getBriefView',
      'exportQuickSessionBrief',
      'downloadQuickSessionBrief',
      'submitBriefUsefulnessFeedback',
      'abandonQuickSession',
      'archiveQuickSession',
      'upgradeQuickSession',
    ];

    it('registers all 21 quick-consult operationIds', () => {
      const registry = new RouteRegistry(loadOpenApi());
      registerQuickRoutes(registry, {
        quickSessionRepo,
        quickTurnRepo,
        quickUnknownRepo,
        briefRepo,
        upgradeRepo,
        projectRepo: new ProjectRepo(db.db),
        memberRepo: new MemberRepo(db.db),
        intakeRepo: new IntakeRepo(db.db),
      });
      const registered = new Set(registry.getRegisteredIds());
      for (const id of expectedOperationIds) {
        expect(registered.has(id)).toBe(true);
      }
      expect(registry.getRegisteredIds()).toHaveLength(21);
    });
  });
});
