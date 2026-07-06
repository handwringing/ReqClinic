import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { createDb, type AppDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

/**
 * Create a fresh in-memory SQLite database with migrations applied.
 *
 * Each call yields an independent database, so tests never share state. Use
 * `:memory:` so nothing touches the filesystem.
 */
export function createTestDb(): AppDb {
  const db = createDb(':memory:');
  runMigrations(db.raw);
  return db;
}

export interface InjectOptions {
  payload?: unknown;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  query?: Record<string, string | string[]>;
}

export interface InjectResult {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface TestAppHandle {
  app: FastifyInstance;
  db: AppDb;
  /** Light-my-request injection helper bound to the test app. */
  inject: (
    method: string,
    url: string,
    opts?: InjectOptions,
  ) => Promise<InjectResult>;
}

/**
 * Build a Fastify app wired to an isolated in-memory database, plus a tiny
 * `inject` helper for issuing requests without binding a TCP port.
 */
export async function createTestApp(): Promise<TestAppHandle> {
  const db = createTestDb();
  const app = await buildApp({ db });

  const inject = async (
    method: string,
    url: string,
    opts: InjectOptions = {},
  ): Promise<InjectResult> => {
    const res = await app.inject({
      method,
      url,
      payload: opts.payload as string | object | undefined,
      headers: opts.headers,
      cookies: opts.cookies,
      query: opts.query,
    });
    return {
      statusCode: res.statusCode,
      body: parseBody(res),
      headers: res.headers as Record<string, string>,
    };
  };

  return { app, db, inject };
}

function parseBody(res: { body: string; headers: Record<string, string> }): unknown {
  const ct = res.headers['content-type'];
  if (typeof ct === 'string' && ct.includes('application/json')) {
    try {
      return JSON.parse(res.body);
    } catch {
      return res.body;
    }
  }
  return res.body;
}
