import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  conflicts,
  conflictSides,
  conflictOptions,
  decisions,
  type Conflict,
  type ConflictSide,
  type ConflictOption,
  type Decision,
} from '../db/schema/core';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface ListConflictOptions {
  limit?: number;
  cursor?: string;
  status?: string;
}

export interface ResolveConflictInput {
  resolution: {
    decision: {
      question: string;
      selectedOptionId: string;
      rationale: string;
      reviewTrigger?: string;
    };
    ownerId: string;
    applicableScope?: string;
    expiryCondition?: string;
  };
  resolverId: string;
  expectedVersion: number;
}

export interface ConflictDetail {
  conflict: Conflict;
  sides: ConflictSide[];
  options: ConflictOption[];
  currentDecision: Decision | null;
}

interface ConflictCursor {
  createdAt: string;
  id: string;
}

/**
 * Repository for §6.3 conflicts.
 *
 * A conflict aggregates sides (positions) and options (candidate resolutions).
 * `resolve` records a decision referencing the selected option and flips the
 * conflict to `resolved` status, guarded by optimistic concurrency.
 */
export class ConflictRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of conflicts for a project, newest-first. */
  listByProject(projectId: string, opts: ListConflictOptions = {}): {
    items: Conflict[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(conflicts.projectId, projectId)];
    if (opts.status) conditions.push(eq(conflicts.status, opts.status));

    if (cursor) {
      const c = decodeCursor<ConflictCursor>(cursor);
      conditions.push(
        or(
          lt(conflicts.createdAt, c.createdAt),
          and(eq(conflicts.createdAt, c.createdAt), lt(conflicts.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(conflicts)
      .where(and(...conditions))
      .orderBy(desc(conflicts.createdAt), desc(conflicts.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
    }
    return { items, nextCursor };
  }

  /** Find a conflict by id, or null. */
  findById(id: string): Conflict | null {
    const row = this.db.select().from(conflicts).where(eq(conflicts.id, id)).get();
    return row ?? null;
  }

  /** Resolve a conflict: create a decision and flip status to `resolved`. */
  resolve(id: string, input: ResolveConflictInput): { conflict: Conflict; decision: Decision } {
    const current = this.findById(id);
    if (!current) throw ApiError.notFound('Conflict not found', 'conflict');
    if (current.version !== input.expectedVersion) {
      throw ApiError.versionConflict();
    }
    if (current.status === 'resolved' || current.status === 'accepted_risk') {
      throw ApiError.conflict(
        'CONFLICT_ALREADY_RESOLVED',
        'Conflict is already resolved',
      );
    }

    const ts = now();
    return this.db.transaction((tx) => {
      const decision = tx
        .insert(decisions)
        .values({
          id: generateId('dec'),
          projectId: current.projectId,
          conflictId: current.id,
          question: input.resolution.decision.question,
          selectedOptionId: input.resolution.decision.selectedOptionId,
          rationale: input.resolution.decision.rationale,
          decidedBy: input.resolverId,
          decidedAt: ts,
          reviewTrigger: input.resolution.decision.reviewTrigger ?? null,
          status: 'decided',
          version: 1,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning()
        .get();

      const updated = tx
        .update(conflicts)
        .set({
          status: 'resolved',
          ownerId: input.resolution.ownerId,
          version: current.version + 1,
          updatedAt: ts,
        })
        .where(eq(conflicts.id, id))
        .returning()
        .get();

      return { conflict: updated, decision };
    });
  }
}

/**
 * Assemble a full conflict detail (sides + options + current decision) for the
 * `getConflictDetail` route. Kept as a standalone helper so the repo stays
 * focused on conflict-row mutations.
 */
export function loadConflictDetail(
  db: DrizzleDB,
  conflict: Conflict,
): ConflictDetail {
  const sides = db
    .select()
    .from(conflictSides)
    .where(eq(conflictSides.conflictId, conflict.id))
    .all();
  const options = db
    .select()
    .from(conflictOptions)
    .where(eq(conflictOptions.conflictId, conflict.id))
    .all();
  const currentDecision = db
    .select()
    .from(decisions)
    .where(eq(decisions.conflictId, conflict.id))
    .orderBy(desc(decisions.decidedAt))
    .limit(1)
    .get();
  return {
    conflict,
    sides,
    options,
    currentDecision: currentDecision ?? null,
  };
}
