import { eq, and } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { idempotencyRecords, type IdempotencyRecord } from '../db/schema/job';
import { generateId } from '../shared/id';
import { now, addDays } from '../shared/time';

export interface CreateIdempotencyInput {
  key: string;
  requestHash: string;
  actorKind: 'user' | 'guest';
  actorId: string;
  endpoint: string;
  responseStatus?: number | null;
  responseBody?: unknown;
}

/** Retention window for idempotency records (§11). */
const IDEMPOTENCY_TTL_DAYS = 1;

/**
 * Repository for `idempotency_records` (§11).
 *
 * Records are keyed by `(actor_kind, actor_id, endpoint, idempotency_key)` per
 * the partial unique index. A record is created with null response fields
 * before the handler runs (to reserve the key), then updated with the final
 * response after the handler succeeds.
 */
export class IdempotencyRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Find an existing record by key + actor + endpoint.
   *
   * `endpoint` is optional for API flexibility, but should be provided in
   * practice to match the unique index `(actor_kind, actor_id, endpoint,
   * idempotency_key)`.
   */
  async find(
    key: string,
    actorKind: string,
    actorId: string,
    endpoint?: string,
  ): Promise<IdempotencyRecord | null> {
    const conditions = [
      eq(idempotencyRecords.idempotencyKey, key),
      eq(idempotencyRecords.actorKind, actorKind),
      eq(idempotencyRecords.actorId, actorId),
    ];
    if (endpoint) {
      conditions.push(eq(idempotencyRecords.endpoint, endpoint));
    }
    const rows = await this.db
      .select()
      .from(idempotencyRecords)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Insert a new idempotency record.
   *
   * `responseStatus` and `responseBody` may be null when reserving a key
   * before the handler runs; call {@link updateResponse} afterwards.
   */
  async create(input: CreateIdempotencyInput): Promise<IdempotencyRecord> {
    const ts = now();
    const id = generateId('idm');
    const expiresAt = addDays(ts, IDEMPOTENCY_TTL_DAYS);
    await this.db.insert(idempotencyRecords).values({
      id,
      actorKind: input.actorKind,
      actorId: input.actorId,
      endpoint: input.endpoint,
      idempotencyKey: input.key,
      requestHash: input.requestHash,
      responseStatus: input.responseStatus ?? null,
      responseJson:
        input.responseBody != null ? JSON.stringify(input.responseBody) : null,
      createdAt: ts,
      expiresAt,
    });
    const row = await this.findById(id);
    return row!;
  }

  /** Store the handler's final response on a previously-created record. */
  async updateResponse(
    id: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.db
      .update(idempotencyRecords)
      .set({
        responseStatus,
        responseJson:
          responseBody != null ? JSON.stringify(responseBody) : null,
      })
      .where(eq(idempotencyRecords.id, id));
  }

  /** True when the stored request hash matches the incoming hash. */
  matchesHash(record: IdempotencyRecord, requestHash: string): boolean {
    return record.requestHash === requestHash;
  }

  async findById(id: string): Promise<IdempotencyRecord | null> {
    const rows = await this.db
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}
