import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { acceptanceCriteria, requirements, type AcceptanceCriterion } from '../db/schema/core';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface ListAcceptanceOptions {
  limit?: number;
  cursor?: string;
}

export interface CreateAcceptanceInput {
  requirementId: string;
  context?: string;
  actionOrCondition: string;
  expectedResult: string;
  measurementMethod?: string;
  evidenceType?: string;
  thresholdValue?: string;
  unit?: string;
  status?: string;
}

interface AcceptanceCursor {
  createdAt: string;
  id: string;
}

/**
 * Repository for §6.2 acceptance_criteria.
 *
 * Each criterion belongs to a requirement; `project_id` is derived from the
 * requirement at create time so the polymorphic FK invariant stays consistent.
 */
export class AcceptanceRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of acceptance criteria for a requirement, newest-first. */
  listByRequirement(requirementId: string, opts: ListAcceptanceOptions = {}): {
    items: AcceptanceCriterion[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(acceptanceCriteria.requirementId, requirementId)];

    if (cursor) {
      const c = decodeCursor<AcceptanceCursor>(cursor);
      conditions.push(
        or(
          lt(acceptanceCriteria.createdAt, c.createdAt),
          and(eq(acceptanceCriteria.createdAt, c.createdAt), lt(acceptanceCriteria.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(acceptanceCriteria)
      .where(and(...conditions))
      .orderBy(desc(acceptanceCriteria.createdAt), desc(acceptanceCriteria.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
    }
    return { items, nextCursor };
  }

  /** Create a new acceptance criterion for a requirement. */
  create(input: CreateAcceptanceInput): AcceptanceCriterion {
    const req = this.db
      .select({ id: requirements.id, projectId: requirements.projectId })
      .from(requirements)
      .where(eq(requirements.id, input.requirementId))
      .get();
    if (!req) throw ApiError.notFound('Requirement not found', 'requirement');

    const ts = now();
    return this.db
      .insert(acceptanceCriteria)
      .values({
        id: generateId('ac'),
        projectId: req.projectId,
        requirementId: input.requirementId,
        context: input.context ?? null,
        actionOrCondition: input.actionOrCondition,
        expectedResult: input.expectedResult,
        measurementMethod: input.measurementMethod ?? null,
        evidenceType: input.evidenceType ?? null,
        thresholdValue: input.thresholdValue ?? null,
        unit: input.unit ?? null,
        status: input.status ?? 'draft',
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .get();
  }
}
