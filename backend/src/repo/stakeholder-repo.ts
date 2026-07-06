import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { stakeholders, interviewTurns, type Stakeholder, type InterviewTurn } from '../db/schema/core';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface ListStakeholderOptions {
  limit?: number;
  cursor?: string;
}

export interface ListInterviewTurnOptions {
  limit?: number;
  cursor?: string;
  role?: string;
}

interface StakeholderCursor {
  createdAt: string;
  id: string;
}

interface InterviewTurnCursor {
  turnIndex: number;
  id: string;
}

/**
 * Repository for §6.1 stakeholders and interview_turns.
 *
 * Both are read-only here — stakeholders are produced by the analysis pipeline,
 * and interview turns are captured during elicitation. This repo exposes only
 * the list queries the formal-analysis UI needs.
 */
export class StakeholderRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of stakeholders for a project, newest-first. */
  listByProject(projectId: string, opts: ListStakeholderOptions = {}): {
    items: Stakeholder[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(stakeholders.projectId, projectId)];

    if (cursor) {
      const c = decodeCursor<StakeholderCursor>(cursor);
      conditions.push(
        or(
          lt(stakeholders.createdAt, c.createdAt),
          and(eq(stakeholders.createdAt, c.createdAt), lt(stakeholders.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(stakeholders)
      .where(and(...conditions))
      .orderBy(desc(stakeholders.createdAt), desc(stakeholders.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
    }
    return { items, nextCursor };
  }

  /** Paginated list of interview turns for a project, ordered by turn index. */
  listInterviewTurns(projectId: string, opts: ListInterviewTurnOptions = {}): {
    items: InterviewTurn[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(interviewTurns.projectId, projectId)];
    if (opts.role) conditions.push(eq(interviewTurns.role, opts.role));

    if (cursor) {
      const c = decodeCursor<InterviewTurnCursor>(cursor);
      conditions.push(
        or(
          lt(interviewTurns.turnIndex, c.turnIndex),
          and(eq(interviewTurns.turnIndex, c.turnIndex), lt(interviewTurns.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(interviewTurns)
      .where(and(...conditions))
      .orderBy(desc(interviewTurns.turnIndex), desc(interviewTurns.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ turnIndex: last.turnIndex, id: last.id });
    }
    return { items, nextCursor };
  }
}
