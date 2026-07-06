import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { futureScenarios, type FutureScenario } from '../db/schema/core';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface ListScenarioOptions {
  limit?: number;
  cursor?: string;
}

export interface CreateScenarioInput {
  projectId: string;
  name: string;
  description: string;
  probabilityClass?: string;
  activationTrigger: string;
  leadingIndicators?: unknown[];
  horizon: string;
  architectureResponse?: string;
  status?: string;
}

interface ScenarioCursor {
  createdAt: string;
  id: string;
}

/**
 * Repository for §6.3 future_scenarios — Next/Later/Watch scenarios with
 * activation triggers and leading indicators.
 */
export class ScenarioRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of future scenarios for a project, newest-first. */
  listByProject(projectId: string, opts: ListScenarioOptions = {}): {
    items: FutureScenario[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(futureScenarios.projectId, projectId)];

    if (cursor) {
      const c = decodeCursor<ScenarioCursor>(cursor);
      conditions.push(
        or(
          lt(futureScenarios.createdAt, c.createdAt),
          and(eq(futureScenarios.createdAt, c.createdAt), lt(futureScenarios.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(futureScenarios)
      .where(and(...conditions))
      .orderBy(desc(futureScenarios.createdAt), desc(futureScenarios.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
    }
    return { items, nextCursor };
  }

  /** Create a new future scenario in `draft` status. */
  create(input: CreateScenarioInput): FutureScenario {
    const ts = now();
    return this.db
      .insert(futureScenarios)
      .values({
        id: generateId('fsc'),
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        probabilityClass: input.probabilityClass ?? null,
        activationTrigger: input.activationTrigger,
        leadingIndicatorsJson: JSON.stringify(input.leadingIndicators ?? []),
        horizon: input.horizon,
        architectureResponse: input.architectureResponse ?? null,
        status: input.status ?? 'draft',
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .get();
  }
}
