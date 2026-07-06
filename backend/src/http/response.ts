import { generateId } from '../shared/id';

/**
 * Success response envelope helpers.
 *
 * Both helpers always emit a `meta.request_id`. When a caller does not supply
 * one, a fresh `req_<uuid>` is generated so the helpers are usable standalone
 * (e.g. in tests). In live requests the route registry overrides `request_id`
 * with the actual per-request id before the response is sent, guaranteeing the
 * envelope, the `X-Request-Id` header and server logs all share the same id.
 */

export interface SuccessEnvelope {
  data: unknown;
  meta: Record<string, unknown>;
}

export interface PaginatedEnvelope {
  data: unknown[];
  meta: Record<string, unknown>;
}

/** Build `{ data, meta: { request_id, ...meta } }`. */
export function successResponse(
  data: unknown,
  meta: Record<string, unknown> = {},
): SuccessEnvelope {
  return {
    data,
    meta: {
      request_id: generateId('req'),
      ...meta,
    },
  };
}

/**
 * Build a paginated list envelope. `next_cursor` is omitted entirely when
 * `nextCursor` is null/undefined (no next page). An explicit `nextCursor`
 * argument takes precedence over any `meta.next_cursor`.
 */
export function paginatedResponse(
  items: unknown[],
  nextCursor?: string,
  meta: Record<string, unknown> = {},
): PaginatedEnvelope {
  return {
    data: items,
    meta: {
      request_id: generateId('req'),
      ...meta,
      ...(nextCursor !== undefined && nextCursor !== null
        ? { next_cursor: nextCursor }
        : {}),
    },
  };
}
