import { eq, and, lt, or, desc, max } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { quickTurns, type QuickTurn } from '../db/schema/quick';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface CreateQuickTurnInput {
  quickSessionId: string;
  role: 'ai' | 'user';
  content: string;
  /** Optional message classification; persisted via `question_id` when it is a question. */
  messageType?: string;
}

export interface ListQuickTurnOptions {
  limit?: number;
  cursor?: string;
}

interface QuickTurnCursor {
  turnIndex: number;
  id: string;
}

export class QuickTurnRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Append a message turn to a session.
   *
   * `turnIndex` is auto-assigned as max(existing) + 1 (0 for the first turn).
   */
  create(input: CreateQuickTurnInput): QuickTurn {
    const lastIndex = this.db
      .select({ m: max(quickTurns.turnIndex) })
      .from(quickTurns)
      .where(eq(quickTurns.quickSessionId, input.quickSessionId))
      .get();
    const nextIndex = (lastIndex?.m ?? -1) + 1;

    const row = this.db
      .insert(quickTurns)
      .values({
        id: generateId('qt'),
        quickSessionId: input.quickSessionId,
        turnIndex: nextIndex,
        role: input.role,
        content: input.content,
        questionId: input.messageType === 'question' ? generateId('qst') : null,
        createdAt: now(),
      })
      .returning()
      .get();

    return row;
  }

  /** Paginated list of turns for a session, ordered by turn index ascending. */
  listBySession(quickSessionId: string, opts: ListQuickTurnOptions = {}): {
    items: QuickTurn[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(quickTurns.quickSessionId, quickSessionId)];

    if (cursor) {
      const c = decodeCursor<QuickTurnCursor>(cursor);
      conditions.push(
        or(
          lt(quickTurns.turnIndex, c.turnIndex),
          and(
            eq(quickTurns.turnIndex, c.turnIndex),
            lt(quickTurns.id, c.id),
          ),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(quickTurns)
      .where(and(...conditions))
      .orderBy(desc(quickTurns.turnIndex), desc(quickTurns.id))
      .limit(limit)
      .all()
      .reverse();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        turnIndex: last.turnIndex,
        id: last.id,
      });
    }

    return { items, nextCursor };
  }

  /**
   * Return the most recent AI turns that carry a question marker.
   *
   * Ordered from newest to oldest.
   */
  listLatestQuestions(quickSessionId: string, limit: number): QuickTurn[] {
    return this.db
      .select()
      .from(quickTurns)
      .where(
        and(
          eq(quickTurns.quickSessionId, quickSessionId),
          eq(quickTurns.role, 'ai'),
        ),
      )
      .orderBy(desc(quickTurns.turnIndex))
      .limit(limit)
      .all();
  }
}
