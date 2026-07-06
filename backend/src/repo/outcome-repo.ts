import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { outcomes, type Outcome } from '../db/schema/core';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface ListOutcomeOptions {
  limit?: number;
  cursor?: string;
  status?: string;
  epistemicType?: string;
}

export interface UpdateOutcomeInput {
  description?: string;
  successMetric?: string;
  baselineValue?: string;
  targetValue?: string;
  unit?: string;
  failureCondition?: string;
  horizon?: string;
  ownerId?: string;
  expectedVersion?: number;
}

interface OutcomeCursor {
  createdAt: string;
  id: string;
}

/**
 * Repository for §6.1 outcomes (extends drivers where driver_type='outcome').
 *
 * Outcomes carry success metrics, baseline/target values and a failure
 * condition; updates are guarded by optimistic concurrency on `version`.
 */
export class OutcomeRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of outcomes for a project, newest-first. */
  listByProject(projectId: string, opts: ListOutcomeOptions = {}): {
    items: Outcome[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(outcomes.projectId, projectId)];
    if (opts.status) conditions.push(eq(outcomes.status, opts.status));
    if (opts.epistemicType) conditions.push(eq(outcomes.epistemicType, opts.epistemicType));

    if (cursor) {
      const c = decodeCursor<OutcomeCursor>(cursor);
      conditions.push(
        or(
          lt(outcomes.createdAt, c.createdAt),
          and(eq(outcomes.createdAt, c.createdAt), lt(outcomes.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(outcomes)
      .where(and(...conditions))
      .orderBy(desc(outcomes.createdAt), desc(outcomes.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
    }
    return { items, nextCursor };
  }

  /** Find an outcome by id, or null. */
  findById(id: string): Outcome | null {
    const row = this.db.select().from(outcomes).where(eq(outcomes.id, id)).get();
    return row ?? null;
  }

  /** Update an outcome with optimistic-concurrency check. */
  update(id: string, input: UpdateOutcomeInput): Outcome {
    const current = this.findById(id);
    if (!current) throw ApiError.notFound('Outcome not found', 'outcome');
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw ApiError.versionConflict();
    }

    const patch: Partial<typeof outcomes.$inferInsert> = {
      version: current.version + 1,
      updatedAt: now(),
    };
    if (input.description !== undefined) patch.description = input.description;
    if (input.successMetric !== undefined) patch.successMetric = input.successMetric;
    if (input.baselineValue !== undefined) patch.baselineValue = input.baselineValue;
    if (input.targetValue !== undefined) patch.targetValue = input.targetValue;
    if (input.unit !== undefined) patch.unit = input.unit;
    if (input.failureCondition !== undefined) patch.failureCondition = input.failureCondition;
    if (input.horizon !== undefined) patch.horizon = input.horizon;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;

    return this.db
      .update(outcomes)
      .set(patch)
      .where(eq(outcomes.id, id))
      .returning()
      .get();
  }
}

/** Build an outcome row for direct insertion (used by seed/analysis paths). */
export function buildOutcomeRow(input: {
  projectId: string;
  driverId: string;
  description: string;
  epistemicType: string;
  jobId?: string;
  successMetric?: string;
  baselineValue?: string;
  targetValue?: string;
  unit?: string;
  failureCondition?: string;
  horizon?: string;
  ownerId?: string;
  status?: string;
}): typeof outcomes.$inferInsert {
  const ts = now();
  return {
    id: generateId('out'),
    projectId: input.projectId,
    driverId: input.driverId,
    jobId: input.jobId ?? null,
    description: input.description,
    successMetric: input.successMetric ?? null,
    baselineValue: input.baselineValue ?? null,
    targetValue: input.targetValue ?? null,
    unit: input.unit ?? null,
    failureCondition: input.failureCondition ?? null,
    horizon: input.horizon ?? null,
    ownerId: input.ownerId ?? null,
    epistemicType: input.epistemicType,
    status: input.status ?? 'candidate',
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };
}
