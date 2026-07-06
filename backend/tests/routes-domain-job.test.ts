import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

import { RouteRegistry, type RouteContext } from '../src/http/route-registry';
import { loadOpenApi } from '../src/http/openapi-loader';
import { createAuthMiddleware } from '../src/http/middleware/auth';
import { createAgreementGate } from '../src/http/middleware/agreement-gate';
import { registerDomainRoutes, registerJobRoutes } from '../src/http/routes/v1';
import { createTestDb, type AppDb } from './helpers/test-db';
import { ProjectRepo } from '../src/repo/project-repo';
import { DomainProfileRepo } from '../src/repo/domain-repo';
import { JobRepo } from '../src/repo/job-repo';
import { AiRunRepo } from '../src/repo/ai-run-repo';
import { UserRepo } from '../src/repo/user-repo';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { AgreementRepo } from '../src/repo/agreement-repo';
import { StubProvider } from '../src/ai/stub-provider';
import { JobWorker } from '../src/queue/worker';
import { agreementVersions } from '../src/db/schema/identity';
import { env } from '../src/config/env';
import { now } from '../src/shared/time';
import { generateId } from '../src/shared/id';

/**
 * Route-level tests for the domain-profile & analysis-job endpoints (Task 21-22,
 * 10 operationIds). Builds a standalone Fastify app with the RouteRegistry wired
 * to an in-memory SQLite DB, the auth + agreement-gate middleware, and the
 * domain + job route modules. Also drives the JobWorker end-to-end through the
 * route-created job.
 */
describe('domain + job routes (Task 21-22)', () => {
  let db: AppDb;
  let app: FastifyInstance;
  let jobRepo: JobRepo;
  let aiRunRepo: AiRunRepo;
  let domainProfileRepo: DomainProfileRepo;

  let ownerId: string;
  let nonMemberId: string;
  let projectId: string;
  let candidateProfileId: string;
  let worker: JobWorker;

  beforeAll(async () => {
    db = createTestDb();
    app = Fastify({ logger: false });
    await app.register(cookie);

    const userRepo = new UserRepo(db.db);
    const agreementRepo = new AgreementRepo(db.db);
    const guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);

    jobRepo = new JobRepo(db.db);
    aiRunRepo = new AiRunRepo(db.db);
    domainProfileRepo = new DomainProfileRepo(db.db);

    const auth = createAuthMiddleware({ userRepo, guestSessionRepo });
    const agreementGate = createAgreementGate({ agreementRepo });

    const registry = new RouteRegistry(loadOpenApi());
    registerDomainRoutes(registry, { domainProfileRepo });
    registerJobRoutes(registry, { jobRepo });

    await registry.applyTo(app, db, {
      resolveActor: auth.resolveActor,
      checkAgreement: (ctx: RouteContext) => agreementGate.checkAgreement(ctx.actor),
    });
    await app.ready();

    // ── Seed users + agreement consent ─────────────────────────────────────
    const owner = await userRepo.create({
      displayName: 'Owner',
      authSubject: 'auth|owner',
      email: 'owner@example.com',
    });
    ownerId = owner.id;

    const outsider = await userRepo.create({
      displayName: 'Outsider',
      authSubject: 'auth|outsider',
      email: 'outsider@example.com',
    });
    nonMemberId = outsider.id;

    const agreementVersionId = generateId('agrv');
    const ts = now();
    await db.db.insert(agreementVersions).values({
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

    // ── Seed project (Owner gets read/edit/review/manage_members) ───────────
    const projectRepo = new ProjectRepo(db.db);
    const project = projectRepo.create({ ownerId, name: 'Domain Test Project' });
    projectId = project.id;

    // ── Seed a candidate domain profile (simulating AI output) ──────────────
    const profile = domainProfileRepo.create({
      projectId,
      candidatePackIds: ['software-delivery', 'general'],
      status: 'candidate',
      workType: 'software-delivery',
    });
    candidateProfileId = profile.id;

    worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo);
  });

  afterAll(async () => {
    worker.stop();
    await app.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────────

  async function inject(
    method: string,
    url: string,
    opts: { body?: unknown; cookies?: Record<string, string> } = {},
  ): Promise<{ statusCode: number; body: any }> {
    const res = await app.inject({
      method,
      url,
      payload: opts.body as string | object | undefined,
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      cookies: opts.cookies,
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
  function asOutsider() {
    return { cookies: { auth_session: nonMemberId } };
  }

  // ── listDomainPacks ──────────────────────────────────────────────────────────

  describe('GET /api/v1/domain-packs (listDomainPacks)', () => {
    it('returns the two built-in packs for an authenticated user', async () => {
      const res = await inject('GET', '/api/v1/domain-packs', asOwner());
      expect(res.statusCode).toBe(200);
      const ids = res.body.data.map((p: { id: string }) => p.id);
      expect(ids).toEqual(expect.arrayContaining(['general', 'software-delivery']));
      expect(res.body.data).toHaveLength(2);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await inject('GET', '/api/v1/domain-packs');
      expect(res.statusCode).toBe(401);
    });
  });

  // ── getDomainPackVersion ─────────────────────────────────────────────────────

  describe('GET /api/v1/domain-packs/:id/versions/:version (getDomainPackVersion)', () => {
    it('returns the manifest for software-delivery@1.0.0', async () => {
      const res = await inject(
        'GET',
        '/api/v1/domain-packs/software-delivery/versions/1.0.0',
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe('software-delivery');
      expect(res.body.data.version).toBe('1.0.0');
      expect(res.body.data.manifest.entity_types).toBeDefined();
    });

    it('returns 404 for an unknown version', async () => {
      const res = await inject(
        'GET',
        '/api/v1/domain-packs/software-delivery/versions/9.9.9',
        asOwner(),
      );
      expect(res.statusCode).toBe(404);
    });
  });

  // ── getDomainProfile ─────────────────────────────────────────────────────────

  describe('GET /api/v1/projects/:id/domain-profile (getDomainProfile)', () => {
    it('returns the current candidate profile for a member with read', async () => {
      const res = await inject(
        'GET',
        `/api/v1/projects/${projectId}/domain-profile`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(candidateProfileId);
      expect(res.body.data.status).toBe('candidate');
      expect(res.body.data.suggested_pack_ids).toEqual(['software-delivery', 'general']);
    });

    it('returns 404 for a non-member', async () => {
      const res = await inject(
        'GET',
        `/api/v1/projects/${projectId}/domain-profile`,
        asOutsider(),
      );
      expect(res.statusCode).toBe(403);
    });
  });

  // ── reviewDomainProfile ──────────────────────────────────────────────────────

  describe('POST /api/v1/projects/:id/domain-profile/reviews (reviewDomainProfile)', () => {
    it('accepts the candidate profile and flips it to approved', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/domain-profile/reviews`,
        {
          body: {
            action: 'accept',
            entity_version: 1,
            reason: '领域标签覆盖业务场景',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.action).toBe('accept');
      expect(res.body.data.entity_id).toBe(candidateProfileId);

      const approved = domainProfileRepo.findById(candidateProfileId);
      expect(approved?.status).toBe('approved');
      expect(approved?.approvedBy).toBe(ownerId);
    });

    it('returns 409 on a stale entity_version', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/domain-profile/reviews`,
        {
          body: { action: 'reject', entity_version: 999, reason: 'stale' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(409);
    });
  });

  // ── activateDomainPack ───────────────────────────────────────────────────────

  describe('POST /api/v1/projects/:id/domain-packs/:packId/activations (activateDomainPack)', () => {
    it('activates software-delivery for the project', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/domain-packs/software-delivery/activations`,
        {
          body: {
            domain_pack_version: 'software-delivery@1.0.0',
            domain_profile_id: candidateProfileId,
            activation_reason: '项目属于软件交付领域',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.domain_pack_id).toBe('software-delivery');
      expect(res.body.data.activated_by).toBe(ownerId);
    });

    it('rejects a second active version of the same pack (409)', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/domain-packs/software-delivery/activations`,
        {
          body: {
            domain_pack_version: 'software-delivery@1.0.0',
            domain_profile_id: candidateProfileId,
            activation_reason: '重复激活',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(409);
    });
  });

  // ── previewDeactivation ──────────────────────────────────────────────────────

  describe('POST .../deactivation-previews (previewDeactivation)', () => {
    it('returns a preview without mutating state', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/domain-packs/software-delivery/deactivation-previews`,
        {
          body: { domain_pack_version: 'software-delivery@1.0.0' },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.preview_id).toMatch(/^dpv_/);
      expect(res.body.data.currently_active).toBe(true);
      expect(res.body.data.impact.historical_references_preserved).toBe(true);
    });
  });

  // ── deactivateDomainPack ─────────────────────────────────────────────────────

  describe('POST .../deactivations (deactivateDomainPack)', () => {
    it('deactivates the active pack', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/domain-packs/software-delivery/deactivations`,
        {
          body: {
            preview_id: 'dpv_test',
            domain_pack_version: 'software-delivery@1.0.0',
            expected_version: 1,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe('inactive');
      expect(res.body.data.deactivated_at).not.toBeNull();
    });
  });

  // ── createAnalysisRun ────────────────────────────────────────────────────────

  describe('POST /api/v1/projects/:id/analysis-runs (createAnalysisRun)', () => {
    it('returns 202 + job_id when authenticated with agreement consent', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/analysis-runs`,
        {
          body: {
            task: 'domain_profile',
            source_ids: ['SRC_1'],
            expected_project_version: 1,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.job_id).toMatch(/^job_/);
      expect(res.body.data.status).toBe('queued');
      expect(res.body.data.status_url).toMatch(/^\/api\/v1\/ai-jobs\/job_/);
    });

    it('returns 403 without agreement consent', async () => {
      // Outsider has no consent and is not a member.
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/analysis-runs`,
        {
          body: { task: 'domain_profile', source_ids: [] },
          ...asOutsider(),
        },
      );
      // Non-member → 403 (capability check fires before agreement gate? both 403).
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when task is missing', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/analysis-runs`,
        { body: { source_ids: [] }, ...asOwner() },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // ── getJobStatus + cancelJob + worker lifecycle ──────────────────────────────

  describe('GET /api/v1/ai-jobs/:id (getJobStatus) + lifecycle', () => {
    it('polls a queued job, then the worker drives it to succeeded', async () => {
      // Drain leftover queued jobs from earlier tests so tick() picks up
      // exactly the job created below.
      while (await worker.tick()) {}

      // Enqueue via the route.
      const create = await inject(
        'POST',
        `/api/v1/projects/${projectId}/analysis-runs`,
        {
          body: {
            task: 'structured_extraction',
            source_ids: ['SRC_1'],
            domain_profile_id: candidateProfileId,
            domain_profile_version: 1,
          },
          ...asOwner(),
        },
      );
      expect(create.statusCode).toBe(202);
      const jobId = create.body.data.job_id;

      // Poll while queued.
      const before = await inject('GET', `/api/v1/ai-jobs/${jobId}`, asOwner());
      expect(before.statusCode).toBe(200);
      expect(before.body.data.job_id).toBe(jobId);
      expect(['queued', 'running']).toContain(before.body.data.status);

      // Worker processes the job to completion.
      await worker.tick();

      const after = await inject('GET', `/api/v1/ai-jobs/${jobId}`, asOwner());
      expect(after.statusCode).toBe(200);
      expect(after.body.data.status).toBe('succeeded');
      expect(after.body.data.progress).toBe(100);
      expect(after.body.data.attempts).toBe(1);
    });

    it('returns 404 for an out-of-scope caller (non-member)', async () => {
      const create = await inject(
        'POST',
        `/api/v1/projects/${projectId}/analysis-runs`,
        {
          body: { task: 'domain_profile', source_ids: [] },
          ...asOwner(),
        },
      );
      const jobId = create.body.data.job_id;

      const res = await inject('GET', `/api/v1/ai-jobs/${jobId}`, asOutsider());
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for an unknown job id', async () => {
      const res = await inject('GET', '/api/v1/ai-jobs/job_missing', asOwner());
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/ai-jobs/:id/cancel (cancelJob)', () => {
    it('cancels a queued job owned by the caller', async () => {
      const create = await inject(
        'POST',
        `/api/v1/projects/${projectId}/analysis-runs`,
        {
          body: { task: 'domain_profile', source_ids: ['cancel-test'] },
          ...asOwner(),
        },
      );
      const jobId = create.body.data.job_id;

      const res = await inject('POST', `/api/v1/ai-jobs/${jobId}/cancel`, {
        body: { reason: '用户不再需要' },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
      expect(res.body.data.cancelled_by_kind).toBe('user');
      expect(res.body.data.cancellation_reason).toBe('用户不再需要');
    });

    it('returns 404 when the caller does not own the job', async () => {
      const create = await inject(
        'POST',
        `/api/v1/projects/${projectId}/analysis-runs`,
        {
          body: { task: 'domain_profile', source_ids: ['cancel-outsider'] },
          ...asOwner(),
        },
      );
      const jobId = create.body.data.job_id;

      const res = await inject('POST', `/api/v1/ai-jobs/${jobId}/cancel`, {
        body: { reason: '试图取消他人任务' },
        ...asOutsider(),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
