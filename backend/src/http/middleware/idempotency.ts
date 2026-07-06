import { createHash } from 'node:crypto';
import { ApiError } from '../errors';
import type { RouteContext } from '../route-registry';
import type { IdempotencyRepo } from '../../repo/idempotency-repo';

export interface IdempotencyMiddlewareDeps {
  idempotencyRepo: IdempotencyRepo;
}

export interface IdempotencyReplay {
  replayed?: { status: number; body: unknown };
}

/**
 * Compute the SHA-256 hash of the request body for idempotency comparison.
 *
 * `undefined`/`null` bodies are normalised to `null` so the hash is stable.
 */
export function computeRequestHash(body: unknown): string {
  const json = JSON.stringify(body ?? null);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Idempotency middleware factory.
 *
 * Returns `enforceIdempotency` (called before the handler) and
 * `storeIdempotency` (called after the handler succeeds) for the
 * RouteRegistry hooks.
 *
 * Flow:
 *   1. No `Idempotency-Key` header → skip.
 *   2. Key found + hash matches → return `{ replayed: { status, body } }` so
 *      the registry replays the original response without calling the handler.
 *   3. Key found + hash mismatch → throw `ApiError.idempotencyConflict()`.
 *   4. Key not found → create a pending record (null response) and return
 *      void so the handler runs. `storeIdempotency` then fills in the response.
 */
export function createIdempotencyMiddleware(deps: IdempotencyMiddlewareDeps) {
  // Per-ctx pending record metadata, shared between enforce and store.
  const pending = new WeakMap<
    RouteContext,
    { recordId: string; requestHash: string }
  >();

  async function enforceIdempotency(
    ctx: RouteContext,
  ): Promise<IdempotencyReplay | void> {
    const key = ctx.headers['idempotency-key'];
    if (!key) return;

    // Only user/guest actors are idempotency-tracked.
    if (ctx.actor.kind !== 'user' && ctx.actor.kind !== 'guest') return;
    const actorId = ctx.actor.userId ?? ctx.actor.guestSessionId!;

    const endpoint = ctx.operationId;
    const requestHash = computeRequestHash(ctx.body);

    const existing = await deps.idempotencyRepo.find(
      key,
      ctx.actor.kind,
      actorId,
      endpoint,
    );

    if (existing) {
      if (deps.idempotencyRepo.matchesHash(existing, requestHash)) {
        const body =
          existing.responseJson != null ? JSON.parse(existing.responseJson) : null;
        return {
          replayed: {
            status: existing.responseStatus ?? 201,
            body,
          },
        };
      }
      throw ApiError.idempotencyConflict();
    }

    // Reserve the key so concurrent requests collide on the unique index.
    const record = await deps.idempotencyRepo.create({
      key,
      requestHash,
      actorKind: ctx.actor.kind,
      actorId,
      endpoint,
    });
    pending.set(ctx, { recordId: record.id, requestHash });
  }

  async function storeIdempotency(
    ctx: RouteContext,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    const info = pending.get(ctx);
    if (!info) return;
    await deps.idempotencyRepo.updateResponse(info.recordId, statusCode, body);
    pending.delete(ctx);
  }

  return { enforceIdempotency, storeIdempotency };
}
