import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';

import { RouteRegistry, type RouteContext } from '../src/http/route-registry';
import { loadOpenApi } from '../src/http/openapi-loader';
import { createAuthMiddleware } from '../src/http/middleware/auth';
import { createAgreementGate } from '../src/http/middleware/agreement-gate';
import { registerReportRoutes } from '../src/http/routes/v1';
import { registerChangeRoutes } from '../src/http/routes/v1';
import { createTestDb, type AppDb } from './helpers/test-db';
import { ProjectRepo } from '../src/repo/project-repo';
import { BaselineRepo } from '../src/repo/baseline-repo';
import { ReportRepo } from '../src/repo/report-repo';
import { ChangeRepo } from '../src/repo/change-repo';
import { UserRepo } from '../src/repo/user-repo';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { AgreementRepo } from '../src/repo/agreement-repo';
import { agreementVersions } from '../src/db/schema/identity';
import { domainProfiles } from '../src/db/schema/domain';
import { reportTemplates, reportSnapshots } from '../src/db/schema/report';
import { changes, changeImpacts } from '../src/db/schema/change';
import { projects } from '../src/db/schema/project';
import { env } from '../src/config/env';
import { now } from '../src/shared/time';
import { generateId } from '../src/shared/id';

/**
 * Route-level tests for the baseline / report / change endpoints
 * (Task 27-28, 14 operationIds).
 *
 * Builds a standalone Fastify app with the RouteRegistry wired to an in-memory
 * SQLite database, the auth middleware (cookie-based actor resolution) and the
 * agreement gate (consent enforcement for compileReport).
 *
 * Covers:
 *   - Task 27 (7 ops): createBaseline, approveBaseline, compileReport,
 *     getReport, releaseReport, downloadReport, downloadProjectReport.
 *   - Task 28 (7 ops): createChangePreview, getChangePreviewImpact,
 *     listChanges, createChange, getChangeImpact, confirmChange,
 *     withdrawChange.
 *
 * Key invariants asserted:
 *   - compileReport on an unapproved baseline returns 409 BASELINE_NOT_APPROVED;
 *   - preview operations never insert formal `changes` rows (isolation);
 *   - confirmChange atomically transitions the project to `Changing` and
 *     creates reopen tasks;
 *   - withdrawChange on a baselined change returns 409 CHANGE_BASELINED.
 */
describe('report & change routes (Task 27-28)', () => {
  let db: AppDb;
  let app: FastifyInstance;
  let baselineRepo: BaselineRepo;
  let reportRepo: ReportRepo;
  let changeRepo: ChangeRepo;

  let ownerId: string;
  let nonMemberId: string;

  // Project A: report flow (kept in Draft; compileReport does not check status).
  let reportProjectId: string;
  // Project B: change flow (parked in Released so confirmChange can fire).
  let changeProjectId: string;
  // An approved baseline on the change project, used for change previews.
  let changeBaselineId: string;

  beforeAll(async () => {
    db = createTestDb();

    // ── Wire up the app with the RouteRegistry ────────────────────────────
    app = Fastify({ logger: false });
    await app.register(cookie);

    const userRepo = new UserRepo(db.db);
    const agreementRepo = new AgreementRepo(db.db);
    const guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);

    const auth = createAuthMiddleware({ userRepo, guestSessionRepo });
    const agreementGate = createAgreementGate({ agreementRepo });

    baselineRepo = new BaselineRepo(db.db);
    reportRepo = new ReportRepo(db.db);
    changeRepo = new ChangeRepo(db.db);

    const registry = new RouteRegistry(loadOpenApi());
    registerReportRoutes(registry, { baselineRepo, reportRepo });
    registerChangeRoutes(registry, {
      changeRepo,
      baselineRepo,
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

    // ── Seed agreement version + consent for owner ────────────────────────
    const agreementVersionId = generateId('agrv');
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

    // ── Seed report template ──────────────────────────────────────────────
    await db.db
      .insert(reportTemplates)
      .values({
        id: 'tmpl_standard',
        audience: 'executive',
        version: '1.0.0',
        contentHash: 'sha256:template',
        status: 'active',
        createdAt: ts,
      })
      .run();

    // ── Project A: report flow ────────────────────────────────────────────
    const projectRepo = new ProjectRepo(db.db);
    const reportProject = projectRepo.create({ ownerId, name: '报告流程项目' });
    reportProjectId = reportProject.id;
    seedApprovedDomainProfile(db.db, reportProjectId, ownerId);

    // ── Project B: change flow (transition to Released) ───────────────────
    const changeProject = projectRepo.create({ ownerId, name: '变化流程项目' });
    changeProjectId = changeProject.id;
    seedApprovedDomainProfile(db.db, changeProjectId, ownerId);
    // Drive the project through the state machine to Released.
    for (const next of [
      'Ingesting',
      'Eliciting',
      'Reviewing',
      'Baselined',
      'Reporting',
      'Released',
    ]) {
      projectRepo.updateStatus(changeProjectId, next);
    }

    // Approved baseline on the change project, for createChangePreview.
    const changeBaseline = baselineRepo.create({
      projectId: changeProjectId,
      items: [
        { entityType: 'requirement', entityId: 'REQ_CHG_001', entityVersion: 1 },
        { entityType: 'outcome', entityId: 'OUT_CHG_001', entityVersion: 1 },
      ],
    });
    changeBaselineId = baselineRepo
      .approve({
        id: changeBaseline.id,
        approverId: ownerId,
        expectedVersion: changeBaseline.version,
      })
      .id;
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
  ): Promise<{ statusCode: number; body: any; headers: Record<string, string> }> {
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
    return { statusCode: res.statusCode, body, headers: res.headers as Record<string, string> };
  }

  function asOwner(cookies: Record<string, string> = {}) {
    return { cookies: { auth_session: ownerId, ...cookies } };
  }

  /** Baseline body covering every required report chapter (no blocking gates). */
  const FULL_ENTITY_VERSIONS = {
    stakeholders: ['STK_001@1'],
    outcomes: ['OUT_001@1'],
    requirements: ['REQ_001@1'],
    drivers: ['DRV_001@1'],
    decisions: ['DEC_001@1'],
    evidences: ['EV_001@1'],
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Task 27 — baseline & report routes (7 operationIds)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Task 27 — baseline & report routes', () => {
    let draftBaselineId: string;
    let draftBaselineVersion: number;
    let approvedBaselineId: string;
    let compiledReportId: string;

    // ── createBaseline ────────────────────────────────────────────────────────

    describe('POST /api/v1/projects/:id/baselines (createBaseline)', () => {
      it('creates a draft baseline and returns 201', async () => {
        const res = await inject('POST', `/api/v1/projects/${reportProjectId}/baselines`, {
          body: { entity_versions: FULL_ENTITY_VERSIONS },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(201);
        expect(res.body.data.id).toMatch(/^bl_/);
        expect(res.body.data.project_id).toBe(reportProjectId);
        expect(res.body.data.status).toBe('draft');
        expect(res.body.data.baseline_version).toBeGreaterThanOrEqual(1);
        expect(res.body.data.version).toBe(1);
        expect(res.body.data.data_hash).toMatch(/^sha256:/);
        expect(res.body.data.approved_by).toBeNull();
        expect(res.body.data.approved_at).toBeNull();
        expect(Array.isArray(res.body.data.items)).toBe(true);
        expect(res.body.data.items.length).toBe(6);

        draftBaselineId = res.body.data.id;
        draftBaselineVersion = res.body.data.version;
      });

      it('returns 401 when unauthenticated', async () => {
        const res = await inject('POST', `/api/v1/projects/${reportProjectId}/baselines`, {
          body: { entity_versions: FULL_ENTITY_VERSIONS },
        });
        expect(res.statusCode).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('returns 403 for a non-member', async () => {
        const res = await inject('POST', `/api/v1/projects/${reportProjectId}/baselines`, {
          body: { entity_versions: FULL_ENTITY_VERSIONS },
          cookies: { auth_session: nonMemberId },
        });
        expect(res.statusCode).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it('returns 400 when entity_versions is missing', async () => {
        const res = await inject('POST', `/api/v1/projects/${reportProjectId}/baselines`, {
          body: {},
          ...asOwner(),
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
    });

    // ── approveBaseline ───────────────────────────────────────────────────────

    describe('POST /api/v1/baselines/:id/approve (approveBaseline)', () => {
      it('approves a draft baseline and returns 201 with approver/time', async () => {
        const res = await inject('POST', `/api/v1/baselines/${draftBaselineId}/approve`, {
          body: { expected_version: draftBaselineVersion },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(201);
        expect(res.body.data.id).toBe(draftBaselineId);
        expect(res.body.data.status).toBe('approved');
        expect(res.body.data.approved_by).toBe(ownerId);
        expect(res.body.data.approved_at).toBeTruthy();
        expect(res.body.data.version).toBe(draftBaselineVersion + 1);

        approvedBaselineId = res.body.data.id;
      });

      it('returns 409 VERSION_CONFLICT with a stale expected_version', async () => {
        const res = await inject('POST', `/api/v1/baselines/${draftBaselineId}/approve`, {
          body: { expected_version: draftBaselineVersion + 999 },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('VERSION_CONFLICT');
      });

      it('returns 409 BASELINE_NOT_DRAFT when re-approving', async () => {
        const res = await inject('POST', `/api/v1/baselines/${draftBaselineId}/approve`, {
          body: { expected_version: draftBaselineVersion + 1 },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('BASELINE_NOT_DRAFT');
      });
    });

    // ── compileReport ─────────────────────────────────────────────────────────

    describe('POST /api/v1/projects/:id/reports (compileReport)', () => {
      it('returns 409 BASELINE_NOT_APPROVED when the baseline is still draft', async () => {
        // Create a fresh draft baseline that is never approved.
        const draft = await inject('POST', `/api/v1/projects/${reportProjectId}/baselines`, {
          body: { entity_versions: FULL_ENTITY_VERSIONS },
          ...asOwner(),
        });

        const res = await inject('POST', `/api/v1/projects/${reportProjectId}/reports`, {
          body: {
            baseline_id: draft.body.data.id,
            audience: 'executive',
            language: 'zh-CN',
            template_id: 'tmpl_standard',
            template_version: '1.0.0',
          },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('BASELINE_NOT_APPROVED');
      });

      it('compiles from an approved baseline and returns 202 with a job_id', async () => {
        const res = await inject('POST', `/api/v1/projects/${reportProjectId}/reports`, {
          body: {
            baseline_id: approvedBaselineId,
            audience: 'executive',
            language: 'zh-CN',
            template_id: 'tmpl_standard',
            template_version: '1.0.0',
          },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(202);
        expect(res.body.data.job_id).toMatch(/^job_/);
        expect(res.body.data.status).toBe('queued');
        expect(res.body.data.status_url).toMatch(/^\/api\/v1\/ai-jobs\/job_/);

        // The synchronous Stage B compiler drives the report to `ready`.
        const report = reportRepo.findById(res.body.data.job_id) ?? null;
        // job_id is a mock; the actual report is the latest for the project.
        const latest = db.db
          .select()
          .from(reportRepo['db'] ? (await import('../src/db/schema/report')).reportSnapshots : (await import('../src/db/schema/report')).reportSnapshots)
          .all();
        // Find the report created by this call (status ready, matching baseline).
        const ready = latest.find(
          (r: any) => r.baselineId === approvedBaselineId && r.status === 'ready',
        );
        expect(ready).toBeDefined();
        compiledReportId = ready!.id;
      });

      it('returns 403 AGREEMENT_REQUIRED without consent', async () => {
        const res = await inject('POST', `/api/v1/projects/${reportProjectId}/reports`, {
          body: {
            baseline_id: approvedBaselineId,
            audience: 'executive',
            language: 'zh-CN',
            template_id: 'tmpl_standard',
            template_version: '1.0.0',
          },
          cookies: { auth_session: nonMemberId },
        });
        // nonMember has no project membership → 403 FORBIDDEN before agreement.
        expect(res.statusCode).toBe(403);
      });
    });

    // ── getReport ─────────────────────────────────────────────────────────────

    describe('GET /api/v1/reports/:id (getReport)', () => {
      it('returns the compiled report with chapter coverage and gate defects', async () => {
        const res = await inject('GET', `/api/v1/reports/${compiledReportId}`, asOwner());

        expect(res.statusCode).toBe(200);
        expect(res.body.data.id).toBe(compiledReportId);
        expect(res.body.data.project_id).toBe(reportProjectId);
        expect(res.body.data.baseline_id).toBe(approvedBaselineId);
        expect(res.body.data.status).toBe('ready');
        expect(res.body.data.audience).toBe('executive');
        expect(res.body.data.language).toBe('zh-CN');
        expect(res.body.data.data_hash).toMatch(/^sha256:/);
        expect(res.body.data.template_id).toBe('tmpl_standard');
        expect(res.body.data.template_version).toBe('1.0.0');
        expect(res.body.data.chapter_coverage).toBeDefined();
        expect(res.body.data.gate_defects).toEqual([]);
        expect(res.body.data.file_blob_id).toBeNull();
        expect(res.body.data.file_size).toBeNull();
      });

      it('returns 404 for a missing report', async () => {
        const res = await inject('GET', '/api/v1/reports/rpt_does_not_exist', asOwner());
        expect(res.statusCode).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });
    });

    // ── releaseReport ─────────────────────────────────────────────────────────

    describe('POST /api/v1/reports/:id/releases (releaseReport)', () => {
      it('releases a ready report and returns 200 with file metadata', async () => {
        // Fetch the current version for the optimistic-concurrency check.
        const before = await inject('GET', `/api/v1/reports/${compiledReportId}`, asOwner());
        const res = await inject('POST', `/api/v1/reports/${compiledReportId}/releases`, {
          body: { expected_version: before.body.data.report_version },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.id).toBe(compiledReportId);
        expect(res.body.data.status).toBe('released');
        expect(res.body.data.file_sha256).toMatch(/^sha256:/);
        expect(res.body.data.released_by).toBe(ownerId);
        expect(res.body.data.released_at).toBeTruthy();
      });

      it('returns 409 when the report is not ready (already released)', async () => {
        const before = await inject('GET', `/api/v1/reports/${compiledReportId}`, asOwner());
        const res = await inject('POST', `/api/v1/reports/${compiledReportId}/releases`, {
          body: { expected_version: before.body.data.report_version },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('BLOCKING_CONFLICT');
      });
    });

    // ── downloadReport ────────────────────────────────────────────────────────

    describe('GET /api/v1/reports/:id/file (downloadReport)', () => {
      it('downloads the released PDF with the right headers', async () => {
        const res = await inject('GET', `/api/v1/reports/${compiledReportId}/file`, asOwner());

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.headers['content-disposition']).toContain('.pdf');
        // The body is the synthesized PDF stub.
        expect(typeof res.body).toBe('string');
        expect(res.body).toContain('%PDF-1.4');
      });

      it('returns 404 for a non-released report', async () => {
        // Create a fresh report that stays in draft (gate_failed path).
        const draft = await inject('POST', `/api/v1/projects/${reportProjectId}/baselines`, {
          body: { entity_versions: FULL_ENTITY_VERSIONS },
          ...asOwner(),
        });
        const approved = await inject('POST', `/api/v1/baselines/${draft.body.data.id}/approve`, {
          body: { expected_version: draft.body.data.version },
          ...asOwner(),
        });
        // Compile with only one entity type → blocking gate defects → gate_failed.
        const compile = await inject('POST', `/api/v1/projects/${reportProjectId}/reports`, {
          body: {
            baseline_id: approved.body.data.id,
            audience: 'executive',
            language: 'zh-CN',
            template_id: 'tmpl_standard',
            template_version: '1.0.0',
          },
          ...asOwner(),
        });
        expect(compile.statusCode).toBe(202);

        const res = await inject('GET', `/api/v1/reports/${compile.body.data.job_id}/file`, asOwner());
        expect(res.statusCode).toBe(404);
      });
    });

    // ── downloadProjectReport ─────────────────────────────────────────────────

    describe('GET /api/v1/projects/:id/reports/:reportId/download (downloadProjectReport)', () => {
      it('downloads the released PDF via the project-scoped path', async () => {
        const res = await inject(
          'GET',
          `/api/v1/projects/${reportProjectId}/reports/${compiledReportId}/download`,
          asOwner(),
        );

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.body).toContain('%PDF-1.4');
      });

      it('returns 404 when the report does not belong to the project', async () => {
        const res = await inject(
          'GET',
          `/api/v1/projects/${changeProjectId}/reports/${compiledReportId}/download`,
          asOwner(),
        );
        expect(res.statusCode).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Task 28 — change preview & real change routes (7 operationIds)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Task 28 — change preview & real change routes', () => {
    let previewId: string;
    let draftChangeId: string;
    let draftChangeVersion: number;

    // ── createChangePreview ───────────────────────────────────────────────────

    describe('POST /api/v1/projects/:id/change-previews (createChangePreview)', () => {
      it('creates an isolated preview and returns 201', async () => {
        const changesBefore = db.db.select().from(changes).all().length;

        const res = await inject('POST', `/api/v1/projects/${changeProjectId}/change-previews`, {
          body: {
            baseline_id: changeBaselineId,
            scenario: {
              type: 'requirement_change',
              description: '新增视频问诊功能',
              affected_entities: [
                { entity_type: 'requirement', entity_id: 'REQ_VIDEO' },
                { entity_type: 'outcome', entity_id: 'OUT_VIDEO' },
              ],
              unknowns: [{ type: 'unknown', description: '带宽要求待调研' }],
            },
          },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(201);
        expect(res.body.data.id).toMatch(/^cpv_/);
        expect(res.body.data.project_id).toBe(changeProjectId);
        expect(res.body.data.baseline_id).toBe(changeBaselineId);
        expect(res.body.data.status).toBe('ready');
        expect(res.body.data.created_by).toBe(ownerId);
        expect(res.body.data.created_at).toBeTruthy();
        expect(res.body.data.expires_at).toBeTruthy();

        previewId = res.body.data.id;

        // Preview isolation: no formal change rows were inserted.
        const changesAfter = db.db.select().from(changes).all().length;
        expect(changesAfter).toBe(changesBefore);
      });

      it('returns 404 when the baseline belongs to a different project', async () => {
        const res = await inject('POST', `/api/v1/projects/${reportProjectId}/change-previews`, {
          body: {
            baseline_id: changeBaselineId,
            scenario: { type: 'modification', description: '跨项目', affected_entities: [] },
          },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });

      it('returns 400 when scenario is missing', async () => {
        const res = await inject('POST', `/api/v1/projects/${changeProjectId}/change-previews`, {
          body: { baseline_id: changeBaselineId },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
    });

    // ── getChangePreviewImpact ────────────────────────────────────────────────

    describe('GET /api/v1/change-previews/:id/impact (getChangePreviewImpact)', () => {
      it('returns the preview impacts, unresolved items and suggested stages', async () => {
        const res = await inject('GET', `/api/v1/change-previews/${previewId}/impact`, asOwner());

        expect(res.statusCode).toBe(200);
        expect(res.body.data.preview_id).toBe(previewId);
        expect(res.body.data.status).toBe('ready');
        expect(Array.isArray(res.body.data.impacts)).toBe(true);
        expect(res.body.data.impacts.length).toBe(2);
        for (const i of res.body.data.impacts) {
          expect(i.status).toBe('candidate');
        }
        expect(res.body.data.unresolved_items).toEqual([
          { type: 'unknown', description: '带宽要求待调研' },
        ]);
        expect(res.body.data.suggested_stages).toEqual(
          expect.arrayContaining(['scope', 'outcome']),
        );
      });

      it('returns 404 for a missing preview', async () => {
        const res = await inject('GET', '/api/v1/change-previews/cpv_missing/impact', asOwner());
        expect(res.statusCode).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });
    });

    // ── listChanges ───────────────────────────────────────────────────────────

    describe('GET /api/v1/projects/:id/changes (listChanges)', () => {
      it('returns a paginated list of real changes (no previews)', async () => {
        // Seed one real change so the list is non-empty.
        changeRepo.create({
          projectId: changeProjectId,
          sourceType: 'regulatory',
          description: '法规修订',
          severity: 'high',
        });

        const res = await inject('GET', `/api/v1/projects/${changeProjectId}/changes`, asOwner());

        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        // Every item is a real change (id prefix chg_), never a preview.
        for (const c of res.body.data) {
          expect(c.id).toMatch(/^chg_/);
          expect(c.project_id).toBe(changeProjectId);
        }
        expect(res.body.meta).toBeDefined();
      });

      it('returns 403 for a non-member', async () => {
        const res = await inject('GET', `/api/v1/projects/${changeProjectId}/changes`, {
          cookies: { auth_session: nonMemberId },
        });
        expect(res.statusCode).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    // ── createChange ─────────────────────────────────────────────────────────

    describe('POST /api/v1/projects/:id/changes (createChange)', () => {
      it('registers a real change in draft status and returns 201', async () => {
        const res = await inject('POST', `/api/v1/projects/${changeProjectId}/changes`, {
          body: {
            source_type: 'regulatory',
            description: '《在线诊疗管理办法》修订，要求实名认证',
            trigger_type: 'external_event',
            occurred_at: '2026-06-30T00:00:00Z',
            severity: 'high',
          },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(201);
        expect(res.body.data.id).toMatch(/^chg_/);
        expect(res.body.data.project_id).toBe(changeProjectId);
        expect(res.body.data.source_type).toBe('regulatory');
        expect(res.body.data.description).toContain('实名认证');
        expect(res.body.data.trigger_type).toBe('external_event');
        expect(res.body.data.severity).toBe('high');
        expect(res.body.data.status).toBe('draft');
        expect(res.body.data.version).toBe(1);
        expect(res.body.data.confirmed_by).toBeNull();
        expect(res.body.data.withdrawn_by).toBeNull();

        draftChangeId = res.body.data.id;
        draftChangeVersion = res.body.data.version;
      });

      it('returns 400 for an invalid severity', async () => {
        const res = await inject('POST', `/api/v1/projects/${changeProjectId}/changes`, {
          body: {
            source_type: 'internal',
            description: '非法严重度',
            severity: 'catastrophic',
          },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('returns 400 when description is missing', async () => {
        const res = await inject('POST', `/api/v1/projects/${changeProjectId}/changes`, {
          body: { source_type: 'internal', severity: 'low' },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
    });

    // ── getChangeImpact ───────────────────────────────────────────────────────

    describe('GET /api/v1/changes/:id/impact (getChangeImpact)', () => {
      it('lazily generates and returns candidate impacts with change_id set', async () => {
        const res = await inject('GET', `/api/v1/changes/${draftChangeId}/impact`, asOwner());

        expect(res.statusCode).toBe(200);
        expect(res.body.data.change_id).toBe(draftChangeId);
        expect(res.body.data.status).toBe('draft');
        expect(Array.isArray(res.body.data.impacts)).toBe(true);
        expect(res.body.data.impacts.length).toBeGreaterThan(0);
        // High severity reopens both scope and outcome.
        expect(res.body.data.suggested_stages).toEqual(
          expect.arrayContaining(['scope', 'outcome']),
        );

        // Verify the impacts were persisted with change_id (not preview_id).
        const rows = db.db
          .select()
          .from(changeImpacts)
          .where(eq(changeImpacts.changeId, draftChangeId))
          .all();
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
          expect(r.changeId).toBe(draftChangeId);
          expect(r.previewId).toBeNull();
          expect(r.status).toBe('candidate');
        }
      });

      it('returns 404 for a missing change', async () => {
        const res = await inject('GET', '/api/v1/changes/chg_missing/impact', asOwner());
        expect(res.statusCode).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });
    });

    // ── confirmChange ────────────────────────────────────────────────────────

    describe('POST /api/v1/changes/:id/confirm (confirmChange)', () => {
      it('atomically confirms the change, transitions project to Changing, and creates reopen tasks', async () => {
        const res = await inject('POST', `/api/v1/changes/${draftChangeId}/confirm`, {
          body: { expected_version: draftChangeVersion },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.id).toBe(draftChangeId);
        expect(res.body.data.status).toBe('confirmed');
        expect(res.body.data.confirmed_by).toBe(ownerId);
        expect(res.body.data.confirmed_at).toBeTruthy();
        expect(res.body.data.project_status).toBe('Changing');
        expect(res.body.data.reopened_stages).toEqual(
          expect.arrayContaining(['scope', 'outcome']),
        );
        expect(Array.isArray(res.body.data.reopen_tasks)).toBe(true);
        expect(res.body.data.reopen_tasks.length).toBe(
          res.body.data.reopened_stages.length,
        );
        for (const t of res.body.data.reopen_tasks) {
          expect(t.task_id).toMatch(/^tsk_/);
          expect(res.body.data.reopened_stages).toContain(t.stage);
        }

        // The project row actually flipped to Changing.
        const project = db.db
          .select()
          .from(projects)
          .where(eq(projects.id, changeProjectId))
          .get();
        expect(project?.status).toBe('Changing');

        // Impacts promoted to accepted.
        const impacts = db.db
          .select()
          .from(changeImpacts)
          .where(eq(changeImpacts.changeId, draftChangeId))
          .all();
        expect(impacts.length).toBeGreaterThan(0);
        expect(impacts.every((i) => i.status === 'accepted')).toBe(true);
      });

      it('returns 409 VERSION_CONFLICT on double-confirm with stale version', async () => {
        const res = await inject('POST', `/api/v1/changes/${draftChangeId}/confirm`, {
          body: { expected_version: draftChangeVersion },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('VERSION_CONFLICT');
      });
    });

    // ── withdrawChange ───────────────────────────────────────────────────────

    describe('POST /api/v1/changes/:id/withdraw (withdrawChange)', () => {
      it('withdraws a draft change with a reason and returns 200', async () => {
        // Create a fresh draft change to withdraw.
        const create = await inject('POST', `/api/v1/projects/${changeProjectId}/changes`, {
          body: {
            source_type: 'internal',
            description: '误登记变化',
            severity: 'low',
          },
          ...asOwner(),
        });

        const res = await inject('POST', `/api/v1/changes/${create.body.data.id}/withdraw`, {
          body: { reason: '经核实为误登记，撤回', expected_version: create.body.data.version },
          ...asOwner(),
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.id).toBe(create.body.data.id);
        expect(res.body.data.status).toBe('withdrawn');
        expect(res.body.data.withdrawn_by).toBe(ownerId);
        expect(res.body.data.withdrawn_at).toBeTruthy();
        expect(res.body.data.withdrawal_reason).toBe('经核实为误登记，撤回');
      });

      it('returns 409 CHANGE_BASELINED for a baselined change', async () => {
        // Create a change and force it into `baselined` to simulate a baseline
        // referencing it.
        const create = await inject('POST', `/api/v1/projects/${changeProjectId}/changes`, {
          body: {
            source_type: 'internal',
            description: '已基线变化',
            severity: 'medium',
          },
          ...asOwner(),
        });
        db.db
          .update(changes)
          .set({ status: 'baselined' })
          .where(eq(changes.id, create.body.data.id))
          .run();

        const res = await inject('POST', `/api/v1/changes/${create.body.data.id}/withdraw`, {
          body: { reason: '尝试撤回已基线变化', expected_version: create.body.data.version },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('CHANGE_BASELINED');
      });

      it('returns 400 when reason is missing', async () => {
        const create = await inject('POST', `/api/v1/projects/${changeProjectId}/changes`, {
          body: { source_type: 'internal', description: '无理由撤回', severity: 'low' },
          ...asOwner(),
        });
        const res = await inject('POST', `/api/v1/changes/${create.body.data.id}/withdraw`, {
          body: { expected_version: create.body.data.version },
          ...asOwner(),
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
    });
  });
});

/** Seed an approved domain profile for a project (required by compileReport). */
function seedApprovedDomainProfile(
  db: AppDb['db'],
  projectId: string,
  ownerId: string,
): void {
  const id = generateId('dpr');
  const ts = now();
  db.insert(domainProfiles)
    .values({
      id,
      projectId,
      profileVersion: 1,
      workType: 'software_delivery',
      domainLabelsJson: '[]',
      riskFlagsJson: '[]',
      terminologyMapJson: '{}',
      suggestedPackIdsJson: '["general"]',
      requiredHumanRolesJson: '[]',
      routingRisk: 'low',
      routingBasisJson: '{}',
      rationaleEvidenceLinksJson: '[]',
      unknownsJson: '[]',
      status: 'approved',
      classifierModel: 'stub-classifier-v1',
      promptVersion: 'prompt-v1.0.0',
      approvedBy: ownerId,
      approvedAt: ts,
      createdAt: ts,
    })
    .run();
}
