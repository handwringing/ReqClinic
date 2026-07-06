import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadOpenApi, type OperationSpec } from '../../src/http/openapi-loader';
import {
  buildContractApp,
  buildOperationUrl,
  successStatus,
  hasRequiredBody,
  type ContractFixtures,
} from './helpers/full-app';

/**
 * Path/method alignment contract (Task 32).
 *
 * For every one of the 108 declared operationIds, probes the route at the
 * OpenAPI-declared path + method and asserts:
 *
 *  1. The route is actually mounted — the response is NOT a Fastify routing
 *     404 (`{ error: "Not Found" }`). A business-level 401/403/404/400 with
 *     the contract envelope `{ error: { code, ... } }` proves the handler ran.
 *  2. For GET probes that succeed (2xx), the status code matches the first
 *     2xx status declared in the OpenAPI spec.
 *
 * This is the systematic sanity check that catches path/method/registration
 * drift between the spec and the mounted Fastify routes.
 */

const operations = Array.from(loadOpenApi().values()).sort((a, b) =>
  a.operationId.localeCompare(b.operationId),
);

let fx: ContractFixtures;

beforeAll(async () => {
  fx = await buildContractApp();
});

afterAll(async () => {
  await fx.app.close();
});

/**
 * A Fastify routing-404 body looks like `{ error: "Not Found", message,
 * statusCode }` (error is a string). A contract response — success or
 * business error — always has `body.error` as an object (errors) or
 * `body.data` (success). So `error` being a string signals the route was
 * never matched.
 */
function isFastifyRouting404(res: { statusCode: number; body: any }): boolean {
  return res.statusCode === 404 && typeof res.body?.error === 'string';
}

describe('path/method alignment — every operationId is mounted at its declared path+method', () => {
  for (const op of operations) {
    it(`${op.operationId} — ${op.method.toUpperCase()} ${op.path}`, async () => {
      const url = buildOperationUrl(op.operationId, fx);
      const opts: { body?: unknown; cookies: Record<string, string> } = {
        cookies: { auth_session: fx.ownerId },
      };
      // For operations with a required body, send an empty object so the
      // handler runs far enough to return a contract validation error (400)
      // rather than a body-parse failure.
      if (hasRequiredBody(op)) opts.body = {};

      const res = await fx.inject(op.method.toUpperCase(), url, opts);

      // 1. Route must be mounted (not a Fastify routing 404).
      expect(
        isFastifyRouting404(res),
        `${op.operationId}: Fastify routing 404 at ${op.method.toUpperCase()} ${url} → route not mounted`,
      ).toBe(false);

      // 2. For GET probes that succeed, the status must match the spec.
      if (op.method === 'get' && res.statusCode >= 200 && res.statusCode < 300) {
        expect(
          res.statusCode,
          `${op.operationId}: success status ${res.statusCode} != spec ${successStatus(op)}`,
        ).toBe(successStatus(op));
      }
    });
  }
});

describe('operation count sanity', () => {
  it('probes exactly 108 operationIds', () => {
    expect(operations.length).toBe(108);
  });
});
