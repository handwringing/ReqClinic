import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import { generateId } from '../../shared/id';

/**
 * Per-request correlation id.
 *
 * The {@link registerRequestId} onRequest hook assigns a fresh `req_<uuid>`
 * to every incoming request and echoes it back on the `X-Request-Id` response
 * header, so clients can correlate a response with server logs.
 *
 * The `FastifyRequest.requestId` augmentation is optional: the route registry
 * falls back to generating one on the fly if the hook has not run (e.g. when a
 * registry is applied to an app that did not wire this middleware).
 */
declare module 'fastify' {
  interface FastifyRequest {
    requestId?: string;
  }
}

/** Generate a fresh request id in the `req_<uuid>` format. */
export function generateRequestId(): string {
  return generateId('req');
}

/**
 * Register the request-id hook on `app`.
 *
 * Call before `app.ready()` so the hook is in place for every route. The hook
 * runs `onRequest`, before any handler, so `req.requestId` is always populated
 * downstream.
 */
export function registerRequestId(app: FastifyInstance): void {
  app.addHook(
    'onRequest',
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const id = generateRequestId();
      req.requestId = id;
      reply.header('X-Request-Id', id);
    },
  );
}
