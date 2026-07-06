import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

import { RouteRegistry, type RouteContext } from '../src/http/route-registry';
import { loadOpenApi } from '../src/http/openapi-loader';
import { createAuthMiddleware } from '../src/http/middleware/auth';
import { createAgreementGate } from '../src/http/middleware/agreement-gate';
import { registerTrainingRoutes } from '../src/http/routes/v1';
import { registerEventRoutes } from '../src/http/routes/v1';
import { registerJobRoutes } from '../src/http/routes/v1';
import { createTestDb, type AppDb } from './helpers/test-db';
import { TrainingRepo } from '../src/repo/training-repo';
import { EventRepo } from '../src/repo/event-repo';
import { JobRepo } from '../src/repo/job-repo';
import { UserRepo } from '../src/repo/user-repo';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { AgreementRepo } from '../src/repo/agreement-repo';
import { agreementVersions } from '../src/db/schema/identity';
import { trainingCases } from '../src/db/schema/training';
import { env } from '../src/config/env';
import { now } from '../src/shared/time';
import { generateId } from '../src/shared/id';

/**
 * Route-level tests for the training & product-event endpoints
 * (Task 30, 7 operationIds).
 *
 * Builds a standalone Fastify app with the RouteRegistry wired to an in-memory
 * SQLite database, the auth middleware (cookie-based actor resolution) and the
 * agreement gate (consent enforcement for AI-gated operations).
 *
 * Coverage map (7 operations):
 *  1. listTrainingCases          GET    /training-cases
 *  2. getTrainingCaseVersion     GET    /training-cases/:caseId/versions/:version
 *  3. createTrainingAttempt      POST   /training-attempts            (协议关口)
 *  4. postTrainingQuestion       POST   /training-attempts/:id/questions (协议关口, 202+job)
 *  5. postTrainingSummary        POST   /training-attempts/:id/summary
 *  6. postProductEvents          POST   /events                       (202)
 *  7. getQuickCompletionRate     GET    /metrics/quick-completion-rate (user-only)
 *
 * Additionally verifies:
 *  - 训练数据与真实项目数据隔离 (training tables stay separate from project tables)
 *  - postTrainingQuestion returns 202 + job_id
 *  - 协议关口 blocks createTrainingAttempt / postTrainingQuestion without consent
 */
describe('training & event routes (Task 30, 7 operationIds)', () => {
  let db: AppDb;
  let app: FastifyInstance;
  let trainingRepo: TrainingRepo;
  let eventRepo: EventRepo;
  let jobRepo: JobRepo;

  // ── User / guest fixtures ────────────────────────────────────────────────
  let userId: string;
  let noConsentId: string;
  let guestSessionKey: string;
  let guestSessionId: string;
  let agreementVersionId: string;

  // ── Shared training-case fixture ─────────────────────────────────────────
  const caseId = 'TC_route_001';
  const caseVersion = '1.0.0';

  // ── Shared training-attempt fixture (created by user) ────────────────────
  let attemptId: string;

  beforeAll(async () => {
    db = createTestDb();

    // ── Wire up the app with the RouteRegistry ────────────────────────────
    app = Fastify({ logger: false });
    await app.register(cookie);

    const userRepo = new UserRepo(db.db);
    const guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);
    const agreementRepo = new AgreementRepo(db.db);

    trainingRepo = new TrainingRepo(db.db);
    eventRepo = new EventRepo(db.db);
    jobRepo = new JobRepo(db.db);

    const auth = createAuthMiddleware({ userRepo, guestSessionRepo });
    const agreementGate = createAgreementGate({ agreementRepo });

    const registry = new RouteRegistry(loadOpenApi());
    registerTrainingRoutes(registry, { trainingRepo, jobRepo });
    registerEventRoutes(registry, { eventRepo });
    registerJobRoutes(registry, { jobRepo });

    await registry.applyTo(app, db, {
      resolveActor: auth.resolveActor,
      checkAgreement: (ctx: RouteContext) => agreementGate.checkAgreement(ctx.actor),
    });
    await app.ready();

    // ── Seed users ────────────────────────────────────────────────────────
    const user = await userRepo.create({
      displayName: 'Trainer',
      authSubject: 'auth|trainer',
      email: 'trainer@example.com',
    });
    userId = user.id;

    const noConsent = await userRepo.create({
      displayName: 'No Consent',
      authSubject: 'auth|noconsent',
    });
    noConsentId = noConsent.id;

    // ── Seed agreement version + consent for user and guest ───────────────
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
      userId,
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

    // ── Seed a training case ──────────────────────────────────────────────
    // scenario_json carries public_brief fields (role_label, practice_goal,
    // visible_constraints); disclosure_rules_json and rubric_json hold the
    // private manifest data that must never leak to the browser.
    db.db
      .insert(trainingCases)
      .values({
        id: generateId('tcase'),
        caseId,
        version: caseVersion,
        title: '软件项目需求澄清训练',
        difficulty: 'medium',
        scenarioJson: JSON.stringify({
          category: 'software',
          scene: 'scene-1',
          role_label: '产品负责人',
          practice_goal: '练习澄清目标用户与核心场景',
          visible_constraints: ['预算有限', '两周内交付'],
        }),
        disclosureRulesJson: JSON.stringify([
          { id: 'r1', trigger_intent: 'goal', allowed_answer: '提升转化', related_fact_ids: [] },
        ]),
        rubricJson: JSON.stringify({
          answer_key: { target_user: '中小设计团队' },
          evaluation_dimensions: ['target_clarification', 'user_scenario'],
          rubric: [
            { dimension: 'target_clarification', max_score: 5, evidence_rule: 'mentions-user' },
          ],
        }),
        status: 'active',
        createdAt: ts,
      })
      .run();

    // ── Create a shared training attempt owned by user ────────────────────
    const attempt = trainingRepo.createAttempt({
      caseId,
      caseVersion,
      actorKind: 'user',
      userId,
    });
    attemptId = attempt.id;
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

  function asUser(cookies: Record<string, string> = {}) {
    return { cookies: { auth_session: userId, ...cookies } };
  }

  function asNoConsent(cookies: Record<string, string> = {}) {
    return { cookies: { auth_session: noConsentId, ...cookies } };
  }

  function asGuest(cookies: Record<string, string> = {}) {
    return { cookies: { guest_session: guestSessionKey, ...cookies } };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. listTrainingCases — GET /api/v1/training-cases
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /api/v1/training-cases (listTrainingCases)', () => {
    it('returns 200 with cases for authenticated user', async () => {
      const res = await inject('GET', '/api/v1/training-cases', asUser());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const found = res.body.data.find((c: any) => c.id === caseId);
      expect(found).toBeDefined();
      expect(found.name).toBe('软件项目需求澄清训练');
      expect(found.latest_version).toBe(caseVersion);
      expect(found.status).toBe('active');
      expect(res.body.meta.request_id).toBeTruthy();
      expect(res.body.meta.has_more).toBe(false);
    });

    it('returns 200 for guest with valid session', async () => {
      const res = await inject('GET', '/api/v1/training-cases', asGuest());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await inject('GET', '/api/v1/training-cases');
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. getTrainingCaseVersion — GET /api/v1/training-cases/:caseId/versions/:version
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /api/v1/training-cases/:caseId/versions/:version (getTrainingCaseVersion)', () => {
    it('returns 200 with public brief for authenticated user', async () => {
      const res = await inject(
        'GET',
        `/api/v1/training-cases/${caseId}/versions/${caseVersion}`,
        asUser(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(caseId);
      expect(res.body.data.version).toBe(caseVersion);
      expect(res.body.data.name).toBe('软件项目需求澄清训练');
      expect(res.body.data.status).toBe('active');
      // public_brief carries only the front-facing fields.
      expect(res.body.data.public_brief).toBeDefined();
      expect(res.body.data.public_brief.role_label).toBe('产品负责人');
      expect(res.body.data.public_brief.practice_goal).toBe(
        '练习澄清目标用户与核心场景',
      );
      expect(res.body.data.public_brief.visible_constraints).toEqual([
        '预算有限',
        '两周内交付',
      ]);
      // evaluation_dimensions exposes only dimension names, not scoring rules.
      expect(res.body.data.evaluation_dimensions).toContain(
        'target_clarification',
      );
      expect(res.body.data.evaluation_dimensions).toContain('user_scenario');
    });

    it('does not leak private manifest fields to the browser', async () => {
      const res = await inject(
        'GET',
        `/api/v1/training-cases/${caseId}/versions/${caseVersion}`,
        asUser(),
      );
      expect(res.statusCode).toBe(200);
      // The old `manifest` envelope (answer_key, disclosure_rules) is gone.
      expect(res.body.data.manifest).toBeUndefined();
      expect(res.body.data.answer_key).toBeUndefined();
      expect(res.body.data.disclosure_rules).toBeUndefined();
      expect(res.body.data.hidden_facts).toBeUndefined();
      expect(res.body.data.rubric).toBeUndefined();
      // The seeded private answer must not appear anywhere in the body.
      expect(JSON.stringify(res.body)).not.toContain('中小设计团队');
      expect(JSON.stringify(res.body)).not.toContain('trigger_intent');
      expect(JSON.stringify(res.body)).not.toContain('evidence_rule');
    });

    it('returns 404 TRAINING_CASE_NOT_FOUND for unknown case', async () => {
      const res = await inject(
        'GET',
        '/api/v1/training-cases/TC_missing/versions/1.0.0',
        asUser(),
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('TRAINING_CASE_NOT_FOUND');
    });

    it('returns 404 TRAINING_CASE_NOT_FOUND for unknown version', async () => {
      const res = await inject(
        'GET',
        `/api/v1/training-cases/${caseId}/versions/9.9.9`,
        asUser(),
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('TRAINING_CASE_NOT_FOUND');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await inject(
        'GET',
        `/api/v1/training-cases/${caseId}/versions/${caseVersion}`,
      );
      expect(res.statusCode).toBe(401);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. createTrainingAttempt — POST /api/v1/training-attempts (协议关口)
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /api/v1/training-attempts (createTrainingAttempt)', () => {
    it('returns 201 with attempt details for user with consent', async () => {
      const res = await inject('POST', '/api/v1/training-attempts', {
        body: {
          case_id: caseId,
          case_version: caseVersion,
          difficulty: null,
        },
        ...asUser(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.attempt_id).toMatch(/^ta_/);
      expect(res.body.data.case_id).toBe(caseId);
      expect(res.body.data.case_version).toBe(caseVersion);
      expect(res.body.data.status).toBe('interviewing');
      expect(res.body.data.started_at).toBeTruthy();
      // Response uses `attempt_id` (not `id`) per OpenAPI §TrainingAttempt.
      expect(res.body.data.id).toBeUndefined();
    });

    it('returns 201 for guest with valid consent', async () => {
      const res = await inject('POST', '/api/v1/training-attempts', {
        body: {
          case_id: caseId,
          case_version: caseVersion,
        },
        ...asGuest(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.attempt_id).toMatch(/^ta_/);
      expect(res.body.data.status).toBe('interviewing');
    });

    it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject('POST', '/api/v1/training-attempts', {
        body: {
          case_id: caseId,
          case_version: caseVersion,
        },
        ...asNoConsent(),
      });
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
    });

    it('returns 404 TRAINING_CASE_NOT_FOUND for missing case', async () => {
      const res = await inject('POST', '/api/v1/training-attempts', {
        body: {
          case_id: 'TC_missing',
          case_version: '1.0.0',
        },
        ...asUser(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('TRAINING_CASE_NOT_FOUND');
    });

    it('returns 400 VALIDATION_ERROR for missing case_id', async () => {
      const res = await inject('POST', '/api/v1/training-attempts', {
        body: {
          case_version: caseVersion,
        },
        ...asUser(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 UNAUTHENTICATED when unauthenticated', async () => {
      // Agreement-gated operations still report unauthenticated callers as 401;
      // callers with an identity but no consent get AGREEMENT_REQUIRED.
      const res = await inject('POST', '/api/v1/training-attempts', {
        body: {
          case_id: caseId,
          case_version: caseVersion,
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. postTrainingQuestion — POST /api/v1/training-attempts/:id/questions
  //    (协议关口, 202+job_id)
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /api/v1/training-attempts/:id/questions (postTrainingQuestion)', () => {
    it('returns 202 with job_id for user with consent (owner)', async () => {
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/questions`,
        {
          body: { question: '目标用户是谁？' },
          ...asUser(),
        },
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.job_id).toMatch(/^job_/);
      expect(res.body.data.status).toBe('queued');
      expect(res.body.data.status_url).toContain('/api/v1/ai-jobs/');

      // Job is real: it exists in ai_jobs with the expected scope/task.
      const jobId = res.body.data.job_id as string;
      const job = jobRepo.findById(jobId);
      expect(job).not.toBeNull();
      expect(job!.scopeKind).toBe('training_attempt');
      expect(job!.trainingAttemptId).toBe(attemptId);
      expect(job!.taskType).toBe('training_response');
      expect(job!.status).toBe('queued');

      // GET /api/v1/ai-jobs/:jobId polls the same job back.
      const pollRes = await inject('GET', `/api/v1/ai-jobs/${jobId}`, asUser());
      expect(pollRes.statusCode).toBe(200);
      expect(pollRes.body.data.job_id).toBe(jobId);
      expect(pollRes.body.data.task).toBe('training_response');
      expect(pollRes.body.data.status).toBe('queued');
    });

    it('getTrainingAttempt returns safe recovery messages after a question', async () => {
      const fresh = trainingRepo.createAttempt({
        caseId,
        caseVersion,
        actorKind: 'user',
        userId,
      });
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${fresh.id}/questions`,
        {
          body: {
            question: '请问这次活动最重要的成功标准是什么？',
            bound_refs: [{ id: 'case', title: '案例简介' }],
          },
          ...asUser(),
        },
      );
      expect(res.statusCode).toBe(202);

      const attemptRes = await inject(
        'GET',
        `/api/v1/training-attempts/${fresh.id}`,
        asUser(),
      );
      expect(attemptRes.statusCode).toBe(200);
      expect(attemptRes.body.data.question_count).toBe(1);
      expect(attemptRes.body.data.messages).toHaveLength(1);
      expect(attemptRes.body.data.messages[0]).toMatchObject({
        role: 'user',
        speaker: 'user',
        content: '请问这次活动最重要的成功标准是什么？',
      });
      expect(attemptRes.body.data.messages[0].bindings).toEqual([
        { id: 'case', title: '案例简介' },
      ]);
      expect(JSON.stringify(attemptRes.body.data)).not.toContain('answer_key');
      expect(JSON.stringify(attemptRes.body.data)).not.toContain('disclosure_rules');
    });

    it('returns 202 for guest owner of a guest attempt', async () => {
      // Create a guest-owned attempt first
      const guestAttempt = trainingRepo.createAttempt({
        caseId,
        caseVersion,
        actorKind: 'guest',
        guestSessionId,
      });
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${guestAttempt.id}/questions`,
        {
          body: { question: '时间约束是什么？' },
          ...asGuest(),
        },
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.job_id).toMatch(/^job_/);

      // Verify the job is scoped to the guest-owned attempt.
      const job = jobRepo.findById(res.body.data.job_id);
      expect(job).not.toBeNull();
      expect(job!.scopeKind).toBe('training_attempt');
      expect(job!.trainingAttemptId).toBe(guestAttempt.id);
      expect(job!.taskType).toBe('training_response');
    });

    it('enqueues a distinct job per question (questionIndex drives dedupe key)', async () => {
      // Each postTrainingQuestion on the same attempt allocates a new
      // question_index (auto-incremented), so the dedupe key
      // `training_response:<attempt>:<idx>` is unique per call.
      const fresh = trainingRepo.createAttempt({
        caseId,
        caseVersion,
        actorKind: 'user',
        userId,
      });
      const first = await inject(
        'POST',
        `/api/v1/training-attempts/${fresh.id}/questions`,
        { body: { question: '第一问' }, ...asUser() },
      );
      const second = await inject(
        'POST',
        `/api/v1/training-attempts/${fresh.id}/questions`,
        { body: { question: '第二问' }, ...asUser() },
      );
      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(202);
      expect(first.body.data.job_id).not.toBe(second.body.data.job_id);
      const firstJob = jobRepo.findById(first.body.data.job_id)!;
      const secondJob = jobRepo.findById(second.body.data.job_id)!;
      expect(firstJob.dedupeKey).toBe(
        `training_response:${fresh.id}:0`,
      );
      expect(secondJob.dedupeKey).toBe(
        `training_response:${fresh.id}:1`,
      );
    });

    it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/questions`,
        {
          body: { question: '问题' },
          ...asNoConsent(),
        },
      );
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
    });

    it('returns 404 for non-owner attempt', async () => {
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/questions`,
        {
          body: { question: '问题' },
          ...asGuest(), // guest is not the owner of user's attempt
        },
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for unknown attempt', async () => {
      const res = await inject(
        'POST',
        '/api/v1/training-attempts/ta_unknown/questions',
        {
          body: { question: '问题' },
          ...asUser(),
        },
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 VALIDATION_ERROR for empty question', async () => {
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/questions`,
        {
          body: { question: '' },
          ...asUser(),
        },
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. postTrainingSummary — POST /api/v1/training-attempts/:id/summary
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /api/v1/training-attempts/:id/summary (postTrainingSummary)', () => {
    it('returns 202 with job_id for the owner (async accepted)', async () => {
      // Use a fresh attempt so summary state is clean
      const fresh = trainingRepo.createAttempt({
        caseId,
        caseVersion,
        actorKind: 'user',
        userId,
      });
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${fresh.id}/summary`,
        {
          body: { summary: '本系统面向中小设计团队，核心场景是需求澄清与评审。' },
          ...asUser(),
        },
      );
      // Async-write contract (08 §8.2, OpenAPI AsyncAcceptedResponse).
      expect(res.statusCode).toBe(202);
      expect(res.body.data.job_id).toMatch(/^job_/);
      expect(res.body.data.status).toBe('queued');
      expect(res.body.data.status_url).toContain('/api/v1/ai-jobs/');
      // The summary body must not appear anywhere in the response.
      expect(JSON.stringify(res.body)).not.toContain('中小设计团队');

      // Job is real: it exists in ai_jobs with the expected scope/task.
      const jobId = res.body.data.job_id as string;
      const job = jobRepo.findById(jobId);
      expect(job).not.toBeNull();
      expect(job!.scopeKind).toBe('training_attempt');
      expect(job!.trainingAttemptId).toBe(fresh.id);
      expect(job!.taskType).toBe('training_feedback');
      expect(job!.dedupeKey).toBe(`training_feedback:${fresh.id}`);

      // GET /api/v1/ai-jobs/:jobId polls the same job back.
      const pollRes = await inject('GET', `/api/v1/ai-jobs/${jobId}`, asUser());
      expect(pollRes.statusCode).toBe(200);
      expect(pollRes.body.data.task).toBe('training_feedback');
      expect(pollRes.body.data.status).toBe('queued');

      // The attempt transitioned to `summarizing` (§12A.5).
      const attempt = trainingRepo.findById(fresh.id)!;
      expect(attempt.status).toBe('summarizing');
    });

    it('returns 409 JOB_DEDUPE_CONFLICT when feedback is re-requested for the same attempt', async () => {
      // Each attempt only generates one training_feedback job: the dedupe key
      // `training_feedback:<attempt>` collides on the second submission.
      const fresh = trainingRepo.createAttempt({
        caseId,
        caseVersion,
        actorKind: 'user',
        userId,
      });
      const first = await inject(
        'POST',
        `/api/v1/training-attempts/${fresh.id}/summary`,
        { body: { summary: '第一次总结' }, ...asUser() },
      );
      expect(first.statusCode).toBe(202);

      const second = await inject(
        'POST',
        `/api/v1/training-attempts/${fresh.id}/summary`,
        { body: { summary: '第二次总结' }, ...asUser() },
      );
      expect(second.statusCode).toBe(409);
      expect(second.body.error.code).toBe('JOB_DEDUPE_CONFLICT');
    });

    it('returns 404 for non-owner attempt', async () => {
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/summary`,
        {
          body: { summary: '摘要' },
          ...asGuest(),
        },
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for unknown attempt', async () => {
      const res = await inject(
        'POST',
        '/api/v1/training-attempts/ta_unknown/summary',
        {
          body: { summary: '摘要' },
          ...asUser(),
        },
      );
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 VALIDATION_ERROR for empty summary', async () => {
      const fresh = trainingRepo.createAttempt({
        caseId,
        caseVersion,
        actorKind: 'user',
        userId,
      });
      const res = await inject(
        'POST',
        `/api/v1/training-attempts/${fresh.id}/summary`,
        {
          body: { summary: '' },
          ...asUser(),
        },
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. postProductEvents — POST /api/v1/events (202)
  // ══════════════════════════════════════════════════════════════════════════

  describe('POST /api/v1/events (postProductEvents)', () => {
    function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        event_id: `EVT_route_${Math.random().toString(36).slice(2, 10)}`,
        event_name: 'question_interaction',
        event_schema_version: '1.0.0',
        occurred_at: now(),
        environment: 'development',
        app_version: '1.0.0',
        mode: 'quick',
        source_kind: 'custom',
        analytics_session_id: 'AS_route_001',
        actor_key: null,
        stage: 'clarifying',
        experiment_id: null,
        attributes: {
          question_template_id: 'QT_target_user',
          action: 'answered',
          elapsed_ms: 4200,
        },
        ...overrides,
      };
    }

    it('returns 202 with accepted_count for user', async () => {
      const res = await inject('POST', '/api/v1/events', {
        body: { events: [makeEvent()] },
        ...asUser(),
      });
      expect(res.statusCode).toBe(202);
      expect(res.body.data.accepted_count).toBe(1);
      expect(res.body.data.rejected_count).toBe(0);
      expect(res.body.data.duplicates_count).toBe(0);
    });

    it('returns 202 for guest', async () => {
      const res = await inject('POST', '/api/v1/events', {
        body: { events: [makeEvent()] },
        ...asGuest(),
      });
      expect(res.statusCode).toBe(202);
      expect(res.body.data.accepted_count).toBe(1);
    });

    it('deduplicates by event_id and counts duplicates', async () => {
      const dupEvent = makeEvent({ event_id: 'EVT_route_dup_001' });
      // First insert
      await inject('POST', '/api/v1/events', {
        body: { events: [dupEvent] },
        ...asUser(),
      });
      // Second insert with same event_id
      const res = await inject('POST', '/api/v1/events', {
        body: { events: [dupEvent] },
        ...asUser(),
      });
      expect(res.statusCode).toBe(202);
      expect(res.body.data.accepted_count).toBe(0);
      expect(res.body.data.duplicates_count).toBe(1);
    });

    it('returns 400 for invalid analytics_session_id format', async () => {
      const res = await inject('POST', '/api/v1/events', {
        body: {
          events: [
            makeEvent({ analytics_session_id: 'invalid-format' }),
          ],
        },
        ...asUser(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid environment', async () => {
      const res = await inject('POST', '/api/v1/events', {
        body: {
          events: [makeEvent({ environment: 'staging' })],
        },
        ...asUser(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for empty events array', async () => {
      const res = await inject('POST', '/api/v1/events', {
        body: { events: [] },
        ...asUser(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await inject('POST', '/api/v1/events', {
        body: { events: [makeEvent()] },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. getQuickCompletionRate — GET /api/v1/metrics/quick-completion-rate
  //    (user-only)
  // ══════════════════════════════════════════════════════════════════════════

  describe('GET /api/v1/metrics/quick-completion-rate (getQuickCompletionRate)', () => {
    it('returns 200 with metric envelope for user', async () => {
      const res = await inject(
        'GET',
        '/api/v1/metrics/quick-completion-rate',
        asUser(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.metric_name).toBe('quick-completion-rate');
      expect(typeof res.body.data.numerator).toBe('number');
      expect(typeof res.body.data.denominator).toBe('number');
      expect(res.body.data.observation_window).toBe('7d');
      expect(res.body.data.sample_size).toBe(res.body.data.denominator);
      expect(res.body.data.filters.source_kind).toBe('custom');
      expect(res.body.data.filters.environment_exclude).toContain(
        'internal_test',
      );
      expect(res.body.data.calculated_at).toBeTruthy();
    });

    it('accepts custom observation_window and source_kind', async () => {
      const res = await inject(
        'GET',
        '/api/v1/metrics/quick-completion-rate?observation_window=30d&source_kind=custom',
        asUser(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.observation_window).toBe('30d');
    });

    it('returns 401 for guest (user-only endpoint)', async () => {
      const res = await inject(
        'GET',
        '/api/v1/metrics/quick-completion-rate',
        asGuest(),
      );
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await inject(
        'GET',
        '/api/v1/metrics/quick-completion-rate',
      );
      expect(res.statusCode).toBe(401);
    });

    it('reflects ingested events in the metric', async () => {
      // Seed two sessions: one with a brief_generated event, one without.
      const t = now();
      eventRepo.create({
        sessionId: 'AS_route_metric_1',
        eventName: 'quick_session_started',
        attributes: {},
        actorKind: 'user',
        userId,
        eventId: 'EVT_route_metric_s1',
        sourceKind: 'custom',
        occurredAt: t,
      });
      eventRepo.create({
        sessionId: 'AS_route_metric_2',
        eventName: 'quick_session_started',
        attributes: {},
        actorKind: 'user',
        userId,
        eventId: 'EVT_route_metric_s2',
        sourceKind: 'custom',
        occurredAt: t,
      });
      eventRepo.create({
        sessionId: 'AS_route_metric_1',
        eventName: 'brief_generated',
        attributes: {},
        actorKind: 'user',
        userId,
        eventId: 'EVT_route_metric_b1',
        sourceKind: 'custom',
        occurredAt: t,
      });

      const res = await inject(
        'GET',
        '/api/v1/metrics/quick-completion-rate?observation_window=7d',
        asUser(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.denominator).toBeGreaterThanOrEqual(2);
      expect(res.body.data.numerator).toBeGreaterThanOrEqual(1);
      expect(res.body.data.numerator).toBeLessThanOrEqual(
        res.body.data.denominator,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 训练数据与真实项目数据隔离 (Training data isolation)
  // ══════════════════════════════════════════════════════════════════════════

  describe('training data isolation from real project tables', () => {
    it('training attempts do not create project records', () => {
      const projectsCount = db.raw
        .prepare('SELECT COUNT(*) as n FROM projects')
        .get() as { n: number };
      expect(projectsCount.n).toBe(0);
    });

    it('training questions do not create quick_session turns', () => {
      const turnsCount = db.raw
        .prepare('SELECT COUNT(*) as n FROM quick_turns')
        .get() as { n: number };
      expect(turnsCount.n).toBe(0);
    });

    it('training summaries do not create brief_versions', () => {
      const briefCount = db.raw
        .prepare('SELECT COUNT(*) as n FROM brief_versions')
        .get() as { n: number };
      expect(briefCount.n).toBe(0);
    });

    it('training feedback does not create review_actions', () => {
      const reviewCount = db.raw
        .prepare('SELECT COUNT(*) as n FROM review_actions')
        .get() as { n: number };
      expect(reviewCount.n).toBe(0);
    });

    it('training questions table has no question_text column (only index + rule_hit)', () => {
      const cols = db.raw
        .prepare('PRAGMA table_info(training_questions)')
        .all() as { name: string }[];
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('question_index');
      expect(colNames).toContain('disclosure_rule_hit');
      // No column should resemble question text storage
      expect(colNames).not.toContain('question_text');
      expect(colNames).not.toContain('question_body');
      expect(colNames).not.toContain('content');
    });

    it('training_summaries stores only a hash, not the summary body', () => {
      const cols = db.raw
        .prepare('PRAGMA table_info(training_summaries)')
        .all() as { name: string }[];
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('summary_hash');
      expect(colNames).not.toContain('summary_text');
      expect(colNames).not.toContain('summary_body');
      expect(colNames).not.toContain('content');
    });

    it('product_events table is separate from entity_change_logs', () => {
      // Both tables exist independently
      const peCols = db.raw
        .prepare('PRAGMA table_info(product_events)')
        .all() as { name: string }[];
      const peNames = peCols.map((c) => c.name);
      const eclCols = db.raw
        .prepare('PRAGMA table_info(entity_change_logs)')
        .all() as { name: string }[];
      const eclNames = eclCols.map((c) => c.name);

      // product_events has analytics-specific columns
      expect(peNames).toContain('attributes_json');
      expect(peNames).toContain('analytics_session_id');
      expect(peNames).toContain('expires_at');
      // entity_change_logs has audit-specific columns
      expect(eclNames).toContain('field_changes_json');
      expect(eclNames).toContain('entity_type');
      // The two tables have distinct column sets
      expect(eclNames).not.toContain('analytics_session_id');
      expect(peNames).not.toContain('entity_type');
    });
  });
});
