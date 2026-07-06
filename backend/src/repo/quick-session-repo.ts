import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { quickSessions, type QuickSession } from '../db/schema/quick';
import { deleteTasks } from '../db/schema/lifecycle';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now, addDays } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

/**
 * Actor performing an action on a quick session.
 *
 * `kind` determines which ownership column (`user_id` / `guest_session_id`)
 * is consulted; `id` is the corresponding row id.
 */
export interface Actor {
  kind: 'user' | 'guest';
  id: string;
}

/**
 * Valid status values for a quick session (per schema CHECK constraint).
 *
 * The doc task spec uses conceptual labels (`collecting`, `brief_generating`,
 * `completed`, `abandon`) which map to schema-valid values as follows:
 *   collecting      → draft
 *   understanding_review → understanding_review
 *   brief_generating → option_review
 *   completed       → brief_ready
 *   abandon/archive → archived
 *   upgraded        → upgraded
 */
export const QUICK_SESSION_STATUS = {
  DRAFT: 'draft',
  CLARIFYING: 'clarifying',
  UNDERSTANDING_REVIEW: 'understanding_review',
  OPTION_REVIEW: 'option_review',
  BRIEF_READY: 'brief_ready',
  UPGRADED: 'upgraded',
  ARCHIVED: 'archived',
} as const;

export type QuickSessionStatus = (typeof QUICK_SESSION_STATUS)[keyof typeof QUICK_SESSION_STATUS];

/** Allowed forward transitions in the quick-session state machine. */
const TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['clarifying', 'understanding_review', 'archived']),
  clarifying: new Set(['clarifying', 'understanding_review', 'archived']),
  understanding_review: new Set(['clarifying', 'option_review', 'archived']),
  option_review: new Set(['brief_ready', 'archived']),
  brief_ready: new Set(['brief_ready', 'upgraded', 'archived']),
  upgraded: new Set(['archived']),
  archived: new Set(),
};

export interface CreateQuickSessionInput {
  actorKind: 'user' | 'guest';
  userId?: string;
  guestSessionId?: string;
  sourceKind: string;
  sourceCaseId?: string | null;
  originalIdea: string;
  targetUseCase?: string;
  candidateTitles?: string[];
}

export interface ListQuickSessionOptions {
  limit?: number;
  cursor?: string;
}

interface QuickSessionCursor {
  createdAt: string;
  id: string;
}

export class QuickSessionRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Create a new quick session in `draft` status (schema-valid equivalent of
   * the spec's `collecting`).
   */
  create(input: CreateQuickSessionInput): QuickSession {
    if (input.actorKind === 'user' && !input.userId) {
      throw ApiError.validationError({ userId: 'required for actorKind=user' });
    }
    if (input.actorKind === 'guest' && !input.guestSessionId) {
      throw ApiError.validationError({ guestSessionId: 'required for actorKind=guest' });
    }

    const ts = now();
    const coverageSlots = input.candidateTitles?.length
      ? JSON.stringify({ candidateTitles: input.candidateTitles })
      : '{}';

    const row = this.db
      .insert(quickSessions)
      .values({
        id: generateId('qs'),
        guestSessionId: input.guestSessionId ?? null,
        userId: input.userId ?? null,
        status: QUICK_SESSION_STATUS.DRAFT,
        sourceKind: input.sourceKind,
        sourceCaseId: input.sourceCaseId ?? null,
        originalInput: input.originalIdea,
        decisionIntent: input.targetUseCase ?? null,
        coverageSlotsJson: coverageSlots,
        lastActiveAt: ts,
        createdAt: ts,
        version: 1,
      })
      .returning()
      .get();

    return row;
  }

  /** Find a session by id, or null. */
  findById(id: string): QuickSession | null {
    const row = this.db
      .select()
      .from(quickSessions)
      .where(eq(quickSessions.id, id))
      .get();
    return row ?? null;
  }

  /**
   * Find a session by id and verify the actor owns it.
   *
   * Throws `NOT_FOUND` when the session does not exist or the actor does not
   * own it (to avoid leaking existence to non-owners).
   */
  findByIdForActor(id: string, actor: Actor): QuickSession {
    const session = this.findById(id);
    if (!session) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    const ownerId =
      actor.kind === 'user' ? session.userId : session.guestSessionId;
    if (ownerId !== actor.id) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    return session;
  }

  /**
   * Transition the session status with optional optimistic-concurrency check.
   *
   * On success, `version` is incremented and `last_active_at` is touched.
   */
  updateStatus(id: string, status: string, expectedVersion?: number): QuickSession {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw ApiError.versionConflict();
    }
    const allowed = TRANSITIONS[current.status];
    if (!allowed || !allowed.has(status)) {
      throw ApiError.conflict(
        'INVALID_TRANSITION',
        `Cannot transition from '${current.status}' to '${status}'`,
      );
    }

    const updated = this.db
      .update(quickSessions)
      .set({
        status,
        version: current.version + 1,
        lastActiveAt: now(),
      })
      .where(eq(quickSessions.id, id))
      .returning()
      .get();

    return updated;
  }

  updateRuntimeSnapshot(input: {
    id: string;
    coverageSlotsJson: string;
    status?: string;
    understandingVersion?: number;
  }): QuickSession {
    const current = this.findById(input.id);
    if (!current) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    const nextStatus = input.status ?? current.status;
    if (nextStatus !== current.status) {
      const allowed = TRANSITIONS[current.status];
      if (!allowed || !allowed.has(nextStatus)) {
        throw ApiError.conflict(
          'INVALID_TRANSITION',
          `Cannot transition from '${current.status}' to '${nextStatus}'`,
        );
      }
    }

    return this.db
      .update(quickSessions)
      .set({
        status: nextStatus,
        coverageSlotsJson: input.coverageSlotsJson,
        currentUnderstandingVersion:
          input.understandingVersion ?? current.currentUnderstandingVersion,
        version: current.version + 1,
        lastActiveAt: now(),
      })
      .where(eq(quickSessions.id, input.id))
      .returning()
      .get();
  }

  setCurrentBriefVersion(input: {
    id: string;
    briefVersionId: string;
    status?: string;
  }): QuickSession {
    const current = this.findById(input.id);
    if (!current) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    const nextStatus = input.status ?? current.status;
    if (nextStatus !== current.status) {
      const allowed = TRANSITIONS[current.status];
      if (!allowed || !allowed.has(nextStatus)) {
        throw ApiError.conflict(
          'INVALID_TRANSITION',
          `Cannot transition from '${current.status}' to '${nextStatus}'`,
        );
      }
    }
    return this.db
      .update(quickSessions)
      .set({
        status: nextStatus,
        currentBriefVersionId: input.briefVersionId,
        version: current.version + 1,
        lastActiveAt: now(),
      })
      .where(eq(quickSessions.id, input.id))
      .returning()
      .get();
  }

  /** Soft-delete by recording a `delete_task` (no `deleted_at` column exists). */
  softDelete(id: string, actor: Actor): void {
    const session = this.findById(id);
    if (!session) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    const ts = now();
    this.db.insert(deleteTasks).values({
      id: generateId('dt'),
      scope: 'quick_session',
      targetId: id,
      requesterType: actor.kind,
      requesterId: actor.id,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
    }).run();
  }

  /** Abandon a session — semantically equivalent to archiving. */
  abandon(id: string): QuickSession {
    return this.updateStatus(id, QUICK_SESSION_STATUS.ARCHIVED);
  }

  /** Archive a session. */
  archive(id: string): QuickSession {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    const ts = now();
    const updated = this.db
      .update(quickSessions)
      .set({
        status: QUICK_SESSION_STATUS.ARCHIVED,
        archivedAt: ts,
        version: current.version + 1,
        lastActiveAt: ts,
      })
      .where(eq(quickSessions.id, id))
      .returning()
      .get();
    return updated;
  }

  /** Mark a session as upgraded to a formal project. */
  markUpgraded(id: string, _projectId: string): QuickSession {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    const ts = now();
    const updated = this.db
      .update(quickSessions)
      .set({
        status: QUICK_SESSION_STATUS.UPGRADED,
        upgradedAt: ts,
        version: current.version + 1,
        lastActiveAt: ts,
      })
      .where(eq(quickSessions.id, id))
      .returning()
      .get();

    return updated;
  }

  /**
   * Atomically claim a guest-owned quick session for a logged-in user (§3A.3).
   *
   * Switches ownership from `guest_session_id` to `user_id` in a single
   * update — the schema's `owner_xor` CHECK constraint requires both columns
   * to flip together, so this must be one statement. `origin_guest_session_id`
   * preserves the original guest owner for audit; `claimed_at` and a 180-day
   * `expires_at` are stamped. The caller is responsible for verifying the
   * guest credential matches the session's current owner before invoking this.
   */
  claim(id: string, userId: string, originGuestSessionId: string): QuickSession {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Quick session not found', 'quick_session');
    }
    const ts = now();
    const updated = this.db
      .update(quickSessions)
      .set({
        userId,
        guestSessionId: null,
        originGuestSessionId,
        claimedAt: ts,
        expiresAt: addDays(ts, 180),
        version: current.version + 1,
        lastActiveAt: ts,
      })
      .where(eq(quickSessions.id, id))
      .returning()
      .get();

    return updated;
  }

  /** Paginated list of sessions owned by an actor, newest first. */
  listByActor(actor: Actor, opts: ListQuickSessionOptions = {}): {
    items: QuickSession[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const ownerCol =
      actor.kind === 'user' ? quickSessions.userId : quickSessions.guestSessionId;

    const conditions = [eq(ownerCol, actor.id)];

    if (cursor) {
      const c = decodeCursor<QuickSessionCursor>(cursor);
      conditions.push(
        or(
          lt(quickSessions.createdAt, c.createdAt),
          and(
            eq(quickSessions.createdAt, c.createdAt),
            lt(quickSessions.id, c.id),
          ),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(quickSessions)
      .where(and(...conditions))
      .orderBy(desc(quickSessions.createdAt), desc(quickSessions.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        createdAt: last.createdAt,
        id: last.id,
      });
    }

    return { items, nextCursor };
  }
}
