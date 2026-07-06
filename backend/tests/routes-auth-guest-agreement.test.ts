import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

import { RouteRegistry } from '../src/http/route-registry';
import { loadOpenApi } from '../src/http/openapi-loader';
import { createAuthMiddleware } from '../src/http/middleware/auth';
import {
  registerAuthRoutes,
  registerGuestRoutes,
  registerAgreementRoutes,
} from '../src/http/routes/v1';
import { createTestDb, type AppDb } from './helpers/test-db';
import { UserRepo } from '../src/repo/user-repo';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import { AgreementRepo } from '../src/repo/agreement-repo';
import { QuickSessionRepo } from '../src/repo/quick-session-repo';
import { agreementVersions } from '../src/db/schema/identity';
import { env } from '../src/config/env';
import { now } from '../src/shared/time';
import { generateId } from '../src/shared/id';

/**
 * Route-level tests for the auth / guest / agreement endpoints
 * (Task 11-12, 11 operationIds).
 *
 * Builds a standalone Fastify app with the RouteRegistry wired to an
 * in-memory SQLite database, the auth middleware (cookie-based actor
 * resolution) and the three route modules under test. Each section
 * exercises the contract declared in `docs/03-api-openapi.yaml`.
 */
describe('auth, guest, and agreement routes (Task 11-12)', () => {
  let db: AppDb;
  let app: FastifyInstance;
  let userRepo: UserRepo;
  let guestSessionRepo: GuestSessionRepo;
  let agreementRepo: AgreementRepo;
  let quickSessionRepo: QuickSessionRepo;

  // Fixtures.
  let userId: string;
  let agreementVersionId: string;

  beforeAll(async () => {
    db = createTestDb();

    // ── Wire up the app with the RouteRegistry ────────────────────────────
    app = Fastify({ logger: false });
    await app.register(cookie);

    userRepo = new UserRepo(db.db);
    guestSessionRepo = new GuestSessionRepo(db.db, env.SERVER_PEPPER);
    agreementRepo = new AgreementRepo(db.db);
    quickSessionRepo = new QuickSessionRepo(db.db);

    const auth = createAuthMiddleware({ userRepo, guestSessionRepo });

    const registry = new RouteRegistry(loadOpenApi());
    registerAuthRoutes(registry, { userRepo, guestSessionRepo });
    registerGuestRoutes(registry, { guestSessionRepo, quickSessionRepo });
    registerAgreementRoutes(registry, { agreementRepo });

    await registry.applyTo(app, db, {
      resolveActor: auth.resolveActor,
    });
    await app.ready();

    // ── Seed a user ───────────────────────────────────────────────────────
    const user = await userRepo.create({
      displayName: '测试用户',
      authSubject: 'auth|test-user',
      email: 'test@example.com',
    });
    userId = user.id;

    // ── Seed an active agreement version ──────────────────────────────────
    agreementVersionId = generateId('agrv');
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
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ statusCode: number; body: any; headers: Record<string, string> }> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
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
  }

  function asUser(cookies: Record<string, string> = {}) {
    return { cookies: { auth_session: userId, ...cookies } };
  }

  // ── createGuestSession ──────────────────────────────────────────────────────

  describe('POST /api/v1/guest-sessions (createGuestSession)', () => {
    it('returns 201 with id, session_key, created_at, and expires_at', async () => {
      const res = await inject('POST', '/api/v1/guest-sessions');

      expect(res.statusCode).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toMatch(/^gst_/);
      expect(res.body.data.session_key).toBeTruthy();
      expect(typeof res.body.data.session_key).toBe('string');
      expect(res.body.data.session_key.length).toBeGreaterThan(0);
      expect(res.body.data.created_at).toBeTruthy();
      expect(res.body.data.expires_at).toBeTruthy();
      expect(res.body.meta.request_id).toMatch(/^req_/);
    });

    it('sets a guest_session HttpOnly cookie with SameSite=Strict', async () => {
      const res = await inject('POST', '/api/v1/guest-sessions');

      expect(res.statusCode).toBe(201);
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('guest_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Path=/');
    });

    it('persists only the digest; the raw key is not stored', async () => {
      const res = await inject('POST', '/api/v1/guest-sessions');
      const sessionKey = res.body.data.session_key;
      const sessionId = res.body.data.id;

      // The repo can find the session by the raw key (computes digest).
      const found = await guestSessionRepo.findBySessionKey(sessionKey);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(sessionId);

      // But the raw key is not the digest column value.
      expect(found!.sessionKeyDigest).not.toBe(sessionKey);
    });
  });

  // ── getCurrentGuestSession ──────────────────────────────────────────────────

  describe('GET /api/v1/guest-sessions/current (getCurrentGuestSession)', () => {
    it('returns 200 with the current guest session when a cookie is present', async () => {
      // First create a guest session to get a valid key.
      const createRes = await inject('POST', '/api/v1/guest-sessions');
      const sessionKey = createRes.body.data.session_key;

      const res = await inject('GET', '/api/v1/guest-sessions/current', {
        cookies: { guest_session: sessionKey },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(createRes.body.data.id);
      expect(res.body.data.created_at).toBeTruthy();
      expect(res.body.data.last_active_at).toBeTruthy();
      // The session_key must never be returned again (§3A.2).
      expect(res.body.data.session_key).toBeUndefined();
    });

    it('returns 404 when no guest session cookie is present', async () => {
      const res = await inject('GET', '/api/v1/guest-sessions/current');

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 for an invalid guest session key', async () => {
      const res = await inject('GET', '/api/v1/guest-sessions/current', {
        cookies: { guest_session: 'invalid-key-that-does-not-exist' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── getActiveAgreement ──────────────────────────────────────────────────────

  describe('GET /api/v1/agreements/active (getActiveAgreement)', () => {
    it('returns 200 with the active agreement version', async () => {
      const res = await inject('GET', '/api/v1/agreements/active');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(agreementVersionId);
      expect(res.body.data.version).toBe('1.0.0');
      expect(res.body.data.change_type).toBe('major');
      expect(res.body.data.effective_at).toBeTruthy();
      expect(res.body.data.content_ref).toBe('test://agreement.md');
    });
  });

  // ── acceptAgreement + listAgreementConsents ────────────────────────────────

  describe('POST /api/v1/agreements/:versionId/accept (acceptAgreement)', () => {
    let consentId: string;
    let guestSessionKey: string;

    it('returns 201 with consent details for a guest actor', async () => {
      // Create a guest session so the actor resolves to `guest`.
      const createRes = await inject('POST', '/api/v1/guest-sessions');
      guestSessionKey = createRes.body.data.session_key;

      const res = await inject(
        'POST',
        `/api/v1/agreements/${agreementVersionId}/accept`,
        {
          body: { scope: 'all' },
          cookies: { guest_session: guestSessionKey },
        },
      );

      expect(res.statusCode).toBe(201);
      expect(res.body.data.consent_id).toMatch(/^agrc_/);
      expect(res.body.data.agreement_version_id).toBe(agreementVersionId);
      expect(res.body.data.action).toBe('accepted');
      expect(res.body.data.occurred_at).toBeTruthy();
      consentId = res.body.data.consent_id;
    });

    it('records the consent so listAgreementConsents returns it', async () => {
      const res = await inject(
        'GET',
        '/api/v1/agreements/consents',
        { cookies: { guest_session: guestSessionKey } },
      );

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const found = res.body.data.find(
        (c: any) => c.id === consentId,
      );
      expect(found).toBeDefined();
      expect(found.action).toBe('accepted');
      expect(found.agreement_version_id).toBe(agreementVersionId);
    });

    it('makes hasValidConsent return true', async () => {
      const guestSession =
        await guestSessionRepo.findBySessionKey(guestSessionKey);
      const ok = await agreementRepo.hasValidConsent({
        guestSessionId: guestSession!.id,
      });
      expect(ok).toBe(true);
    });
  });

  // ── withdrawAgreementConsent ───────────────────────────────────────────────

  describe('POST /api/v1/agreements/consents/:id/withdraw (withdrawAgreementConsent)', () => {
    it('returns 200, records a withdrawn action, and invalidates consent', async () => {
      // Setup: guest accepts the agreement.
      const createRes = await inject('POST', '/api/v1/guest-sessions');
      const guestSessionKey = createRes.body.data.session_key;
      const guestSession =
        await guestSessionRepo.findBySessionKey(guestSessionKey);

      const acceptRes = await inject(
        'POST',
        `/api/v1/agreements/${agreementVersionId}/accept`,
        {
          body: { scope: 'all' },
          cookies: { guest_session: guestSessionKey },
        },
      );
      const consentId = acceptRes.body.data.consent_id;

      // Pre-condition: consent is valid.
      expect(
        await agreementRepo.hasValidConsent({
          guestSessionId: guestSession!.id,
        }),
      ).toBe(true);

      // Act: withdraw.
      const res = await inject(
        'POST',
        `/api/v1/agreements/consents/${consentId}/withdraw`,
        { cookies: { guest_session: guestSessionKey } },
      );

      expect(res.statusCode).toBe(200);
      // withdrawConsent creates a new `action='withdrawn'` row that mirrors
      // the original's actor fields; the response returns the new record's id.
      expect(res.body.data.consent_id).toMatch(/^agrc_/);
      expect(res.body.data.action).toBe('withdrawn');
      expect(res.body.data.occurred_at).toBeTruthy();

      // Post-condition: hasValidConsent is now false.
      expect(
        await agreementRepo.hasValidConsent({
          guestSessionId: guestSession!.id,
        }),
      ).toBe(false);
    });

    it('returns 404 when withdrawing another actor’s consent', async () => {
      // Guest A accepts.
      const createA = await inject('POST', '/api/v1/guest-sessions');
      const keyA = createA.body.data.session_key;
      const acceptA = await inject(
        'POST',
        `/api/v1/agreements/${agreementVersionId}/accept`,
        { body: { scope: 'all' }, cookies: { guest_session: keyA } },
      );
      const consentIdA = acceptA.body.data.consent_id;

      // Guest B tries to withdraw A's consent → 404 (non-ownership folded
      // into NOT_FOUND so existence is not enumerable, §3B.4).
      const createB = await inject('POST', '/api/v1/guest-sessions');
      const keyB = createB.body.data.session_key;
      const res = await inject(
        'POST',
        `/api/v1/agreements/consents/${consentIdA}/withdraw`,
        { cookies: { guest_session: keyB } },
      );

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── reacceptAgreement ───────────────────────────────────────────────────────

  describe('POST /api/v1/agreements/:versionId/reaccept (reacceptAgreement)', () => {
    it('returns 201 with action=reaccepted', async () => {
      const createRes = await inject('POST', '/api/v1/guest-sessions');
      const guestSessionKey = createRes.body.data.session_key;

      const res = await inject(
        'POST',
        `/api/v1/agreements/${agreementVersionId}/reaccept`,
        {
          body: { scope: 'all' },
          cookies: { guest_session: guestSessionKey },
        },
      );

      expect(res.statusCode).toBe(201);
      expect(res.body.data.consent_id).toMatch(/^agrc_/);
      expect(res.body.data.agreement_version_id).toBe(agreementVersionId);
      expect(res.body.data.action).toBe('reaccepted');
      expect(res.body.data.occurred_at).toBeTruthy();
    });
  });

  // ── getAuthSession ─────────────────────────────────────────────────────────

  describe('GET /api/v1/auth/session (getAuthSession)', () => {
    it('returns null data when unauthenticated', async () => {
      const res = await inject('GET', '/api/v1/auth/session');

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toBeNull();
      expect(res.body.meta.request_id).toMatch(/^req_/);
    });

    it('returns authenticated user info when logged in', async () => {
      const res = await inject(
        'GET',
        '/api/v1/auth/session',
        asUser(),
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.authenticated).toBe(true);
      expect(res.body.data.user.id).toBe(userId);
      expect(res.body.data.user.display_name).toBe('测试用户');
      expect(res.body.data.user.email).toBe('test@example.com');
      expect(Array.isArray(res.body.data.capabilities)).toBe(true);
    });
  });

  // ── logout ──────────────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/logout (logout)', () => {
    it('returns 200 with logged_out:true', async () => {
      const res = await inject('POST', '/api/v1/auth/logout', asUser());

      expect(res.statusCode).toBe(200);
      expect(res.body.data.logged_out).toBe(true);
      expect(res.body.meta.request_id).toMatch(/^req_/);
    });

    it('clears the auth_session cookie', async () => {
      const res = await inject('POST', '/api/v1/auth/logout', asUser());

      expect(res.statusCode).toBe(200);
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('auth_session=');
      // Clearing a cookie sets it empty or with a past expiry.
      expect(setCookie).toMatch(/auth_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
    });

    it('succeeds (200) even when not logged in', async () => {
      const res = await inject('POST', '/api/v1/auth/logout');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.logged_out).toBe(true);
    });
  });

  // ── startAccountRecovery ────────────────────────────────────────────────────

  describe('POST /api/v1/auth/recovery/start (startAccountRecovery)', () => {
    it('returns 202 with accepted:true and a non-leaking message', async () => {
      const res = await inject(
        'POST',
        '/api/v1/auth/recovery/start',
        { body: { account_hint: 'user@example.com' } },
      );

      expect(res.statusCode).toBe(202);
      expect(res.body.data.accepted).toBe(true);
      expect(res.body.data.message).toBeTruthy();
    });

    it('returns 400 for an empty account_hint', async () => {
      const res = await inject(
        'POST',
        '/api/v1/auth/recovery/start',
        { body: { account_hint: '' } },
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when account_hint is missing', async () => {
      const res = await inject(
        'POST',
        '/api/v1/auth/recovery/start',
        { body: {} },
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── claimQuickSession ───────────────────────────────────────────────────────

  describe('POST /api/v1/quick-sessions/:id/claim (claimQuickSession)', () => {
    it('transfers ownership to the user with dual proof', async () => {
      // 1. Create a guest session.
      const createGuest = await inject('POST', '/api/v1/guest-sessions');
      const guestSessionKey = createGuest.body.data.session_key;
      const guestSession =
        await guestSessionRepo.findBySessionKey(guestSessionKey);

      // 2. Create a quick session owned by the guest.
      const quickSession = quickSessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestSession!.id,
        sourceKind: 'custom',
        originalIdea: '测试快速问诊',
      });

      // 3. Claim it as the logged-in user, carrying the guest cookie.
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${quickSession.id}/claim`,
        {
          cookies: {
            auth_session: userId,
            guest_session: guestSessionKey,
          },
        },
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.quick_session_id).toBe(quickSession.id);
      expect(res.body.data.user_id).toBe(userId);
      expect(res.body.data.origin_guest_session_id).toBe(guestSession!.id);
      expect(res.body.data.claimed_at).toBeTruthy();
      expect(res.body.data.expires_at).toBeTruthy();

      // 4. Verify the ownership transfer in the DB.
      const updated = quickSessionRepo.findById(quickSession.id);
      expect(updated!.userId).toBe(userId);
      expect(updated!.guestSessionId).toBeNull();
      expect(updated!.originGuestSessionId).toBe(guestSession!.id);
      expect(updated!.claimedAt).toBeTruthy();
    });

    it('returns 409 QUICK_SESSION_CLAIMED when already claimed', async () => {
      // Create a guest session + quick session.
      const createGuest = await inject('POST', '/api/v1/guest-sessions');
      const guestSessionKey = createGuest.body.data.session_key;
      const guestSession =
        await guestSessionRepo.findBySessionKey(guestSessionKey);

      const quickSession = quickSessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestSession!.id,
        sourceKind: 'custom',
        originalIdea: '已认领测试',
      });

      // First claim succeeds.
      const firstClaim = await inject(
        'POST',
        `/api/v1/quick-sessions/${quickSession.id}/claim`,
        {
          cookies: {
            auth_session: userId,
            guest_session: guestSessionKey,
          },
        },
      );
      expect(firstClaim.statusCode).toBe(200);

      // Create a second user to attempt re-claim.
      const user2 = await userRepo.create({
        displayName: '第二用户',
        authSubject: 'auth|user2',
        email: 'user2@example.com',
      });

      // Second claim by a different user → 409.
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${quickSession.id}/claim`,
        {
          cookies: {
            auth_session: user2.id,
            guest_session: guestSessionKey,
          },
        },
      );

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe('QUICK_SESSION_CLAIMED');
    });

    it('returns 403 SESSION_CREDENTIAL_MISMATCH without a guest cookie', async () => {
      const createGuest = await inject('POST', '/api/v1/guest-sessions');
      const guestSessionKey = createGuest.body.data.session_key;
      const guestSession =
        await guestSessionRepo.findBySessionKey(guestSessionKey);

      const quickSession = quickSessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestSession!.id,
        sourceKind: 'custom',
        originalIdea: '无凭证测试',
      });

      // Claim without the guest_session cookie.
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${quickSession.id}/claim`,
        { cookies: { auth_session: userId } },
      );

      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe('SESSION_CREDENTIAL_MISMATCH');
    });

    it('returns 401 when not authenticated as a user', async () => {
      const createGuest = await inject('POST', '/api/v1/guest-sessions');
      const guestSessionKey = createGuest.body.data.session_key;
      const guestSession =
        await guestSessionRepo.findBySessionKey(guestSessionKey);

      const quickSession = quickSessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestSession!.id,
        sourceKind: 'custom',
        originalIdea: '游客认领测试',
      });

      // Claim with only the guest cookie (no auth_session) → 401 because
      // requireActor === 'user' is enforced by the registry.
      const res = await inject(
        'POST',
        `/api/v1/quick-sessions/${quickSession.id}/claim`,
        { cookies: { guest_session: guestSessionKey } },
      );

      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });
});
