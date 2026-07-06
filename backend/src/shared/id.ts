import { randomUUID } from 'node:crypto';

/**
 * Generates a type-prefixed identifier, e.g. `usr_<uuid>`.
 *
 * The prefix carries the entity kind so IDs are self-describing in logs and
 * foreign-key columns without needing extra joins.
 */
export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
