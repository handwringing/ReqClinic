import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createTestDb, type AppDb } from './helpers/test-db';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { AgreementRepo } from '../src/repo/agreement-repo';
import { IdempotencyRepo } from '../src/repo/idempotency-repo';
import { createAuthMiddleware, requireUser, requireActor } from '../src/http/middleware/auth';
import { createAgreementGate } from '../src/http/middleware/agreement-gate';
import {
  createIdempotencyMiddleware,
  computeRequestHash,
} from '../src/http/middleware/idempotency';
import { RateLimiter } from '../src/http/middleware/rate-limit';
import { ApiError } from '../src/http/errors';
import type { RouteContext, Actor } from '../src/http/route-registry';
import { agreementVersions } from '../src/db/schema/identity';
import { generateId } from '../src/shared/id';
import { now } from '../src/shared/time';

const PEPPER = 'test-pepper';

/** Build a minimal RouteContext for middleware tests. */
function makeCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    app: {} as any,
    db: {} as any,
    operationId: 'createQuickSession',
    params: {},
    query: {},
    body: null,
    headers: {},
    cookies: {},
    actor: { kind: 'unauthenticated' },
    requestId: generateId('req'),
    ...overrides,
  };
}

/** Build a minimal FastifyRequest with cookies for auth tests. */
function makeReq(cookies: Record<string, string> = {}): FastifyRequest {
  return { cookies } as unknown as FastifyRequest;
}

// ===========================================================================
// auth middleware
// ===========================================================================

describe('auth middleware', () => {
  let db: AppDb;
  let guestSessionRepo: GuestSessionRepo;

  beforeAll(() => {
    db = createTestDb();
    guestSessionRepo = new GuestSessionRepo(db.db, PEPPER);
  });

  it('returns unauthenticated when no cookies are present', async () => {
    const { resolveActor } = createAuthMiddleware({
      userRepo: {} as any,
      guestSessionRepo,
    });
    const actor = await resolveActor(makeReq());
    expect(actor.kind).toBe('unauthenticated');
  });

  it('returns guest when a valid guest_session cookie is present', async () => {
    const session = await guestSessionRepo.create();
    const { resolveActor } = createAuthMiddleware({
      userRepo: {} as any,
      guestSessionRepo,
    });
    const actor = await resolveActor(makeReq({ guest_session: session.sessionKey }));
    expect(actor.kind).toBe('guest');
    expect(actor.guestSessionId).toBe(session.id);
  });

  it('returns user when an auth_session cookie is present', async () => {
    const { resolveActor } = createAuthMiddleware({
      userRepo: {} as any,
      guestSessionRepo,
    });
    const actor = await resolveActor(makeReq({ auth_session: 'usr_abc' }));
    expect(actor.kind).toBe('user');
    expect(actor.userId).toBe('usr_abc');
  });

  it('user cookie takes precedence over guest cookie', async () => {
    const session = await guestSessionRepo.create();
    const { resolveActor } = createAuthMiddleware({
      userRepo: {} as any,
      guestSessionRepo,
    });
    const actor = await resolveActor(
      makeReq({
        guest_session: session.sessionKey,
        auth_session: 'usr_xyz',
      }),
    );
    expect(actor.kind).toBe('user');
    expect(actor.userId).toBe('usr_xyz');
  });

  it('requireUser throws for a guest actor', () => {
    const guest: Actor = { kind: 'guest', guestSessionId: 'gs1' };
    expect(() => requireUser(guest)).toThrow(ApiError);
    expect(() => requireUser(guest)).toThrow(/Authentication required/);
  });

  it('requireActor throws for unauthenticated', () => {
    const unauth: Actor = { kind: 'unauthenticated' };
    expect(() => requireActor(unauth)).toThrow(ApiError);
  });

  it('requireActor passes for guest and user', () => {
    expect(() => requireActor({ kind: 'guest', guestSessionId: 'gs1' })).not.toThrow();
    expect(() => requireActor({ kind: 'user', userId: 'u1' })).not.toThrow();
  });
});

// ===========================================================================
// agreement-gate middleware
// ===========================================================================

describe('agreement-gate middleware', () => {
  let db: AppDb;
  let agreementRepo: AgreementRepo;
  let guestSessionRepo: GuestSessionRepo;
  let activeVersionId: string;

  beforeAll(async () => {
    db = createTestDb();
    agreementRepo = new AgreementRepo(db.db);
    guestSessionRepo = new GuestSessionRepo(db.db, PEPPER);

    activeVersionId = generateId('agrv');
    await db.db.insert(agreementVersions).values({
      id: activeVersionId,
      version: '1.0.0',
      status: 'active',
      changeType: 'major',
      effectiveAt: now(),
      contentRef: 'agreement-v1.md',
      createdAt: now(),
    });
  });

  it('throws agreementRequired when no valid consent exists', async () => {
    const { checkAgreement } = createAgreementGate({ agreementRepo });
    const actor: Actor = { kind: 'guest', guestSessionId: 'gs_no_consent' };
    await expect(checkAgreement(actor)).rejects.toThrow(ApiError);
    await expect(checkAgreement(actor)).rejects.toMatchObject({
      code: 'AGREEMENT_REQUIRED',
      statusCode: 403,
    });
  });

  it('passes when a valid consent exists', async () => {
    const gs = await guestSessionRepo.create();
    await agreementRepo.createConsent({
      agreementVersionId: activeVersionId,
      actorKind: 'guest',
      guestSessionId: gs.id,
    });
    const { checkAgreement } = createAgreementGate({ agreementRepo });
    const actor: Actor = { kind: 'guest', guestSessionId: gs.id };
    await expect(checkAgreement(actor)).resolves.toBeUndefined();
  });
});

// ===========================================================================
// idempotency middleware
// ===========================================================================

describe('idempotency middleware', () => {
  let db: AppDb;
  let idempotencyRepo: IdempotencyRepo;

  beforeAll(() => {
    db = createTestDb();
    idempotencyRepo = new IdempotencyRepo(db.db);
  });

  it('skips when no Idempotency-Key header is present', async () => {
    const { enforceIdempotency } = createIdempotencyMiddleware({ idempotencyRepo });
    const ctx = makeCtx({
      headers: {},
      actor: { kind: 'guest', guestSessionId: 'gs1' },
    });
    const result = await enforceIdempotency(ctx);
    expect(result).toBeUndefined();
  });

  it('replays the original response when the same key + body is sent again', async () => {
    const { enforceIdempotency, storeIdempotency } = createIdempotencyMiddleware({
      idempotencyRepo,
    });
    const key = 'idem-replay-' + generateId('t');
    const body = { input: 'hello' };
    const actor: Actor = { kind: 'guest', guestSessionId: 'gs_replay' };

    // First request: no existing record → handler runs → store response.
    const ctx1 = makeCtx({
      headers: { 'idempotency-key': key },
      body,
      actor,
    });
    const result1 = await enforceIdempotency(ctx1);
    expect(result1).toBeUndefined(); // no replay
    await storeIdempotency(ctx1, 201, { data: { ok: true }, meta: {} });

    // Second request: same key + same body → replay.
    const ctx2 = makeCtx({
      headers: { 'idempotency-key': key },
      body,
      actor,
    });
    const result2 = await enforceIdempotency(ctx2);
    expect(result2).toBeDefined();
    expect(result2!.replayed).toBeDefined();
    expect(result2!.replayed!.status).toBe(201);
    expect((result2!.replayed!.body as any).data.ok).toBe(true);
  });

  it('throws idempotencyConflict when the same key is reused with a different body', async () => {
    const { enforceIdempotency, storeIdempotency } = createIdempotencyMiddleware({
      idempotencyRepo,
    });
    const key = 'idem-conflict-' + generateId('t');
    const actor: Actor = { kind: 'guest', guestSessionId: 'gs_conflict' };

    // First request with body A.
    const ctx1 = makeCtx({
      headers: { 'idempotency-key': key },
      body: { input: 'A' },
      actor,
    });
    await enforceIdempotency(ctx1);
    await storeIdempotency(ctx1, 201, { data: { ok: true }, meta: {} });

    // Second request with body B → conflict.
    const ctx2 = makeCtx({
      headers: { 'idempotency-key': key },
      body: { input: 'B' },
      actor,
    });
    await expect(enforceIdempotency(ctx2)).rejects.toThrow(ApiError);
    await expect(enforceIdempotency(ctx2)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
  });

  it('computeRequestHash is deterministic for the same body', () => {
    const body = { a: 1, b: 'x' };
    expect(computeRequestHash(body)).toBe(computeRequestHash(body));
  });

  it('computeRequestHash differs for different bodies', () => {
    expect(computeRequestHash({ a: 1 })).not.toBe(computeRequestHash({ a: 2 }));
  });
});

// ===========================================================================
// rate-limit middleware
// ===========================================================================

describe('rate-limit middleware', () => {
  it('allows requests under the limit and blocks when exceeded', () => {
    const limiter = new RateLimiter([
      { scope: 'guest', operation: 'testOp', max: 2, windowMs: 60_000 },
    ]);
    const key = 'guest:gs1:testOp';

    const r1 = limiter.check(key, 'testOp');
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);

    const r2 = limiter.check(key, 'testOp');
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);

    const r3 = limiter.check(key, 'testOp');
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);
    expect(r3.limit).toBe(2);
  });

  it('returns Infinity remaining when no config matches', () => {
    const limiter = new RateLimiter([]);
    const r = limiter.check('guest:gs1:unknownOp', 'unknownOp');
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(Infinity);
  });

  it('tracks different keys independently', () => {
    const limiter = new RateLimiter([
      { scope: 'guest', operation: 'op', max: 1, windowMs: 60_000 },
    ]);
    const r1 = limiter.check('guest:gs1:op', 'op');
    const r2 = limiter.check('guest:gs2:op', 'op');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });
});
