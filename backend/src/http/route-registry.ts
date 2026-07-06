import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import type { AppDb } from '../db/client';
import type { OperationSpec } from './openapi-loader';
import { toRoutePath } from './openapi-loader';
import { ApiError } from './errors';
import { generateRequestId } from './middleware/request-id';

/**
 * Route registry.
 *
 * Guarantees that only operations declared in the OpenAPI spec can be mounted,
 * then turns each registered handler into a Fastify route. The registry owns
 * request-context assembly, ApiError → error-envelope translation, and success
 * wrapping into `{ data, meta: { request_id } }`.
 */

export type RouteHandler = (ctx: RouteContext) => Promise<any> | any;

export interface Actor {
  kind: 'guest' | 'user' | 'unauthenticated';
  userId?: string;
  guestSessionId?: string;
}

export interface RouteContext {
  app: FastifyInstance;
  db: AppDb;
  /** The OpenAPI operationId this request was matched to. */
  operationId: string;
  params: Record<string, string>;
  query: Record<string, any>;
  body: any;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  /** Populated by the auth middleware; defaults to `unauthenticated`. */
  actor: Actor;
  requestId: string;
  /**
   * The Fastify reply for the current request. Handlers that need to mutate
   * the response beyond the `{ data, meta }` envelope (e.g. setting or
   * clearing cookies) can read it here. Optional so context objects built
   * outside a live request (e.g. in tests) still type-check.
   */
  reply?: FastifyReply;
}

export interface RegisterOptions {
  /** Require an authenticated `user` actor; `'any'` (default) allows anyone. */
  requireActor?: 'user' | 'any';
  /** Require a valid agreement consent record before invoking the handler. */
  requireAgreement?: boolean;
  /** Enforce idempotency-key semantics for the write. */
  idempotent?: boolean;
}

export interface RouteDeps {
  /** Resolve the actor from the request; defaults to `unauthenticated`. */
  resolveActor?: (req: FastifyRequest) => Actor | Promise<Actor>;
  /** Validate agreement consent; invoked only when `requireAgreement` is set. */
  checkAgreement?: (ctx: RouteContext) => Promise<void> | void;
  /**
   * Enforce idempotency; invoked only when `idempotent` is set.
   *
   * When a replayable prior response exists, return `{ replayed: { status,
   * body } }` and the registry will send it directly without invoking the
   * handler.
   */
  enforceIdempotency?: (
    ctx: RouteContext,
  ) => Promise<{ replayed?: { status: number; body: unknown } } | void>;
  /**
   * Store the handler's final response on the idempotency record created by
   * `enforceIdempotency`. Called only when `idempotent` is set and the handler
   * succeeded.
   */
  storeIdempotency?: (
    ctx: RouteContext,
    statusCode: number,
    body: unknown,
  ) => Promise<void> | void;
}

interface RegisteredRoute {
  operationId: string;
  spec: OperationSpec;
  handler: RouteHandler;
  opts: RegisterOptions;
}

interface HandlerEnvelope {
  data: unknown;
  meta: Record<string, unknown>;
  statusCode?: number;
}

function isEnvelope(value: unknown): value is HandlerEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    'data' in v &&
    'meta' in v &&
    typeof v.meta === 'object' &&
    v.meta !== null
  );
}

export class RouteRegistry {
  private readonly operations: Map<string, OperationSpec>;
  private readonly routes = new Map<string, RegisteredRoute>();

  constructor(operations: Map<string, OperationSpec>) {
    this.operations = operations;
  }

  /**
   * Register a handler for `operationId`. Throws if the id is not declared in
   * the OpenAPI spec — the spec is the only authority on what routes exist.
   */
  register(
    operationId: string,
    handler: RouteHandler,
    opts: RegisterOptions = {},
  ): void {
    const spec = this.operations.get(operationId);
    if (!spec) {
      throw new Error(
        `Cannot register unknown operationId "${operationId}": it is not declared in the OpenAPI spec.`,
      );
    }
    this.routes.set(operationId, { operationId, spec, handler, opts });
  }

  /** Registered operationIds (for alignment checks against the spec). */
  getRegisteredIds(): string[] {
    return Array.from(this.routes.keys());
  }

  /**
   * Assert that every OpenAPI operation has a handler. Throws listing the
   * missing operationIds sorted alphabetically.
   */
  assertAllRegistered(): void {
    const declared = Array.from(this.operations.keys());
    const missing = declared.filter((id) => !this.routes.has(id));
    if (missing.length > 0) {
      throw new Error(
        `OpenAPI operations not registered (${missing.length} of ${declared.length} missing): ${missing
          .sort()
          .join(', ')}`,
      );
    }
  }

  /**
   * Mount every registered route onto `app`. Each handler runs inside a
   * RouteContext; ApiError is translated to the error envelope, anything else
   * becomes a 500 INTERNAL_ERROR, and successful returns are wrapped into
   * `{ data, meta: { request_id } }`.
   */
  async applyTo(
    app: FastifyInstance,
    db: AppDb,
    deps: RouteDeps = {},
  ): Promise<void> {
    for (const route of this.routes.values()) {
      const { spec, handler, opts } = route;
      const url = toRoutePath(spec.path);
      const method = spec.method.toUpperCase();
      app.route({
        method,
        url,
        handler: async (req: FastifyRequest, reply: FastifyReply) => {
          const requestId = req.requestId ?? generateRequestId();
          const actor: Actor = deps.resolveActor
            ? await deps.resolveActor(req)
            : { kind: 'unauthenticated' };
          const ctx: RouteContext = {
            app,
            db,
            operationId: route.operationId,
            params: { ...(req.params as Record<string, string> | undefined) },
            query: { ...(req.query as Record<string, any> | undefined) },
            body: req.body,
            headers: req.headers as Record<string, string>,
            cookies: { ...((req as any).cookies ?? {}) },
            actor,
            requestId,
            reply,
          };
          try {
            if (opts.requireActor === 'user' && actor.kind !== 'user') {
              throw ApiError.unauthenticated();
            }
            if (opts.requireAgreement && deps.checkAgreement) {
              await deps.checkAgreement(ctx);
            }
            if (opts.idempotent && deps.enforceIdempotency) {
              const idemResult = await deps.enforceIdempotency(ctx);
              if (idemResult && idemResult.replayed) {
                reply
                  .code(idemResult.replayed.status)
                  .send(idemResult.replayed.body);
                return;
              }
            }
            const result = await handler(ctx);
            const { statusCode, body } = composeSuccess(
              result,
              method,
              requestId,
            );
            if (opts.idempotent && deps.storeIdempotency) {
              await deps.storeIdempotency(ctx, statusCode, body);
            }
            if (statusCode === 204) {
              reply.code(204).send();
            } else {
              reply.code(statusCode).send(body);
            }
          } catch (err) {
            sendError(reply, err, requestId, req);
          }
        },
      });
    }
  }
}

/**
 * Compose the success response body and status code from a handler result.
 *
 * Extracted from the old `sendSuccess` so the idempotency hook can capture the
 * exact `(statusCode, body)` pair that will be sent, without coupling to the
 * Fastify reply object.
 */
function composeSuccess(
  result: unknown,
  method: string,
  requestId: string,
): { statusCode: number; body: unknown } {
  if (result === null || result === undefined) {
    return { statusCode: 204, body: null };
  }
  const defaultCode = method === 'POST' ? 201 : 200;
  // Raw byte streams (e.g. file downloads) bypass the JSON envelope; the
  // handler is responsible for setting Content-Type / Content-Disposition on
  // `ctx.reply` before returning.
  if (Buffer.isBuffer(result)) {
    return { statusCode: defaultCode, body: result };
  }
  if (isEnvelope(result)) {
    const code =
      typeof result.statusCode === 'number' ? result.statusCode : defaultCode;
    return {
      statusCode: code,
      body: {
        data: result.data,
        meta: { ...result.meta, request_id: requestId },
      },
    };
  }
  return {
    statusCode: defaultCode,
    body: { data: result, meta: { request_id: requestId } },
  };
}

function sendError(
  reply: FastifyReply,
  err: unknown,
  requestId: string,
  req: FastifyRequest,
): void {
  if (err instanceof ApiError) {
    const env = err.toResponse();
    env.error.request_id = requestId;
    reply.code(err.statusCode).send(env);
    return;
  }
  req.log.error({ err }, 'Unhandled route error');
  const message = err instanceof Error ? err.message : 'Internal error';
  reply.code(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message,
      retryable: false,
      request_id: requestId,
    },
  });
}
