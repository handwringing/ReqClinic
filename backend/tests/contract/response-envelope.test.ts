import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildContractApp,
  type ContractFixtures,
} from './helpers/full-app';

/**
 * Response-envelope contract (Task 32).
 *
 * Verifies that every response — success or error — conforms to the envelope
 * shapes declared in the OpenAPI spec:
 *
 *   success: { data: ..., meta: { request_id: "req_..." } }
 *   error:   { error: { code, message, retryable, request_id } }
 *
 * Samples representative endpoints across every domain rather than
 * re-asserting per-operation status codes (covered by path-method-alignment
 * and the domain-specific routes-*.test.ts suites).
 */

let fx: ContractFixtures;

beforeAll(async () => {
  fx = await buildContractApp();
});

afterAll(async () => {
  await fx.app.close();
});

function assertRequestId(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(value as string).toMatch(/^req_/);
}

describe('success envelope — { data, meta: { request_id } }', () => {
  it('getAuthSession returns data + meta.request_id', async () => {
    const res = await fx.inject('GET', '/api/v1/auth/session', fx.asOwner());
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.authenticated).toBe(true);
    assertRequestId(res.body.meta.request_id);
  });

  it('getProject returns data + meta.request_id', async () => {
    const res = await fx.inject('GET', `/api/v1/projects/${fx.projectId}`, fx.asOwner());
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(fx.projectId);
    assertRequestId(res.body.meta.request_id);
  });

  it('listDrivers returns array data + meta.request_id', async () => {
    const res = await fx.inject(
      'GET',
      `/api/v1/projects/${fx.projectId}/drivers`,
      fx.asOwner(),
    );
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    assertRequestId(res.body.meta.request_id);
  });

  it('getConflictDetail returns data with id + meta.request_id', async () => {
    const res = await fx.inject(
      'GET',
      `/api/v1/conflicts/${fx.conflictId}`,
      fx.asOwner(),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(fx.conflictId);
    assertRequestId(res.body.meta.request_id);
  });

  it('getActiveAgreement returns data + meta.request_id', async () => {
    const res = await fx.inject('GET', '/api/v1/agreements/active');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(fx.agreementVersionId);
    assertRequestId(res.body.meta.request_id);
  });

  it('listDomainPacks returns array data + meta.request_id', async () => {
    const res = await fx.inject('GET', '/api/v1/domain-packs', fx.asOwner());
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    assertRequestId(res.body.meta.request_id);
  });

  it('logout returns { data: { logged_out }, meta }', async () => {
    const res = await fx.inject('POST', '/api/v1/auth/logout', fx.asOwner());
    expect(res.statusCode).toBe(200);
    expect(res.body.data.logged_out).toBe(true);
    assertRequestId(res.body.meta.request_id);
  });

  it('getQuickSession returns data + meta.request_id', async () => {
    const res = await fx.inject(
      'GET',
      `/api/v1/quick-sessions/${fx.quickSessionId}`,
      fx.asOwner(),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(fx.quickSessionId);
    assertRequestId(res.body.meta.request_id);
  });

  it('listTrainingCases returns array data + meta.request_id', async () => {
    const res = await fx.inject('GET', '/api/v1/training-cases', fx.asOwner());
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    assertRequestId(res.body.meta.request_id);
  });

  it('getTrainingAttempt returns data + meta.request_id', async () => {
    const res = await fx.inject(
      'GET',
      `/api/v1/training-attempts/${fx.trainingAttemptId}`,
      fx.asOwner(),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.attempt_id).toBe(fx.trainingAttemptId);
    assertRequestId(res.body.meta.request_id);
  });

  it('createGuestSession returns 201 data + meta.request_id', async () => {
    const res = await fx.inject('POST', '/api/v1/guest-sessions');
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toMatch(/^gst_/);
    assertRequestId(res.body.meta.request_id);
  });
});

describe('error envelope — { error: { code, message, retryable, request_id } }', () => {
  it('401 UNAUTHENTICATED has the full error envelope', async () => {
    const res = await fx.inject('GET', `/api/v1/projects/${fx.projectId}/drivers`);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof res.body.error.message).toBe('string');
    expect(typeof res.body.error.retryable).toBe('boolean');
    assertRequestId(res.body.error.request_id);
  });

  it('404 NOT_FOUND has the full error envelope', async () => {
    // getProject intentionally returns 403 for unknown ids (anti-enumeration),
    // so probe a quick-session lookup which genuinely returns 404.
    const res = await fx.inject(
      'GET',
      '/api/v1/quick-sessions/qs_does_not_exist',
      fx.asOwner(),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
    assertRequestId(res.body.error.request_id);
  });

  it('400 VALIDATION_ERROR has the full error envelope', async () => {
    const res = await fx.inject('POST', '/api/v1/auth/recovery/start', {
      body: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
    assertRequestId(res.body.error.request_id);
  });

  it('409 VERSION_CONFLICT has retryable=true', async () => {
    const res = await fx.inject('PATCH', `/api/v1/drivers/${fx.driverId}`, {
      body: { statement: '过期更新', expected_version: 999 },
      ...fx.asOwner(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect(res.body.error.retryable).toBe(true);
    assertRequestId(res.body.error.request_id);
  });

  it('409 GATE_NOT_PASSED on reviewGate reject', async () => {
    const res = await fx.inject(
      'POST',
      `/api/v1/projects/${fx.projectId}/gates/scope/reviews`,
      {
        body: { action: 'reject', entity_version: 1, reason: '范围不清晰' },
        ...fx.asOwner(),
      },
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('GATE_NOT_PASSED');
    assertRequestId(res.body.error.request_id);
  });
});
