import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { createTestDb } from './test-db';

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  query?: Record<string, string | string[]>;
}

export interface TestResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Build a Fastify app bound to a fresh in-memory database.
 *
 * Complements {@link createTestApp} for tests that prefer an explicit
 * `request(...)` helper over the bundled `inject`.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const db = createTestDb();
  return buildApp({ db });
}

/**
 * Issue a request against `app` via Fastify's in-process injector and return a
 * normalized `{ statusCode, body, headers }` triple.
 */
export async function request(
  app: FastifyInstance,
  method: string,
  url: string,
  opts: RequestOptions = {},
): Promise<TestResponse> {
  const res = await app.inject({
    method,
    url,
    payload: opts.body as string | object | undefined,
    headers: opts.headers,
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

  return {
    statusCode: res.statusCode,
    body,
    headers: res.headers as Record<string, string>,
  };
}
