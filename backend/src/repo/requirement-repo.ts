import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { requirements, type Requirement } from '../db/schema/core';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface ListRequirementOptions {
  limit?: number;
  cursor?: string;
  lifecycleStatus?: string;
  provenance?: string;
}

export interface UpdateRequirementInput {
  title?: string;
  statement?: string;
  requirementType?: string;
  provenance?: string;
  horizon?: string;
  scopeDisposition?: string;
  commitment?: string;
  stability?: string;
  priority?: string;
  ownerId?: string;
  rationale?: string;
  expectedVersion?: number;
}

interface RequirementCursor {
  createdAt: string;
  id: string;
}

/**
 * Repository for §6.2 requirements.
 *
 * Requirements carry a `provenance` field (explicitly_stated / derived /
 * assumed / proposed) that records how the requirement came to be; updates are
 * guarded by optimistic concurrency on `version`.
 */
export class RequirementRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of requirements for a project, newest-first. */
  listByProject(projectId: string, opts: ListRequirementOptions = {}): {
    items: Requirement[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(requirements.projectId, projectId)];
    if (opts.lifecycleStatus) conditions.push(eq(requirements.lifecycleStatus, opts.lifecycleStatus));
    if (opts.provenance) conditions.push(eq(requirements.provenance, opts.provenance));

    if (cursor) {
      const c = decodeCursor<RequirementCursor>(cursor);
      conditions.push(
        or(
          lt(requirements.createdAt, c.createdAt),
          and(eq(requirements.createdAt, c.createdAt), lt(requirements.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(requirements)
      .where(and(...conditions))
      .orderBy(desc(requirements.createdAt), desc(requirements.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
    }
    return { items, nextCursor };
  }

  /** Find a requirement by id, or null. */
  findById(id: string): Requirement | null {
    const row = this.db.select().from(requirements).where(eq(requirements.id, id)).get();
    return row ?? null;
  }

  /** Update a requirement with optimistic-concurrency check (incl. provenance). */
  update(id: string, input: UpdateRequirementInput): Requirement {
    const current = this.findById(id);
    if (!current) throw ApiError.notFound('Requirement not found', 'requirement');
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw ApiError.versionConflict();
    }

    const patch: Partial<typeof requirements.$inferInsert> = {
      version: current.version + 1,
      updatedAt: now(),
    };
    if (input.title !== undefined) patch.title = input.title;
    if (input.statement !== undefined) patch.statement = input.statement;
    if (input.requirementType !== undefined) patch.requirementType = input.requirementType;
    if (input.provenance !== undefined) patch.provenance = input.provenance;
    if (input.horizon !== undefined) patch.horizon = input.horizon;
    if (input.scopeDisposition !== undefined) patch.scopeDisposition = input.scopeDisposition;
    if (input.commitment !== undefined) patch.commitment = input.commitment;
    if (input.stability !== undefined) patch.stability = input.stability;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.rationale !== undefined) patch.rationale = input.rationale;

    return this.db
      .update(requirements)
      .set(patch)
      .where(eq(requirements.id, id))
      .returning()
      .get();
  }
}

/**
 * Derive the next monotonically-numbered requirement key for a project, e.g.
 * `REQ-001`, `REQ-002`. Counted across all requirements in the project.
 */
export function nextRequirementKey(existing: Requirement[], prefix = 'REQ'): string {
  const n = existing.length + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/** Build a requirement row for direct insertion (used by seed/analysis paths). */
export function buildRequirementRow(input: {
  projectId: string;
  requirementKey: string;
  statement: string;
  requirementType: string;
  provenance: string;
  commitment: string;
  stability: string;
  title?: string;
  horizon?: string;
  ownerId?: string;
  lifecycleStatus?: string;
}): typeof requirements.$inferInsert {
  const ts = now();
  return {
    id: generateId('req'),
    projectId: input.projectId,
    requirementKey: input.requirementKey,
    title: input.title ?? null,
    statement: input.statement,
    requirementType: input.requirementType,
    provenance: input.provenance,
    horizon: input.horizon ?? null,
    scopeDisposition: 'included',
    commitment: input.commitment,
    stability: input.stability,
    priority: null,
    ownerId: input.ownerId ?? null,
    lifecycleStatus: input.lifecycleStatus ?? 'candidate',
    rationale: null,
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };
}
