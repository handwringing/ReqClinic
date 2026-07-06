import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ContractFixtures } from '../contract/helpers/full-app';
import { buildContractApp, buildOperationUrl } from '../contract/helpers/full-app';
import { UserRepo } from '../../src/repo/user-repo';
import { JobRepo } from '../../src/repo/job-repo';
import { AgreementRepo } from '../../src/repo/agreement-repo';

/**
 * Task 33.1 — Auth/authz, agreement gate, and withdraw→cancel-jobs integration.
 *
 * End-to-end flows that span the auth middleware, agreement gate, route
 * handlers, and (for withdrawal) the Job queue. Uses buildContractApp so all
 * v1 routes are wired with real middleware.
 */
describe('Task 33.1 — auth, agreement gate, withdraw→cancel-jobs', () => {
  let fx: ContractFixtures;
  let noConsentUserId: string;

  beforeAll(async () => {
    fx = await buildContractApp();

    // Create a user without agreement consent for agreement-gate tests.
    const userRepo = new UserRepo(fx.db.db);
    const noConsentUser = await userRepo.create({
      displayName: 'No Consent User',
      authSubject: 'auth|no-consent',
      email: 'no-consent@example.com',
    });
    noConsentUserId = noConsentUser.id;
  });

  afterAll(async () => {
    await fx.app.close();
  });

  const asNoConsent = () => ({ cookies: { auth_session: noConsentUserId } });
  const asGuest = () => ({ cookies: { guest_session: fx.guestSessionKey } });

  // ── Guest 权限边界 ───────────────────────────────────────────────────────

  describe('guest 越权 (guest accessing user-only endpoints)', () => {
    it('allows a guest to start a local formal project with a valid request', async () => {
      const url = buildOperationUrl('createProject', fx);
      const res = await fx.inject('POST', url, {
        ...asGuest(),
        body: {
          initial_request: '帮我把线下读书会活动策划成一个正式项目。',
          name: '读书会活动策划',
        },
      });
      expect(res.statusCode).toBe(202);
      expect((res.body as any).data.project_id).toMatch(/^prj_/);
    });

    it('blocks guest from createAnalysisRun', async () => {
      const url = buildOperationUrl('createAnalysisRun', fx);
      const res = await fx.inject('POST', url, {
        ...asGuest(),
        body: { task: 'domain_profile' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('blocks guest from compileReport', async () => {
      const url = buildOperationUrl('compileReport', fx);
      const res = await fx.inject('POST', url, {
        ...asGuest(),
        body: { baseline_id: fx.baselineId, audience: 'executive', language: 'zh-CN', template_id: 'tmpl', template_version: '1.0.0' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('does not expose another actor quick session to a guest upgrade request', async () => {
      const url = buildOperationUrl('upgradeQuickSession', fx);
      const res = await fx.inject('POST', url, {
        ...asGuest(),
        body: { brief_version: 1, expected_quick_session_version: 1 },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Review capability enforcement ──────────────────────────────────────────

  describe('review capability enforcement', () => {
    it('blocks non-member from reviewGate (403 FORBIDDEN)', async () => {
      const url = buildOperationUrl('reviewGate', fx);
      const res = await fx.inject('POST', url, {
        ...fx.asOutsider(),
        body: { action: 'accept', entity_version: 1, reason: 'test' },
      });
      expect(res.statusCode).toBe(403);
      expect((res.body as any).error.code).toBe('FORBIDDEN');
    });

    it('blocks non-member from reviewOutcome (403 FORBIDDEN)', async () => {
      const url = `/api/v1/outcomes/${fx.outcomeId}/reviews`;
      const res = await fx.inject('POST', url, {
        ...fx.asOutsider(),
        body: { action: 'accept', entity_version: 1, reason: 'test' },
      });
      expect(res.statusCode).toBe(403);
      expect((res.body as any).error.code).toBe('FORBIDDEN');
    });

    it('blocks non-member from reviewRequirement (403 FORBIDDEN)', async () => {
      const url = `/api/v1/requirements/${fx.requirementId}/reviews`;
      const res = await fx.inject('POST', url, {
        ...fx.asOutsider(),
        body: { action: 'accept', entity_version: 1, reason: 'test' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Agreement gate: 11 AI endpoints blocked without consent ────────────────

  describe('agreement gate (11 AI endpoints → 403 AGREEMENT_REQUIRED)', () => {
    // Helper: assert an operation returns 403 AGREEMENT_REQUIRED for a
    // no-consent actor. The agreement gate runs before the handler, so the
    // body/path only need to be valid enough to reach the gate (not the handler).
    // `auth` is the shape returned by asNoConsent()/asGuest() — i.e.
    // `{ cookies: { ... } }` — and is spread into the inject options so the
    // cookies land at the top level where Fastify expects them.
    async function expectAgreementRequired(
      method: string,
      url: string,
      body: unknown,
      auth: { cookies: Record<string, string> },
    ) {
      const res = await fx.inject(method, url, { body, ...auth });
      expect(res.statusCode).toBe(403);
      expect((res.body as any).error.code).toBe('AGREEMENT_REQUIRED');
    }

    it('blocks createProject without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('createProject', fx),
        { name: 'test' },
        asNoConsent(),
      );
    });

    it('blocks createAnalysisRun without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('createAnalysisRun', fx),
        { task: 'domain_profile' },
        asNoConsent(),
      );
    });

    it('blocks compileReport without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('compileReport', fx),
        { baseline_id: fx.baselineId, audience: 'executive', language: 'zh-CN', template_id: 'tmpl', template_version: '1.0.0' },
        asNoConsent(),
      );
    });

    it('blocks createQuickSession without consent (user)', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('createQuickSession', fx),
        { original_input: 'test', source_kind: 'custom' },
        asNoConsent(),
      );
    });

    it('blocks createQuickSession without consent (guest)', async () => {
      // Guest also needs consent for AI-gated operations.
      // Withdraw the guest's consent first.
      const agreementRepo = new AgreementRepo(fx.db.db);
      const guestConsent = await agreementRepo.findConsentByActor({
        guestSessionId: fx.guestSessionId,
      });
      expect(guestConsent).not.toBeNull();
      await agreementRepo.withdrawConsent(guestConsent!.id);

      await expectAgreementRequired(
        'POST',
        buildOperationUrl('createQuickSession', fx),
        { original_input: 'test', source_kind: 'custom' },
        asGuest(),
      );

      // Re-accept to restore the fixture for downstream tests.
      await agreementRepo.createConsent({
        agreementVersionId: fx.agreementVersionId,
        actorKind: 'guest',
        guestSessionId: fx.guestSessionId,
      });
    });

    it('blocks postQuickSessionMessage without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('postQuickSessionMessage', fx),
        { action: 'answer', content: 'test' },
        asNoConsent(),
      );
    });

    it('blocks reviewQuickSessionUnderstanding without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('reviewQuickSessionUnderstanding', fx),
        { action: 'correct' },
        asNoConsent(),
      );
    });

    it('blocks recordQuickSessionOptionPreference without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('recordQuickSessionOptionPreference', fx),
        { option_id: 'opt1', matches_ai_recommendation: true },
        asNoConsent(),
      );
    });

    it('blocks generateQuickSessionBrief without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('generateQuickSessionBrief', fx),
        { accept_incomplete: false },
        asNoConsent(),
      );
    });

    it('blocks upgradeQuickSession without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('upgradeQuickSession', fx),
        { brief_version: 1, expected_quick_session_version: 1 },
        asNoConsent(),
      );
    });

    it('blocks createTrainingAttempt without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('createTrainingAttempt', fx),
        { case_id: fx.trainingCaseId, case_version: '1.0.0' },
        asNoConsent(),
      );
    });

    it('blocks postTrainingQuestion without consent', async () => {
      await expectAgreementRequired(
        'POST',
        buildOperationUrl('postTrainingQuestion', fx),
        { question: 'test question' },
        asNoConsent(),
      );
    });
  });

  // ── Withdraw consent → cancel queued jobs + block new AI calls ─────────────

  describe('withdraw consent → cancel queued jobs + block AI calls', () => {
    // Uses a fresh app so withdrawal does not affect other test blocks.
    let localFx: ContractFixtures;

    beforeAll(async () => {
      localFx = await buildContractApp();
    });

    afterAll(async () => {
      await localFx.app.close();
    });

    it('cancels queued jobs and blocks subsequent AI calls', async () => {
      const jobRepo = new JobRepo(localFx.db.db);
      const agreementRepo = new AgreementRepo(localFx.db.db);

      // 1. Owner (with consent) creates an analysis run → job queued.
      const createUrl = buildOperationUrl('createAnalysisRun', localFx);
      const createRes = await localFx.inject('POST', createUrl, {
        ...localFx.asOwner(),
        body: { task: 'domain_profile', source_ids: [] },
      });
      expect(createRes.statusCode).toBe(202);
      const jobId = (createRes.body as any).data.job_id;
      expect(jobId).toBeDefined();

      // Verify the job is queued.
      const jobBefore = jobRepo.findById(jobId);
      expect(jobBefore?.status).toBe('queued');

      // 2. Withdraw the owner's consent.
      const ownerConsent = await agreementRepo.findConsentByActor({
        userId: localFx.ownerId,
      });
      expect(ownerConsent).not.toBeNull();

      const withdrawUrl = `/api/v1/agreements/consents/${ownerConsent!.id}/withdraw`;
      const withdrawRes = await localFx.inject('POST', withdrawUrl, {
        ...localFx.asOwner(),
        body: {},
      });
      expect(withdrawRes.statusCode).toBe(200);
      expect((withdrawRes.body as any).data.cancelled_jobs).toBe(1);

      // 3. Verify the queued job is now cancelled.
      const jobAfter = jobRepo.findById(jobId);
      expect(jobAfter?.status).toBe('cancelled');
      expect(jobAfter?.cancellationReason).toBe('agreement_withdrawn');
      expect(jobAfter?.cancelledByKind).toBe('system');

      // 4. Verify the next AI call returns 403 AGREEMENT_REQUIRED.
      const retryRes = await localFx.inject('POST', createUrl, {
        ...localFx.asOwner(),
        body: { task: 'domain_profile', source_ids: [] },
      });
      expect(retryRes.statusCode).toBe(403);
      expect((retryRes.body as any).error.code).toBe('AGREEMENT_REQUIRED');
    });

    it('does not cancel already-succeeded jobs', async () => {
      const jobRepo = new JobRepo(localFx.db.db);
      const agreementRepo = new AgreementRepo(localFx.db.db);

      // Re-accept agreement for this test.
      await agreementRepo.createConsent({
        agreementVersionId: localFx.agreementVersionId,
        actorKind: 'user',
        userId: localFx.ownerId,
      });

      // Create and manually succeed a job.
      const job = jobRepo.create({
        scopeKind: 'formal_project',
        projectId: localFx.projectId,
        taskType: 'domain_profile',
        payloadJson: '{}',
        inputHash: 'hash-succeed-test',
        dedupeKey: 'dedupe-succeed-test',
        createdByKind: 'user',
        createdByUserId: localFx.ownerId,
      });
      jobRepo.updateStatus(job.id, 'succeeded');

      // Withdraw consent.
      const consent = await agreementRepo.findConsentByActor({
        userId: localFx.ownerId,
      });
      const withdrawUrl = `/api/v1/agreements/consents/${consent!.id}/withdraw`;
      await localFx.inject('POST', withdrawUrl, {
        ...localFx.asOwner(),
        body: {},
      });

      // Succeeded job should NOT be cancelled (only queued jobs are).
      const jobAfter = jobRepo.findById(job.id);
      expect(jobAfter?.status).toBe('succeeded');
    });
  });
});
