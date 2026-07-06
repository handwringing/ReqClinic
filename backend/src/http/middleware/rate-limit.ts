import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitConfig {
  /** Actor scope: `'guest'` or `'user'`. */
  scope: string;
  /** Operation identifier (matches the OpenAPI `operationId`). */
  operation: string;
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds?: number;
}

/**
 * Default rate limits aligned with API §2.3.
 *
 * The per-project concurrent AI-job limit (3, returns MODEL_BUSY) is enforced
 * separately by the job-creation path, not by this sliding-window limiter.
 */
export const DEFAULT_RATE_LIMITS: RateLimitConfig[] = [
  { scope: 'guest', operation: 'createQuickSession', max: 5, windowMs: 3_600_000 },
  { scope: 'guest', operation: 'postQuickSessionMessage', max: 60, windowMs: 3_600_000 },
  { scope: 'user', operation: 'createProject', max: 10, windowMs: 3_600_000 },
];

/**
 * In-memory sliding-window rate limiter.
 *
 * The key format is `${actorKind}:${actorId}:${operation}` (API §2.3). Each key
 * owns a list of request timestamps within the configured window; timestamps
 * older than the window are pruned on every check.
 */
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly lastCheck = new Map<string, RateLimitResult>();

  constructor(private readonly configs: RateLimitConfig[] = DEFAULT_RATE_LIMITS) {}

  /**
   * Check whether a request is allowed under the sliding-window limit.
   *
   * When `requestId` is provided the result is cached so the
   * {@link registerOnResponse} hook can stamp the `X-RateLimit-*` headers.
   */
  check(key: string, operation: string, requestId?: string): RateLimitResult {
    const actorKind = key.split(':')[0];
    const config = this.configs.find(
      (c) => c.scope === actorKind && c.operation === operation,
    );

    if (!config) {
      const result: RateLimitResult = {
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
      if (requestId) this.lastCheck.set(requestId, result);
      return result;
    }

    const nowMs = Date.now();
    const windowStart = nowMs - config.windowMs;
    let timestamps = this.windows.get(key) ?? [];
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= config.max) {
      const oldest = timestamps[0];
      const resetMs = oldest + config.windowMs;
      const result: RateLimitResult = {
        allowed: false,
        limit: config.max,
        remaining: 0,
        resetAt: new Date(resetMs).toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((resetMs - nowMs) / 1000)),
      };
      if (requestId) this.lastCheck.set(requestId, result);
      return result;
    }

    timestamps.push(nowMs);
    this.windows.set(key, timestamps);
    const resetMs = timestamps[0] + config.windowMs;
    const result: RateLimitResult = {
      allowed: true,
      limit: config.max,
      remaining: config.max - timestamps.length,
      resetAt: new Date(resetMs).toISOString(),
    };
    if (requestId) this.lastCheck.set(requestId, result);
    return result;
  }

  /** Stamp `X-RateLimit-*` headers onto a reply. */
  applyHeaders(reply: FastifyReply, result: RateLimitResult): void {
    if (result.limit === Infinity) return;
    reply.header('X-RateLimit-Limit', String(result.limit));
    reply.header('X-RateLimit-Remaining', String(result.remaining));
    reply.header('X-RateLimit-Reset', result.resetAt);
  }

  /**
   * Register an `onResponse` hook that copies the cached check result onto the
   * response headers. Requires `check` to have been called with the same
   * `requestId`.
   */
  registerOnResponse(app: FastifyInstance): void {
    app.addHook(
      'onResponse',
      async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const rid = req.requestId;
        if (!rid) return;
        const result = this.lastCheck.get(rid);
        if (result) {
          this.applyHeaders(reply, result);
          this.lastCheck.delete(rid);
        }
      },
    );
  }
}
