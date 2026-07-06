import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

import { RouteRegistry, type RouteContext } from '../src/http/route-registry';
import { loadOpenApi } from '../src/http/openapi-loader';
import { createAuthMiddleware } from '../src/http/middleware/auth';
import { registerCoreQueryRoutes, registerCoreWriteRoutes } from '../src/http/routes/v1';
import { createTestDb, type AppDb } from './helpers/test-db';
import { ProjectRepo } from '../src/repo/project-repo';
import { DriverRepo } from '../src/repo/driver-repo';
import { OutcomeRepo, buildOutcomeRow } from '../src/repo/outcome-repo';
import { RequirementRepo, buildRequirementRow } from '../src/repo/requirement-repo';
import { AcceptanceRepo } from '../src/repo/acceptance-repo';
import { VerificationRepo } from '../src/repo/verification-repo';
import { SignalRepo } from '../src/repo/signal-repo';
import { ScenarioRepo } from '../src/repo/scenario-repo';
import { ConflictRepo } from '../src/repo/conflict-repo';
import { ReviewRepo } from '../src/repo/review-repo';
import { StakeholderRepo } from '../src/repo/stakeholder-repo';
import { EvidenceLinkRepo } from '../src/repo/evidence-link-repo';
import { BaselineRepo } from '../src/repo/baseline-repo';
import { UserRepo } from '../src/repo/user-repo';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { outcomes, requirements, conflicts, stakeholders, conflictOptions } from '../src/db/schema/core';
import { env } from '../src/config/env';
import { now } from '../src/shared/time';
import { generateId } from '../src/shared/id';

/**
 * Route-level tests for the core requirements-engineering endpoints
 * (Task 24-25, 27 operationIds).
 *
 * Covers:
 *   - Task 24 (14 query ops): listOutcomes, listRequirements, listDrivers,
 *     listInterviewTurns, listStakeholders, listEvidenceLinks, listTraceLinks,
 *     getConflictDetail, listConflicts, listAcceptanceCriteria,
 *     listOperationalSignals, listFutureScenarios, listBaselines, listReports.
 *   - Task 25 (13 write/review ops): createDriver, updateDriver, updateOutcome,
 *     updateRequirement, createAcceptanceCriterion, createVerificationArtifact,
 *     createFutureScenario, reviewOutcome, reviewDriver, reviewRequirement,
 *     reviewConflict, reviewGate, resolveConflict.
 *
 * Key invariants asserted:
 *   - All routes require `requireUser` + project capability (401 when unauthenticated);
 *   - `expected_version` mismatch returns 409 VERSION_CONFLICT;
 *   - Gate rejection / wrong-phase returns 409 GATE_NOT_PASSED;
 *   - Gate accept transitions the project state machine.
 */
describe('core requirement routes (Task 24-25)', () => {
  let db: AppDb;
  let app: FastifyInstance;
  let projectRepo: ProjectRepo;
  let driverRepo: DriverRepo;

  let ownerId: string;
  let projectId: string;
  let driverId: string;
  let outcomeId: string;
  let requirementId: string;
  let conflictId: string;
  let conflictOptionId: string;

  beforeAll(async () => {
    db = createTestDb();

    // ── Wire up the app with the RouteRegistry ────────────────────────────
    app = Fastify({ logger: false });
    await app.register(cookie);

    const userRepo = new UserRepo(db.db);
    const guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);

    driverRepo = new DriverRepo(db.db);
    const outcomeRepo = new OutcomeRepo(db.db);
    const requirementRepo = new RequirementRepo(db.db);
    const acceptanceRepo = new AcceptanceRepo(db.db);
    const verificationRepo = new VerificationRepo(db.db);
    const signalRepo = new SignalRepo(db.db);
    const scenarioRepo = new ScenarioRepo(db.db);
    const conflictRepo = new ConflictRepo(db.db);
    const reviewRepo = new ReviewRepo(db.db);
    const stakeholderRepo = new StakeholderRepo(db.db);
    const evidenceLinkRepo = new EvidenceLinkRepo(db.db);
    const baselineRepo = new BaselineRepo(db.db);
    projectRepo = new ProjectRepo(db.db);

    const auth = createAuthMiddleware({ userRepo, guestSessionRepo });

    const registry = new RouteRegistry(loadOpenApi());
    registerCoreQueryRoutes(registry, {
      outcomeRepo,
      driverRepo,
      requirementRepo,
      acceptanceRepo,
      signalRepo,
      scenarioRepo,
      conflictRepo,
      stakeholderRepo,
      evidenceLinkRepo,
      baselineRepo,
    });
    registerCoreWriteRoutes(registry, {
      driverRepo,
      outcomeRepo,
      requirementRepo,
      acceptanceRepo,
      verificationRepo,
      scenarioRepo,
      conflictRepo,
      reviewRepo,
      projectRepo,
    });

    await registry.applyTo(app, db, {
      resolveActor: auth.resolveActor,
    });
    await app.ready();

    // ── Seed user + project ───────────────────────────────────────────────
    ownerId = 'usr_core_route_owner';
    db.raw
      .prepare(
        `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(ownerId, 'Core Route Owner', 'auth|corerouteowner', 'active', now(), now());

    const project = projectRepo.create({ ownerId, name: '核心路由测试项目' });
    projectId = project.id;

    // Seed a driver for query/update tests.
    const driver = driverRepo.create({
      projectId,
      driverType: 'goal',
      statement: '提升系统性能',
    });
    driverId = driver.id;

    // Seed an outcome.
    const outcomeRow = buildOutcomeRow({
      projectId,
      driverId,
      description: '响应时间降至 200ms',
      epistemicType: 'Inference',
    });
    db.db.insert(outcomes).values(outcomeRow).run();
    outcomeId = outcomeRow.id!;

    // Seed a requirement.
    const reqRow = buildRequirementRow({
      projectId,
      requirementKey: 'REQ-ROUTE-001',
      statement: '系统 SHALL 支持高并发',
      requirementType: 'functional',
      provenance: 'explicitly_stated',
      commitment: 'committed',
      stability: 'stable',
    });
    db.db.insert(requirements).values(reqRow).run();
    requirementId = reqRow.id!;

    // Seed a conflict + option.
    conflictId = generateId('cfl');
    conflictOptionId = generateId('opt');
    const ts = now();
    db.db
      .insert(conflicts)
      .values({
        id: conflictId,
        projectId,
        statement: '性能与成本冲突',
        severity: 'high',
        blocking: 1,
        ownerId: null,
        status: 'open',
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    db.db
      .insert(conflictOptions)
      .values({
        id: conflictOptionId,
        conflictId,
        description: '采用缓存方案',
        benefits: '性能提升',
        costs: '增加复杂度',
        risks: '缓存一致性',
        reversibility: 'medium',
        status: 'candidate',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    // Seed a stakeholder.
    db.db
      .insert(stakeholders)
      .values({
        id: generateId('stk'),
        projectId,
        name: '架构师',
        role: '技术决策者',
        epistemicType: 'Fact',
        status: 'candidate',
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  });

  afterAll(async () => {
    await app.close();
  });

  // Helpers.
  function asOwner(cookies: Record<string, string> = {}) {
    return { cookies: { auth_session: ownerId, ...cookies } };
  }

  async function inject(
    method: string,
    url: string,
    opts: { body?: unknown; cookies?: Record<string, string>; query?: Record<string, string> } = {},
  ) {
    const res = await app.inject({
      method,
      url,
      payload: opts.body as string | object | undefined,
      cookies: opts.cookies,
      query: opts.query,
    });
    let body: unknown = res.body;
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

  // ===========================================================================
  // Query routes (14 operationIds)
  // ===========================================================================
  describe('query routes (Task 24)', () => {
    it('listOutcomes returns 200 with paginated outcomes', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/outcomes`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].id).toBe(outcomeId);
    });

    it('listRequirements returns 200 with paginated requirements', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/requirements`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].id).toBe(requirementId);
    });

    it('listDrivers returns 200 with paginated drivers', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/drivers`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].id).toBe(driverId);
    });

    it('listInterviewTurns returns 200 with paginated turns', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/interview-turns`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('listStakeholders returns 200 with paginated stakeholders', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/stakeholders`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('listEvidenceLinks returns 200 with paginated links', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/evidence-links`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('listTraceLinks returns 200 with paginated links', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/trace-links`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('getConflictDetail returns 200 with conflict detail', async () => {
      const res = await inject('GET', `/api/v1/conflicts/${conflictId}`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(conflictId);
      expect(Array.isArray(res.body.data.sides)).toBe(true);
      expect(Array.isArray(res.body.data.options)).toBe(true);
      expect(res.body.data.options.length).toBe(1);
    });

    it('listConflicts returns 200 with paginated conflicts', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/conflicts`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('listAcceptanceCriteria returns 200 with paginated criteria', async () => {
      const res = await inject(
        'GET',
        `/api/v1/requirements/${requirementId}/acceptance-criteria`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('listOperationalSignals returns 200 with paginated signals', async () => {
      const res = await inject(
        'GET',
        `/api/v1/requirements/${requirementId}/operational-signals`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('listFutureScenarios returns 200 with paginated scenarios', async () => {
      const res = await inject(
        'GET',
        `/api/v1/projects/${projectId}/future-scenarios`,
        asOwner(),
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('listBaselines returns 200 with paginated baselines', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/baselines`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('listReports returns 200 with paginated reports', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/reports`, asOwner());
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ===========================================================================
  // Write routes (12 operationIds, excluding reviewGate tested below)
  // ===========================================================================
  describe('write routes (Task 25)', () => {
    it('createDriver returns 201 with the driver', async () => {
      const res = await inject('POST', `/api/v1/projects/${projectId}/drivers`, {
        body: {
          driver_type: 'risk',
          statement: '安全风险驱动',
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.id).toMatch(/^drv_/);
      expect(res.body.data.driver_type).toBe('risk');
      expect(res.body.data.statement).toBe('安全风险驱动');
    });

    it('updateDriver returns 200 with updated driver', async () => {
      const res = await inject('PATCH', `/api/v1/drivers/${driverId}`, {
        body: {
          statement: '更新后的驱动陈述',
          expected_version: 1,
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.statement).toBe('更新后的驱动陈述');
      expect(res.body.data.version).toBe(2);
    });

    it('updateOutcome returns 200 with updated outcome', async () => {
      const res = await inject('PATCH', `/api/v1/outcomes/${outcomeId}`, {
        body: {
          description: '更新后的成果描述',
          target_value: '150ms',
          expected_version: 1,
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.description).toBe('更新后的成果描述');
      expect(res.body.data.target_value).toBe('150ms');
      expect(res.body.data.version).toBe(2);
    });

    it('updateRequirement returns 200 with updated requirement', async () => {
      const res = await inject('PATCH', `/api/v1/requirements/${requirementId}`, {
        body: {
          statement: '更新后的需求陈述',
          provenance: 'derived',
          expected_version: 1,
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.statement).toBe('更新后的需求陈述');
      expect(res.body.data.provenance).toBe('derived');
      expect(res.body.data.version).toBe(2);
    });

    it('createAcceptanceCriterion returns 201', async () => {
      const res = await inject(
        'POST',
        `/api/v1/requirements/${requirementId}/acceptance-criteria`,
        {
          body: {
            action_or_condition: '当并发用户达到 1000',
            expected_result: '响应时间不超过 200ms',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.id).toMatch(/^ac_/);
      expect(res.body.data.requirement_id).toBe(requirementId);
    });

    it('createVerificationArtifact returns 201', async () => {
      const res = await inject(
        'POST',
        `/api/v1/requirements/${requirementId}/verification-artifacts`,
        {
          body: {
            artifact_type: 'test',
            description: '负载测试验证',
            result: 'passed',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.id).toMatch(/^va_/);
      expect(res.body.data.requirement_id).toBe(requirementId);
    });

    it('createFutureScenario returns 201', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/future-scenarios`,
        {
          body: {
            name: '用户增长场景',
            description: '用户量增长 10 倍后的系统演进',
            activation_trigger: '日活突破 10 万',
            leading_indicators: ['日活增长率'],
            horizon: 'next',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.id).toMatch(/^fsc_/);
      expect(res.body.data.horizon).toBe('next');
    });

    it('reviewOutcome returns 201', async () => {
      const res = await inject('POST', `/api/v1/outcomes/${outcomeId}/reviews`, {
        body: {
          action: 'accept',
          entity_version: 2,
          reason: '成果清晰可度量',
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.entity_type).toBe('outcome');
      expect(res.body.data.action).toBe('accept');
    });

    it('reviewDriver returns 201', async () => {
      const res = await inject('POST', `/api/v1/drivers/${driverId}/reviews`, {
        body: {
          action: 'modify',
          entity_version: 2,
          reason: '建议修改驱动陈述',
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.entity_type).toBe('driver');
      expect(res.body.data.action).toBe('modify');
    });

    it('reviewRequirement returns 201', async () => {
      const res = await inject('POST', `/api/v1/requirements/${requirementId}/reviews`, {
        body: {
          action: 'accept',
          entity_version: 2,
          reason: '需求定义明确',
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.entity_type).toBe('requirement');
    });

    it('reviewConflict returns 201', async () => {
      const res = await inject('POST', `/api/v1/conflicts/${conflictId}/reviews`, {
        body: {
          action: 'uncertain',
          entity_version: 1,
          reason: '需要更多信息来决策',
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.entity_type).toBe('conflict');
    });

    it('resolveConflict returns 200 with resolution', async () => {
      const res = await inject('POST', `/api/v1/conflicts/${conflictId}/resolve`, {
        body: {
          decision: {
            question: '采用哪个方案?',
            selected_option_id: conflictOptionId,
            rationale: '缓存方案性价比最高',
          },
          owner_id: ownerId,
          expected_version: 1,
        },
        ...asOwner(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.conflict_status).toBe('resolved');
      expect(res.body.data.decision_status).toBe('decided');
      expect(res.body.data.selected_option_id).toBe(conflictOptionId);
    });
  });

  // ===========================================================================
  // reviewGate (1 operationId) — gate blocking & state transition
  // ===========================================================================
  describe('reviewGate (gate blocking & transition)', () => {
    it('returns 409 GATE_NOT_PASSED on reject', async () => {
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/gates/scope/reviews`,
        {
          body: {
            action: 'reject',
            entity_version: 1,
            reason: '范围不清晰',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('GATE_NOT_PASSED');
    });

    it('returns 409 GATE_NOT_PASSED when project is in wrong phase', async () => {
      // Project is in 'Draft' (not 'Ingesting'), so scope gate cannot pass.
      const res = await inject(
        'POST',
        `/api/v1/projects/${projectId}/gates/scope/reviews`,
        {
          body: {
            action: 'accept',
            entity_version: 1,
            reason: '尝试通过范围关口',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('GATE_NOT_PASSED');
    });

    it('accepts and transitions the project when in the correct phase', async () => {
      // Create a fresh project and transition it to 'Ingesting'.
      const gateProject = projectRepo.create({ ownerId, name: '关口测试项目' });
      projectRepo.updateStatus(gateProject.id, 'Ingesting');

      const res = await inject(
        'POST',
        `/api/v1/projects/${gateProject.id}/gates/scope/reviews`,
        {
          body: {
            action: 'accept',
            entity_version: 1,
            reason: '范围已确认，通过关口',
          },
          ...asOwner(),
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.data.gate).toBe('scope');
      expect(res.body.data.action).toBe('accept');

      // Verify the project transitioned to 'Eliciting'.
      const updated = projectRepo.findById(gateProject.id);
      expect(updated!.status).toBe('Eliciting');
    });
  });

  // ===========================================================================
  // expected_version concurrency (409 VERSION_CONFLICT)
  // ===========================================================================
  describe('expected_version concurrency', () => {
    it('updateDriver returns 409 VERSION_CONFLICT on stale version', async () => {
      // Create a fresh driver (version=1).
      const createRes = await inject('POST', `/api/v1/projects/${projectId}/drivers`, {
        body: { driver_type: 'problem', statement: '并发测试驱动' },
        ...asOwner(),
      });
      const newDriverId = createRes.body.data.id;

      // First update succeeds (version 1 → 2).
      const ok = await inject('PATCH', `/api/v1/drivers/${newDriverId}`, {
        body: { statement: '第一次更新', expected_version: 1 },
        ...asOwner(),
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.body.data.version).toBe(2);

      // Second update with stale version → 409.
      const conflict = await inject('PATCH', `/api/v1/drivers/${newDriverId}`, {
        body: { statement: '过期更新', expected_version: 1 },
        ...asOwner(),
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('updateOutcome returns 409 VERSION_CONFLICT on stale version', async () => {
      // Seed a fresh outcome (version=1).
      const drv = driverRepo.create({ projectId, driverType: 'outcome', statement: '并发成果驱动' });
      const row = buildOutcomeRow({
        projectId,
        driverId: drv.id,
        description: '并发测试成果',
        epistemicType: 'Fact',
      });
      db.db.insert(outcomes).values(row).run();

      // First update succeeds (version 1 → 2).
      const ok = await inject('PATCH', `/api/v1/outcomes/${row.id}`, {
        body: { description: '更新后', expected_version: 1 },
        ...asOwner(),
      });
      expect(ok.statusCode).toBe(200);

      // Stale update → 409.
      const conflict = await inject('PATCH', `/api/v1/outcomes/${row.id}`, {
        body: { description: '过期', expected_version: 1 },
        ...asOwner(),
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('updateRequirement returns 409 VERSION_CONFLICT on stale version', async () => {
      // Seed a fresh requirement (version=1).
      const row = buildRequirementRow({
        projectId,
        requirementKey: 'REQ-CONCURRENCY-001',
        statement: '并发测试需求',
        requirementType: 'functional',
        provenance: 'explicitly_stated',
        commitment: 'committed',
        stability: 'stable',
      });
      db.db.insert(requirements).values(row).run();

      // First update succeeds (version 1 → 2).
      const ok = await inject('PATCH', `/api/v1/requirements/${row.id}`, {
        body: { statement: '更新后', expected_version: 1 },
        ...asOwner(),
      });
      expect(ok.statusCode).toBe(200);

      // Stale update → 409.
      const conflict = await inject('PATCH', `/api/v1/requirements/${row.id}`, {
        body: { statement: '过期', expected_version: 1 },
        ...asOwner(),
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  // ===========================================================================
  // Auth enforcement
  // ===========================================================================
  describe('auth enforcement', () => {
    it('returns 401 when unauthenticated on a query route', async () => {
      const res = await inject('GET', `/api/v1/projects/${projectId}/drivers`);
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 when unauthenticated on a write route', async () => {
      const res = await inject('POST', `/api/v1/projects/${projectId}/drivers`, {
        body: { driver_type: 'goal', statement: '未认证测试' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });
});
