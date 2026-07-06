import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

import { RouteRegistry, type RouteContext } from '../../src/http/route-registry';
import { loadOpenApi } from '../../src/http/openapi-loader';
import { createAuthMiddleware } from '../../src/http/middleware/auth';
import { createAgreementGate } from '../../src/http/middleware/agreement-gate';
import {
  createIdempotencyMiddleware,
  computeRequestHash,
} from '../../src/http/middleware/idempotency';
import {
  registerAgreementRoutes,
  registerQuickRoutes,
  registerProjectRoutes,
  registerCoreWriteRoutes,
} from '../../src/http/routes/v1';
import { createTestDb, type AppDb } from '../helpers/test-db';
import { UserRepo } from '../../src/repo/user-repo';
import { GuestSessionRepo } from '../../src/repo/guest-session-repo';
import { AgreementRepo } from '../../src/repo/agreement-repo';
import { ProjectRepo } from '../../src/repo/project-repo';
import { MemberRepo } from '../../src/repo/member-repo';
import { IntakeRepo } from '../../src/repo/intake-repo';
import { SourceRepo } from '../../src/repo/source-repo';
import { EvidenceRepo } from '../../src/repo/evidence-repo';
import { QuickSessionRepo } from '../../src/repo/quick-session-repo';
import { QuickTurnRepo } from '../../src/repo/quick-turn-repo';
import { QuickUnknownRepo } from '../../src/repo/quick-unknown-repo';
import { BriefRepo } from '../../src/repo/brief-repo';
import { UpgradeRepo } from '../../src/repo/upgrade-repo';
import { DriverRepo } from '../../src/repo/driver-repo';
import { OutcomeRepo, buildOutcomeRow } from '../../src/repo/outcome-repo';
import { RequirementRepo, buildRequirementRow } from '../../src/repo/requirement-repo';
import { AcceptanceRepo } from '../../src/repo/acceptance-repo';
import { VerificationRepo } from '../../src/repo/verification-repo';
import { ScenarioRepo } from '../../src/repo/scenario-repo';
import { ConflictRepo } from '../../src/repo/conflict-repo';
import { ReviewRepo } from '../../src/repo/review-repo';
import { IdempotencyRepo } from '../../src/repo/idempotency-repo';
import { outcomes, requirements } from '../../src/db/schema/core';
import { agreementVersions } from '../../src/db/schema/identity';
import { env } from '../../src/config/env';
import { now } from '../../src/shared/time';
import { generateId } from '../../src/shared/id';

/**
 * Task 33.1 — Idempotency & concurrency integration.
 *
 * End-to-end tests for:
 *  - Idempotency-Key replay (same key + same body → original response replayed)
 *  - Idempotency-Key hash conflict (same key + different body → 409)
 *  - expected_version optimistic concurrency (stale version → 409 VERSION_CONFLICT)
 *
 * The idempotency middleware is NOT wired in buildContractApp, so this file
 * builds a standalone app that includes the idempotency middleware alongside
 * the auth + agreement gates.
 */

// ── Shared fixture for idempotency tests ─────────────────────────────────────

interface IdemFixture {
  app: FastifyInstance;
  db: AppDb;
  inject: (
    method: string,
    url: string,
    opts?: {
      body?: unknown;
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
    },
  ) => Promise<{ statusCode: number; body: any; headers: Record<string, string> }>;
  ownerId: string;
  agreementVersionId: string;
  quickSessionId: string;
  projectId: string;
  driverId: string;
  outcomeId: string;
  requirementId: string;
  idempotencyRepo: IdempotencyRepo;
}

async function buildIdemApp(): Promise<IdemFixture> {
  const db = createTestDb();
  const app = Fastify({ logger: false });
  await app.register(cookie);

  // Repos
  const userRepo = new UserRepo(db.db);
  const guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);
  const agreementRepo = new AgreementRepo(db.db);
  const projectRepo = new ProjectRepo(db.db);
  const memberRepo = new MemberRepo(db.db);
  const intakeRepo = new IntakeRepo(db.db);
  const sourceRepo = new SourceRepo(db.db);
  const evidenceRepo = new EvidenceRepo(db.db);
  const quickSessionRepo = new QuickSessionRepo(db.db);
  const quickTurnRepo = new QuickTurnRepo(db.db);
  const quickUnknownRepo = new QuickUnknownRepo(db.db);
  const briefRepo = new BriefRepo(db.db);
  const upgradeRepo = new UpgradeRepo(db.db);
  const driverRepo = new DriverRepo(db.db);
  const outcomeRepo = new OutcomeRepo(db.db);
  const requirementRepo = new RequirementRepo(db.db);
  const acceptanceRepo = new AcceptanceRepo(db.db);
  const verificationRepo = new VerificationRepo(db.db);
  const scenarioRepo = new ScenarioRepo(db.db);
  const conflictRepo = new ConflictRepo(db.db);
  const reviewRepo = new ReviewRepo(db.db);
  const idempotencyRepo = new IdempotencyRepo(db.db);

  // Middleware
  const auth = createAuthMiddleware({ userRepo, guestSessionRepo });
  const agreementGate = createAgreementGate({ agreementRepo });
  const idempotency = createIdempotencyMiddleware({ idempotencyRepo });

  // Register routes
  const registry = new RouteRegistry(loadOpenApi());
  registerAgreementRoutes(registry, { agreementRepo });
  registerProjectRoutes(registry, {
    projectRepo,
    memberRepo,
    intakeRepo,
    sourceRepo,
    evidenceRepo,
    userRepo,
  });
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
    checkAgreement: (ctx: RouteContext) => agreementGate.checkAgreement(ctx.actor),
    enforceIdempotency: (ctx: RouteContext) => idempotency.enforceIdempotency(ctx),
    storeIdempotency: (ctx: RouteContext, status: number, body: unknown) =>
      idempotency.storeIdempotency(ctx, status, body),
  });
  await app.ready();

  // Seed user + agreement + project
  const owner = await userRepo.create({
    displayName: 'Idem Owner',
    authSubject: 'auth|idem-owner',
    email: 'idem-owner@example.com',
  });
  const ownerId = owner.id;

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

  const project = projectRepo.create({ ownerId, name: '幂等测试项目' });
  const projectId = project.id;

  const driver = driverRepo.create({
    projectId,
    driverType: 'goal',
    statement: '幂等测试驱动',
  });

  const outcomeRow = buildOutcomeRow({
    projectId,
    driverId: driver.id,
    description: '幂等测试成果',
    epistemicType: 'Inference',
  });
  db.db.insert(outcomes).values(outcomeRow).run();

  const reqRow = buildRequirementRow({
    projectId,
    requirementKey: 'REQ-IDEM-001',
    statement: '幂等测试需求',
    requirementType: 'functional',
    provenance: 'explicitly_stated',
    commitment: 'committed',
    stability: 'stable',
  });
  db.db.insert(requirements).values(reqRow).run();

  const quickSession = quickSessionRepo.create({
    actorKind: 'user',
    userId: ownerId,
    sourceKind: 'custom',
    originalIdea: '幂等测试快速问诊',
  });

  const inject = async (
    method: string,
    url: string,
    opts: {
      body?: unknown;
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.inject({
      method,
      url,
      payload: opts.body as string | object | undefined,
      headers,
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
    return {
      statusCode: res.statusCode,
      body,
      headers: res.headers as Record<string, string>,
    };
  };

  return {
    app,
    db,
    inject,
    ownerId,
    agreementVersionId,
    quickSessionId: quickSession.id,
    projectId,
    driverId: driver.id,
    outcomeId: outcomeRow.id!,
    requirementId: reqRow.id!,
    idempotencyRepo,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Task 33.1 — idempotency & concurrency integration', () => {
  let fx: IdemFixture;

  beforeAll(async () => {
    fx = await buildIdemApp();
  });

  afterAll(async () => {
    await fx.app.close();
  });

  const asOwner = () => ({ cookies: { auth_session: fx.ownerId } });

  // ── Idempotency-Key replay ──────────────────────────────────────────────────

  describe('Idempotency-Key replay (same key + same body)', () => {
    it('replays the original response for acceptAgreement', async () => {
      const url = `/api/v1/agreements/${fx.agreementVersionId}/accept`;
      const body = { scope: 'all' };
      const key = 'idem-accept-replay-001';

      // First call → 201 (or 200).
      const res1 = await fx.inject('POST', url, {
        ...asOwner(),
        body,
        headers: { 'idempotency-key': key },
      });
      expect(res1.statusCode).toBe(201);

      // Second call with same key + same body → replay.
      const res2 = await fx.inject('POST', url, {
        ...asOwner(),
        body,
        headers: { 'idempotency-key': key },
      });
      expect(res2.statusCode).toBe(res1.statusCode);
      expect(res2.body).toEqual(res1.body);
    });

    it('replays createQuickSession response', async () => {
      const url = '/api/v1/quick-sessions';
      const body = {
        original_input: '幂等重放测试快速问诊',
        source_kind: 'custom',
      };
      const key = 'idem-quick-replay-001';

      const res1 = await fx.inject('POST', url, {
        ...asOwner(),
        body,
        headers: { 'idempotency-key': key },
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await fx.inject('POST', url, {
        ...asOwner(),
        body,
        headers: { 'idempotency-key': key },
      });
      expect(res2.statusCode).toBe(res1.statusCode);
      expect(res2.body).toEqual(res1.body);

      // Verify only one quick session was created (not two).
      const sessionId1 = (res1.body as any).data.id;
      const sessionId2 = (res2.body as any).data.id;
      expect(sessionId2).toBe(sessionId1);
    });
  });

  // ── Idempotency-Key hash conflict ───────────────────────────────────────────

  describe('Idempotency-Key hash conflict (same key + different body → 409)', () => {
    it('returns 409 IDEMPOTENCY_CONFLICT for different body with same key', async () => {
      const url = `/api/v1/agreements/${fx.agreementVersionId}/accept`;
      const key = 'idem-conflict-001';

      // First call with body A.
      const res1 = await fx.inject('POST', url, {
        ...asOwner(),
        body: { scope: 'all' },
        headers: { 'idempotency-key': key },
      });
      expect(res1.statusCode).toBe(201);

      // Second call with same key but different body → 409.
      const res2 = await fx.inject('POST', url, {
        ...asOwner(),
        body: { scope: 'quick' },
        headers: { 'idempotency-key': key },
      });
      expect(res2.statusCode).toBe(409);
      expect((res2.body as any).error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  // ── Idempotency without key (no-op) ─────────────────────────────────────────

  describe('Idempotency without key (no-op)', () => {
    it('does not deduplicate when no Idempotency-Key header is present', async () => {
      const url = `/api/v1/agreements/${fx.agreementVersionId}/accept`;
      const body = { scope: 'all' };

      const res1 = await fx.inject('POST', url, { ...asOwner(), body });
      const res2 = await fx.inject('POST', url, { ...asOwner(), body });

      // Both succeed (each creates a new consent row).
      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);
      // Different consent IDs prove they are distinct calls.
      expect((res1.body as any).data.consent_id).not.toBe(
        (res2.body as any).data.consent_id,
      );
    });
  });

  // ── expected_version optimistic concurrency ────────────────────────────────

  describe('expected_version optimistic concurrency (409 VERSION_CONFLICT)', () => {
    it('rejects stale expected_version on updateProject', async () => {
      // Create a fresh project for this test.
      const projectRepo = new ProjectRepo(fx.db.db);
      const project = projectRepo.create({
        ownerId: fx.ownerId,
        name: '并发测试项目',
      });

      // Update with correct version → 200.
      const url = `/api/v1/projects/${project.id}`;
      const res1 = await fx.inject('PATCH', url, {
        ...asOwner(),
        body: { name: 'updated name', expected_version: 1 },
      });
      expect(res1.statusCode).toBe(200);
      expect((res1.body as any).data.version).toBe(2);

      // Update with stale version (1) → 409 VERSION_CONFLICT.
      const res2 = await fx.inject('PATCH', url, {
        ...asOwner(),
        body: { name: 'stale update', expected_version: 1 },
      });
      expect(res2.statusCode).toBe(409);
      expect((res2.body as any).error.code).toBe('VERSION_CONFLICT');
    });

    it('rejects stale expected_version on updateDriver', async () => {
      const url = `/api/v1/drivers/${fx.driverId}`;

      // Current version is 1; update with correct version → 200.
      const res1 = await fx.inject('PATCH', url, {
        ...asOwner(),
        body: { statement: 'updated statement', expected_version: 1 },
      });
      expect(res1.statusCode).toBe(200);

      // Stale version → 409.
      const res2 = await fx.inject('PATCH', url, {
        ...asOwner(),
        body: { statement: 'stale update', expected_version: 1 },
      });
      expect(res2.statusCode).toBe(409);
      expect((res2.body as any).error.code).toBe('VERSION_CONFLICT');
    });

    it('rejects stale expected_version on updateOutcome', async () => {
      const url = `/api/v1/outcomes/${fx.outcomeId}`;

      const res1 = await fx.inject('PATCH', url, {
        ...asOwner(),
        body: { description: 'updated outcome', expected_version: 1 },
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await fx.inject('PATCH', url, {
        ...asOwner(),
        body: { description: 'stale update', expected_version: 1 },
      });
      expect(res2.statusCode).toBe(409);
      expect((res2.body as any).error.code).toBe('VERSION_CONFLICT');
    });

    it('rejects stale expected_version on updateRequirement', async () => {
      const url = `/api/v1/requirements/${fx.requirementId}`;

      const res1 = await fx.inject('PATCH', url, {
        ...asOwner(),
        body: { statement: 'updated requirement', expected_version: 1 },
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await fx.inject('PATCH', url, {
        ...asOwner(),
        body: { statement: 'stale update', expected_version: 1 },
      });
      expect(res2.statusCode).toBe(409);
      expect((res2.body as any).error.code).toBe('VERSION_CONFLICT');
    });
  });

  // ── computeRequestHash sanity check ─────────────────────────────────────────

  describe('computeRequestHash (SHA-256 body hash)', () => {
    it('produces stable hashes for identical bodies', () => {
      const body = { a: 1, b: 'test' };
      expect(computeRequestHash(body)).toBe(computeRequestHash(body));
    });

    it('normalises null/undefined to the same hash', () => {
      expect(computeRequestHash(null)).toBe(computeRequestHash(undefined));
    });

    it('produces different hashes for different bodies', () => {
      expect(computeRequestHash({ a: 1 })).not.toBe(computeRequestHash({ a: 2 }));
    });
  });
});
