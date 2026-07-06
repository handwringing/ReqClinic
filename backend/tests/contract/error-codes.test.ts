import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildContractApp,
  type ContractFixtures,
} from './helpers/full-app';

/**
 * Error-code contract (Task 32).
 *
 * Exercises the key error scenarios declared in the OpenAPI spec and asserts
 * both the status code and the machine-readable `error.code`:
 *
 *   401 UNAUTHENTICATED  — protected route without an auth cookie
 *   403 AGREEMENT_REQUIRED — AI-gated operation without consent
 *   403 FORBIDDEN        — non-member accessing a project resource
 *   404 NOT_FOUND        — resource does not exist
 *   409 VERSION_CONFLICT — stale `expected_version`
 *   409 GATE_NOT_PASSED  — gate reject / wrong phase
 *   400 VALIDATION_ERROR — missing required requestBody field
 *
 * Complements the per-domain routes-*.test.ts suites with a cross-domain
 * view of the error contract.
 */

let fx: ContractFixtures;

beforeAll(async () => {
  fx = await buildContractApp();
});

afterAll(async () => {
  await fx.app.close();
});

// ── 401 UNAUTHENTICATED ─────────────────────────────────────────────────────

describe('401 UNAUTHENTICATED — protected routes without auth', () => {
  const protectedRoutes: Array<[string, string, string]> = [
    ['GET', '/api/v1/projects/{id}/drivers', 'listDrivers'],
    ['POST', '/api/v1/projects/{id}/drivers', 'createDriver'],
    ['GET', '/api/v1/quick-sessions/{id}', 'getQuickSession'],
    ['GET', '/api/v1/training-attempts/{id}', 'getTrainingAttempt'],
    ['GET', '/api/v1/metrics/quick-completion-rate', 'getQuickCompletionRate'],
    ['GET', '/api/v1/projects/{id}', 'getProject'],
  ];

  for (const [method, pathTpl, op] of protectedRoutes) {
    it(`${op} returns 401 UNAUTHENTICATED without auth`, async () => {
      const url = pathTpl
        .replace('{id}', fx.projectId)
        .replace('{id}', fx.quickSessionId);
      const res = await fx.inject(method, url, {
        body: method === 'POST' ? {} : undefined,
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  }
});

// ── 403 AGREEMENT_REQUIRED ─────────────────────────────────────────────────

describe('403 AGREEMENT_REQUIRED — AI-gated operation without consent', () => {
  it('createAnalysisRun returns 403 AGREEMENT_REQUIRED for user without consent', async () => {
    const res = await fx.inject(
      'POST',
      `/api/v1/projects/${fx.projectId}/analysis-runs`,
      {
        body: { task: 'domain_profile' },
        ...fx.asOutsider(),
      },
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
  });

  it('createTrainingAttempt returns 403 AGREEMENT_REQUIRED for user without consent', async () => {
    const res = await fx.inject('POST', '/api/v1/training-attempts', {
      body: {
        case_id: fx.trainingCaseId,
        case_version: '1.0.0',
      },
      ...fx.asOutsider(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('AGREEMENT_REQUIRED');
  });
});

// ── 403 FORBIDDEN ───────────────────────────────────────────────────────────

describe('403 FORBIDDEN — non-member accessing project resource', () => {
  it('listDrivers returns 403 FORBIDDEN for a non-member', async () => {
    const res = await fx.inject(
      'GET',
      `/api/v1/projects/${fx.projectId}/drivers`,
      fx.asOutsider(),
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('getProject returns 403 FORBIDDEN for a non-member', async () => {
    const res = await fx.inject(
      'GET',
      `/api/v1/projects/${fx.projectId}`,
      fx.asOutsider(),
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

// ── 404 NOT_FOUND ───────────────────────────────────────────────────────────

describe('404 NOT_FOUND — resource does not exist', () => {
  // Note: getProject intentionally returns 403 for unknown ids to avoid
  // project-id enumeration (membership gate fires before existence check).
  // 404 NOT_FOUND is exercised here via resources that genuinely 404.

  it('getQuickSession returns 404 NOT_FOUND for an unknown session', async () => {
    const res = await fx.inject(
      'GET',
      '/api/v1/quick-sessions/qs_unknown',
      fx.asOwner(),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('getConflictDetail returns 404 NOT_FOUND for an unknown conflict', async () => {
    const res = await fx.inject(
      'GET',
      '/api/v1/conflicts/cfl_unknown',
      fx.asOwner(),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('getJobStatus returns 404 NOT_FOUND for an unknown job', async () => {
    const res = await fx.inject(
      'GET',
      '/api/v1/ai-jobs/job_unknown',
      fx.asOwner(),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── 409 VERSION_CONFLICT ────────────────────────────────────────────────────

describe('409 VERSION_CONFLICT — stale expected_version', () => {
  it('updateDriver returns 409 VERSION_CONFLICT on stale version', async () => {
    const res = await fx.inject('PATCH', `/api/v1/drivers/${fx.driverId}`, {
      body: { statement: '过期', expected_version: 999 },
      ...fx.asOwner(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect(res.body.error.retryable).toBe(true);
  });

  it('updateOutcome returns 409 VERSION_CONFLICT on stale version', async () => {
    const res = await fx.inject('PATCH', `/api/v1/outcomes/${fx.outcomeId}`, {
      body: { description: '过期', expected_version: 999 },
      ...fx.asOwner(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('updateRequirement returns 409 VERSION_CONFLICT on stale version', async () => {
    const res = await fx.inject(
      'PATCH',
      `/api/v1/requirements/${fx.requirementId}`,
      {
        body: { statement: '过期', expected_version: 999 },
        ...fx.asOwner(),
      },
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });
});

// ── 409 GATE_NOT_PASSED ─────────────────────────────────────────────────────

describe('409 GATE_NOT_PASSED — gate blocking', () => {
  it('reviewGate returns 409 GATE_NOT_PASSED on reject', async () => {
    const res = await fx.inject(
      'POST',
      `/api/v1/projects/${fx.projectId}/gates/scope/reviews`,
      {
        body: { action: 'reject', entity_version: 1, reason: '拒绝' },
        ...fx.asOwner(),
      },
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('GATE_NOT_PASSED');
  });
});

// ── 400 VALIDATION_ERROR ────────────────────────────────────────────────────

describe('400 VALIDATION_ERROR — missing required requestBody fields', () => {
  it('startAccountRecovery returns 400 when account_hint is missing', async () => {
    const res = await fx.inject('POST', '/api/v1/auth/recovery/start', {
      body: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('createDriver returns 400 when driver_type is missing', async () => {
    const res = await fx.inject('POST', `/api/v1/projects/${fx.projectId}/drivers`, {
      body: { statement: '缺少类型' },
      ...fx.asOwner(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('acceptAgreement returns 400 when scope is missing', async () => {
    const res = await fx.inject(
      'POST',
      `/api/v1/agreements/${fx.agreementVersionId}/accept`,
      {
        body: {},
        cookies: { guest_session: fx.guestSessionKey },
      },
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('createAcceptanceCriterion returns 400 when required fields are missing', async () => {
    const res = await fx.inject(
      'POST',
      `/api/v1/requirements/${fx.requirementId}/acceptance-criteria`,
      {
        body: {},
        ...fx.asOwner(),
      },
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('createFutureScenario returns 400 when name is missing', async () => {
    const res = await fx.inject(
      'POST',
      `/api/v1/projects/${fx.projectId}/future-scenarios`,
      {
        body: { description: '缺少名称' },
        ...fx.asOwner(),
      },
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── success status codes match OpenAPI for key write operations ─────────────

describe('success status codes match OpenAPI for representative writes', () => {
  it('createDriver returns 201 (OpenAPI success)', async () => {
    const res = await fx.inject('POST', `/api/v1/projects/${fx.projectId}/drivers`, {
      body: { driver_type: 'goal', statement: '契约状态码验证' },
      ...fx.asOwner(),
    });
    expect(res.statusCode).toBe(201);
  });

  it('resolveConflict returns 200 (OpenAPI success, not 201)', async () => {
    // Seed a fresh open conflict for resolution.
    const res = await fx.inject('POST', `/api/v1/conflicts/${fx.conflictId}/resolve`, {
      body: {
        decision: {
          question: '采用哪个方案?',
          selected_option_id: fx.conflictOptionId,
          rationale: '契约测试方案',
        },
        owner_id: fx.ownerId,
        expected_version: 1,
      },
      ...fx.asOwner(),
    });
    expect(res.statusCode).toBe(200);
  });

  it('logout returns 200 (OpenAPI success, not 204)', async () => {
    const res = await fx.inject('POST', '/api/v1/auth/logout', fx.asOwner());
    expect(res.statusCode).toBe(200);
    expect(res.body.data.logged_out).toBe(true);
  });
});
