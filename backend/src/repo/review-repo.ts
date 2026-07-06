import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { reviewActions, type ReviewAction } from '../db/schema/review';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

export type ReviewEntityType =
  | 'outcome'
  | 'driver'
  | 'requirement'
  | 'conflict';

export type ReviewGateType = 'scope' | 'outcome' | 'evidence_conflict';

export interface CreateReviewInput {
  projectId: string;
  entityType: ReviewEntityType;
  entityId: string;
  entityVersion: number;
  action: string;
  reviewerId: string;
  /** Reviewer's reason; required by the `review_actions.reason` NOT NULL column. */
  reason: string;
  comment?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  followUp?: unknown;
}

export interface ReviewGateInput {
  projectId: string;
  gateType: ReviewGateType;
  action: string;
  reviewerId: string;
  entityVersion: number;
  reason: string;
  afterValue?: unknown;
  followUp?: unknown;
}

/**
 * Repository for §7.1 review_actions.
 *
 * `review_actions` is append-only. Typed reviews (`create`) target a single
 * descriptive entity (outcome/driver/requirement/conflict); gate reviews
 * (`reviewGate`) target the project as a whole and set the `gate` column to one
 * of the three human gates: scope / outcome / evidence_conflict.
 *
 * AI actors may never approve a gate — that invariant is enforced upstream by
 * `requireUser` (only `actor.kind === 'user'` reaches these methods).
 */
export class ReviewRepo {
  constructor(private db: DrizzleDB) {}

  /** Record a typed review action against a single entity. */
  create(input: CreateReviewInput): ReviewAction {
    return this.db
      .insert(reviewActions)
      .values({
        id: generateId('rv'),
        projectId: input.projectId,
        gate: null,
        entityType: input.entityType,
        entityId: input.entityId,
        entityVersion: input.entityVersion,
        action: input.action,
        beforeValue: input.beforeValue !== undefined ? JSON.stringify(input.beforeValue) : null,
        afterValue: input.afterValue !== undefined ? JSON.stringify(input.afterValue) : null,
        reviewerId: input.reviewerId,
        reason: input.reason || input.comment || '',
        followUpJson: input.followUp !== undefined ? JSON.stringify(input.followUp) : null,
        createdAt: now(),
      })
      .returning()
      .get();
  }

  /** Record a project-level gate review (scope / outcome / evidence_conflict). */
  reviewGate(input: ReviewGateInput): ReviewAction {
    return this.db
      .insert(reviewActions)
      .values({
        id: generateId('rv'),
        projectId: input.projectId,
        gate: input.gateType,
        entityType: 'project',
        entityId: input.projectId,
        entityVersion: input.entityVersion,
        action: input.action,
        beforeValue: null,
        afterValue: input.afterValue !== undefined ? JSON.stringify(input.afterValue) : null,
        reviewerId: input.reviewerId,
        reason: input.reason,
        followUpJson: input.followUp !== undefined ? JSON.stringify(input.followUp) : null,
        createdAt: now(),
      })
      .returning()
      .get();
  }

  /** List all review actions recorded against an entity, newest-first. */
  listByEntity(entityType: string, entityId: string): ReviewAction[] {
    return this.db
      .select()
      .from(reviewActions)
      .where(
        and(
          eq(reviewActions.entityType, entityType),
          eq(reviewActions.entityId, entityId),
        ),
      )
      .orderBy(desc(reviewActions.createdAt))
      .all();
  }

  /** List gate review actions for a project + gate, newest-first. */
  listGateReviews(projectId: string, gateType: ReviewGateType): ReviewAction[] {
    return this.db
      .select()
      .from(reviewActions)
      .where(
        and(
          eq(reviewActions.projectId, projectId),
          eq(reviewActions.gate, gateType),
        ),
      )
      .orderBy(desc(reviewActions.createdAt))
      .all();
  }
}
