import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, request } from './helpers/test-app';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with health and model readiness metadata', async () => {
    const res = await request(app, 'GET', '/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.ai).toEqual(
      expect.objectContaining({
        provider: expect.any(String),
        model: expect.any(String),
        model_api_ready: expect.any(Boolean),
      }),
    );
  });
});
