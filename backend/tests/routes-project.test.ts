import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';

import { RouteRegistry, type RouteContext } from '../src/http/route-registry';
import { loadOpenApi } from '../src/http/openapi-loader';
import { createAuthMiddleware } from '../src/http/middleware/auth';
import { createAgreementGate } from '../src/http/middleware/agreement-gate';
import { registerProjectRoutes } from '../src/http/routes/v1';
import { createTestDb, type AppDb } from './helpers/test-db';
import { ProjectRepo } from '../src/repo/project-repo';
import { MemberRepo } from '../src/repo/member-repo';
import { IntakeRepo } from '../src/repo/intake-repo';
import { SourceRepo } from '../src/repo/source-repo';
import { EvidenceRepo } from '../src/repo/evidence-repo';
import { UserRepo } from '../src/repo/user-repo';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { AgreementRepo } from '../src/repo/agreement-repo';
import { FormalMapRepo, parseFormalSnapshot } from '../src/repo/formal-map-repo';
import { JobRepo } from '../src/repo/job-repo';
import { agreementVersions } from '../src/db/schema/identity';
import { env } from '../src/config/env';
import { now } from '../src/shared/time';
import { generateId } from '../src/shared/id';

/**
 * Route-level tests for the project / intake / member / source / evidence
 * endpoints (Task 16-17, 12 operationIds).
 *
 * Builds a standalone Fastify app with the RouteRegistry wired to an in-memory
 * SQLite database, the auth middleware (cookie-based actor resolution) and the
 * agreement gate (consent enforcement for createProject).
 */
describe('project routes (Task 16-17)', () => {
  let db: AppDb;
  let app: FastifyInstance;
  let userRepo: UserRepo;
  let agreementRepo: AgreementRepo;
  let evidenceRepo: EvidenceRepo;
  let sourceRepo: SourceRepo;

  // User fixtures.
  let ownerId: string;
  let nonMemberId: string;
  let secondMemberId: string;
  let noConsentId: string;
  let agreementVersionId: string;

  beforeAll(async () => {
    db = createTestDb();

    // ── Wire up the app with the RouteRegistry ────────────────────────────
    app = Fastify({ logger: false });
    await app.register(cookie);

    userRepo = new UserRepo(db.db);
    agreementRepo = new AgreementRepo(db.db);
    evidenceRepo = new EvidenceRepo(db.db);
    sourceRepo = new SourceRepo(db.db);
    const guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);

    const auth = createAuthMiddleware({ userRepo, guestSessionRepo });
    const agreementGate = createAgreementGate({ agreementRepo });

    const registry = new RouteRegistry(loadOpenApi());
    registerProjectRoutes(registry, {
      projectRepo: new ProjectRepo(db.db),
      memberRepo: new MemberRepo(db.db),
      intakeRepo: new IntakeRepo(db.db),
      sourceRepo,
      evidenceRepo,
      userRepo,
      jobRepo: new JobRepo(db.db),
      formalMapRepo: new FormalMapRepo(db.db),
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

    const nonMember = await userRepo.create({
      displayName: 'Outsider',
      authSubject: 'auth|outsider',
      email: 'outsider@example.com',
    });
    nonMemberId = nonMember.id;

    const secondMember = await userRepo.create({
      displayName: 'Member Two',
      authSubject: 'auth|member2',
      email: 'member2@example.com',
    });
    secondMemberId = secondMember.id;

    const noConsent = await userRepo.create({
      displayName: 'No Consent',
      authSubject: 'auth|noconsent',
    });
    noConsentId = noConsent.id;

    // ── Seed agreement version + consent for owner ────────────────────────
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
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function inject(
    method: string,
    url: string,
    opts: {
      body?: unknown;
      cookies?: Record<string, string>;
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

  // ── createProject ───────────────────────────────────────────────────────────

  describe('POST /api/v1/projects (createProject)', () => {
    it('returns 202 + job_id when authenticated with agreement consent', async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: {
          initial_request: '我们需要构建一个面向社区医院的在线问诊平台。',
          name: '在线问诊系统',
          candidate_roles: [],
          candidate_constraints: [],
        },
        ...asOwner(),
      });

      expect(res.statusCode).toBe(202);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.project_id).toMatch(/^prj_/);
      expect(res.body.data.job_id).toMatch(/^job_/);
      expect(res.body.data.status).toBe('queued');
      expect(res.body.data.status_url).toMatch(/^\/api\/v1\/ai-jobs\/job_/);
    });

    it('auto-creates an Owner member with full capabilities', async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: '第二个项目测试 Owner 成员。' },
        ...asOwner(),
      });
      const projectId = res.body.data.project_id;

      const memberRepo = new MemberRepo(db.db);
      const member = memberRepo.findMember(projectId, ownerId);
      expect(member).not.toBeNull();
      expect(member!.status).toBe('active');
      const caps = JSON.parse(member!.capabilitiesJson) as string[];
      expect(caps).toEqual(
        expect.arrayContaining([
          'read',
          'edit',
          'review',
          'export',
          'manage_members',
        ]),
      );
    });

    it('rejects custom projects when the initial request is not meaningful', async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: {
          initial_request: '123123',
          source_kind: 'custom',
        },
        ...asOwner(),
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.initial_request).toContain('不够像一个项目需求');
    });

    it('creates sample projects with a deterministic map and no queued AI job', async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: {
          initial_request: '园区访客提前预约后，到现场扫码通行，安保需要核验异常并保留记录。',
          name: '园区访客预约与通行',
          source_kind: 'sample',
          source_case_id: 'aster',
          candidate_roles: ['园区运营负责人', '安保主管'],
          candidate_constraints: ['峰会前需要可演示版本'],
        },
        ...asOwner(),
      });

      expect(res.statusCode).toBe(202);
      expect(res.body.data.project_id).toMatch(/^prj_/);
      expect(res.body.data.job_id).toBeNull();
      expect(res.body.data.status).toBe('accepted');
      expect(res.body.data.map_snapshot_id).toMatch(/^fms_/);

      const formalMapRepo = new FormalMapRepo(db.db);
      const latest = formalMapRepo.findLatestSnapshot(res.body.data.project_id);
      expect(latest).not.toBeNull();
      expect(latest!.aiJobId).toBeNull();
      expect(latest!.status).toBe('fallback');

      const snapshot = parseFormalSnapshot(latest) as any;
      expect(snapshot.result_type).toBe('formal_map_snapshot');
      expect(snapshot.reportProjection?.overview).toContain('园区访客');
      expect(formalMapRepo.listTurns(res.body.data.project_id).some((turn) => turn.role === 'ai')).toBe(true);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: '未登录测试。' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: '无协议同意测试。' },
        cookies: { auth_session: noConsentId },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
    });
  });

  // ── getProject ──────────────────────────────────────────────────────────────

  describe('GET /api/v1/projects/:id (getProject)', () => {
    let projectId: string;

    beforeAll(async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: 'getProject 测试项目。' },
        ...asOwner(),
      });
      projectId = res.body.data.project_id;
    });

    it('returns project details for a member', async () => {
      const res = await inject(
        'GET',
        `/api/v1/projects/${projectId}`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(projectId);
      expect(res.body.data.status).toBe('Draft');
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.owner_id).toBe(ownerId);
      expect(res.body.data.risk_level).toBe('unknown');
      expect(res.body.data.blockers).toEqual([]);
    });

    it('returns 403 for a non-member', async () => {
      const res = await inject(
        'GET',
        `/api/v1/projects/${projectId}`,
        { cookies: { auth_session: nonMemberId } },
      );
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ── updateProject ───────────────────────────────────────────────────────────

  describe('PATCH /api/v1/projects/:id (updateProject)', () => {
    let projectId: string;

    beforeAll(async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: 'updateProject 测试项目。' },
        ...asOwner(),
      });
      projectId = res.body.data.project_id;
    });

    it('returns 200 with the updated project when expected_version matches', async () => {
      const res = await inject('PATCH', `/api/v1/projects/${projectId}`, {
        body: {
          name: '更新后的名称',
          risk_level: 'high',
          expected_version: 1,
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.name).toBe('更新后的名称');
      expect(res.body.data.risk_level).toBe('high');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 VERSION_CONFLICT when expected_version is stale', async () => {
      const res = await inject('PATCH', `/api/v1/projects/${projectId}`, {
        body: {
          name: '冲突测试',
          expected_version: 1,
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  // ── createIntake ────────────────────────────────────────────────────────────

  describe('POST /api/v1/projects/:id/intakes (createIntake)', () => {
    let projectId: string;
    let firstIntakeId: string;

    beforeAll(async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: 'createIntake 初始需求。' },
        ...asOwner(),
      });
      projectId = res.body.data.project_id;
      // The initial intake (v1) is created by createProject.
      const intakeRepo = new IntakeRepo(db.db);
      const latest = intakeRepo.findLatest(projectId);
      firstIntakeId = latest!.id;
    });

    it('returns 201 with a non-empty content_hash and supersedes the previous version', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/intakes`,
        {
          body: {
            original_text: '补充说明：系统需支持多院区协同。',
            decision_intent: '确认多院区部署方案',
            supersedes_intake_id: firstIntakeId,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.id).toMatch(/^int_/);
      expect(res.body.data.intake_version).toBe(2);
      expect(res.body.data.content_hash).toBeTruthy();
      expect(res.body.data.content_hash).toHaveLength(64);
      expect(res.body.data.supersedes_intake_id).toBe(firstIntakeId);
    });
  });

  // ── listMembers ─────────────────────────────────────────────────────────────

  describe('GET /api/v1/projects/:id/members (listMembers)', () => {
    let projectId: string;

    beforeAll(async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: 'listMembers 测试项目。' },
        ...asOwner(),
      });
      projectId = res.body.data.project_id;
    });

    it('returns the Owner member in the list', async () => {
      const res = await inject(
        'GET',
        `/api/v1/projects/${projectId}/members`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const owner = res.body.data.find(
        (m: any) => m.user_id === ownerId,
      );
      expect(owner).toBeDefined();
      expect(owner.display_name).toBe('Owner');
      expect(owner.email).toBe('owner@example.com');
      expect(owner.capabilities).toEqual(
        expect.arrayContaining(['read', 'edit', 'manage_members']),
      );
      expect(owner.status).toBe('active');
    });
  });

  // ── addMember + updateMember ────────────────────────────────────────────────

  describe('POST + PATCH members', () => {
    let projectId: string;

    beforeAll(async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: '成员管理测试项目。' },
        ...asOwner(),
      });
      projectId = res.body.data.project_id;
    });

    it('adds a member with read+review capabilities', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/members`,
        {
          body: {
            user_id: secondMemberId,
            capabilities: ['read', 'review'],
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.user_id).toBe(secondMemberId);
      expect(res.body.data.display_name).toBe('Member Two');
      expect(res.body.data.capabilities).toEqual(['read', 'review']);
      expect(res.body.data.version).toBe(1);
    });

    it('updates the member capabilities with expected_version', async () => {
      const res = await inject(
        'PATCH',
        `/api/v1/projects/${projectId}/members/${secondMemberId}`,
        {
          body: {
            capabilities: ['read', 'edit', 'review', 'export'],
            status: 'active',
            expected_version: 1,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.capabilities).toEqual([
        'read',
        'edit',
        'review',
        'export',
      ]);
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 VERSION_CONFLICT on stale member version', async () => {
      const res = await inject(
        'PATCH',
        `/api/v1/projects/${projectId}/members/${secondMemberId}`,
        {
          body: {
            capabilities: ['read'],
            expected_version: 1,
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  // ── listSources + uploadSource ──────────────────────────────────────────────

  describe('GET + POST sources', () => {
    let projectId: string;

    beforeAll(async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: '来源上传测试项目。' },
        ...asOwner(),
      });
      projectId = res.body.data.project_id;
    });

    it('uploads a text source and returns 201', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/sources`,
        {
          body: {
            file_name: '需求记录.txt',
            media_type: 'text/plain',
            source_type: 'document',
            sensitivity: 'internal',
            content: '系统响应时间应在 200ms 以内。',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.id).toMatch(/^src_/);
      expect(res.body.data.file_name).toBe('需求记录.txt');
      expect(res.body.data.media_type).toBe('text/plain');
      expect(res.body.data.source_type).toBe('document');
      expect(res.body.data.sensitivity).toBe('internal');
      expect(res.body.data.extraction_status).toBe('uploaded');
      expect(res.body.data.blob_id).toMatch(/^blb_/);
      expect(res.body.data.byte_size).toBeGreaterThan(0);
      expect(res.body.data.sha256).toHaveLength(64);
      expect(res.body.data.created_by).toBe(ownerId);
    });

    it('rejects an unsupported media type with 400', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/sources`,
        {
          body: {
            file_name: 'evil.exe',
            media_type: 'application/x-msdownload',
            source_type: 'document',
            sensitivity: 'internal',
            content: 'MZ',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a PDF with a mismatched file signature', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/sources`,
        {
          body: {
            file_name: 'fake.pdf',
            media_type: 'application/pdf',
            source_type: 'document',
            sensitivity: 'internal',
            content: 'this is not a real PDF',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('lists the uploaded source', async () => {
      const res = await inject(
        'GET',
        `/api/v1/projects/${projectId}/sources`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const src = res.body.data[0];
      expect(src.file_name).toBe('需求记录.txt');
      expect(src.byte_size).toBeGreaterThan(0);
    });
  });

  // ── getEvidence ─────────────────────────────────────────────────────────────

  describe('GET /api/v1/evidence/:id (getEvidence)', () => {
    let evidenceId: string;

    beforeAll(async () => {
      // Create a project + source + evidence span via repos.
      const projectRepo = new ProjectRepo(db.db);
      const project = projectRepo.create({ ownerId });
      // Grant owner read capability is already done by create().
      const blob = sourceRepo.createBlob({
        sha256: 'a'.repeat(64),
        size: 10,
        mediaType: 'text/plain',
        storagePath: 'blobs/test',
      });
      const source = sourceRepo.create({
        projectId: project.id,
        blobId: blob.id,
        filename: 'evidence-source.txt',
        mediaType: 'text/plain',
        submittedBy: ownerId,
      });
      const span = evidenceRepo.createSpan({
        sourceId: source.id,
        startOffset: 0,
        endOffset: 20,
        content: '系统响应时间≤200ms',
      });
      evidenceId = span.id;
    });

    it('returns the evidence span for a member with read capability', async () => {
      // The owner is automatically a member of the project created above.
      const res = await inject(
        'GET',
        `/api/v1/evidence/${evidenceId}`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(evidenceId);
      expect(res.body.data.source_id).toBeDefined();
      expect(res.body.data.coordinate_space).toBe(
        'normalized_unicode_codepoint_v1',
      );
      expect(res.body.data.exact_text).toBe('系统响应时间≤200ms');
      expect(res.body.data.span_hash).toHaveLength(64);
    });

    it('returns 404 for a non-existent evidence span', async () => {
      const res = await inject(
        'GET',
        '/api/v1/evidence/ev_does_not_exist',
        asOwner(),
      );
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── deleteProject + getDeleteTask ───────────────────────────────────────────

  describe('DELETE /api/v1/projects/:id + GET /api/v1/delete-tasks/:id', () => {
    let projectId: string;
    let deleteTaskId: string;

    beforeAll(async () => {
      const res = await inject('POST', '/api/v1/projects', {
        body: { initial_request: '删除测试项目。' },
        ...asOwner(),
      });
      projectId = res.body.data.project_id;
    });

    it('soft-deletes the project and returns 202 with a delete_task_id', async () => {
      const res = await inject(
        'DELETE',
        `/api/v1/projects/${projectId}`,
        asOwner(),
      );
      expect(res.statusCode).toBe(202);
      expect(res.body.data.delete_task_id).toMatch(/^dt_/);
      expect(res.body.data.scope).toBe('formal_project');
      expect(res.body.data.target_id).toBe(projectId);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.estimated_purge_at).toBeTruthy();
      deleteTaskId = res.body.data.delete_task_id;
    });

    it('returns 403 when a non-Owner tries to delete', async () => {
      // Create a project owned by owner, then try to delete as non-member.
      const createRes = await inject('POST', '/api/v1/projects', {
        body: { initial_request: '权限测试项目。' },
        ...asOwner(),
      });
      const res = await inject('DELETE', `/api/v1/projects/${createRes.body.data.project_id}`, {
        cookies: { auth_session: nonMemberId },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns the delete-task status via GET /api/v1/delete-tasks/:id', async () => {
      const res = await inject(
        'GET',
        `/api/v1/delete-tasks/${deleteTaskId}`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data.delete_task_id).toBe(deleteTaskId);
      expect(res.body.data.scope).toBe('formal_project');
      expect(res.body.data.target_id).toBe(projectId);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.legal_hold).toBe(false);
      expect(res.body.data.estimated_purge_at).toBeTruthy();
    });
  });
});
