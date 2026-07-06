import { z } from 'zod';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/**
 * Pagination query schema.
 *
 * `limit` is clamped to (0, MAX_LIMIT] with a sane default; `cursor` is an
 * opaque base64url string produced by {@link encodeCursor}.
 */
export const paginationSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

export interface Pagination {
  limit: number;
  cursor?: string;
}

/** Parse and validate a raw query object into a {@link Pagination}. */
export function parsePagination(query: Record<string, unknown>): Pagination {
  return paginationSchema.parse(query);
}

/** Encode an arbitrary cursor payload as an opaque base64url string. */
export function encodeCursor(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

/** Decode an opaque cursor string back into its payload. */
export function decodeCursor<T = unknown>(str: string): T {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf8')) as T;
}
