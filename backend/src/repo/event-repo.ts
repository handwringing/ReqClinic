import { createHash } from 'node:crypto';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { productEvents, type ProductEvent } from '../db/schema/event';
import { generateId } from '../shared/id';
import { now, addDays } from '../shared/time';

/**
 * Product analytics event retention window (PRD §12.5, ADD §18.3). Events are
 * purged after 90 days via {@link EventRepo.purgeOldEvents}.
 */
export const PRODUCT_EVENT_RETENTION_DAYS = 90;

export interface ProductEventInput {
  /** Non-secret analytics session id (`AS_...`); never the auth `session_key`. */
  sessionId: string;
  eventName: string;
  /** Versioned event-specific attributes; validated per
   *  `event_name + event_schema_version`. Kept separate from auth credentials. */
  attributes: Record<string, unknown>;
  actorKind: 'guest' | 'user' | 'system';
  /** Auth identity — used ONLY to derive a pseudonymized `actor_key`; the raw
   *  credential is never persisted in `product_events`. */
  userId?: string;
  guestSessionId?: string;
  // ── extended fields (from the batch request, with defaults) ─────────────
  eventId?: string;
  eventSchemaVersion?: string;
  occurredAt?: string;
  receivedAt?: string;
  environment?: string;
  appVersion?: string;
  mode?: string;
  sourceKind?: string;
  /** Caller-supplied pseudonym; when undefined, one is derived from the auth
   *  identity. When null, no actor_key is stored. */
  actorKey?: string | null;
  stage?: string | null;
  experimentId?: string | null;
}

export interface BatchResult {
  accepted: number;
  duplicates: number;
  rejected: number;
}

export interface QuickCompletionRateOptions {
  startDate: string;
  endDate: string;
  /** Defaults to `'custom'`; `internal_test` is always excluded from product
   *  metrics (PRD §12.6). */
  sourceKind?: string;
}

export interface QuickCompletionRateResult {
  numerator: number;
  denominator: number;
}

/**
 * Repository for `product_events` (§12B / PRD §12.5 / ADD §18.3).
 *
 * Product analytics events validate product-flow hypotheses; they are NOT a
 * source of business facts, requirement evidence, employee performance or
 * training certification. Auth credentials (`user_id` / `guest_session_id`)
 * are never stored here — only a pseudonymized `actor_key` and a non-secret
 * `analytics_session_id`. Events are retained for 90 days.
 */
export class EventRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Insert a single product event.
   *
   * `attributes` is stored as versioned JSON (separate from auth credentials).
   * The raw `userId`/`guestSessionId` are converted to a sha256-prefixed
   * `actor_key` pseudonym and never persisted directly. A 90-day `expires_at`
   * is stamped for retention purges.
   */
  create(input: ProductEventInput): ProductEvent {
    const ts = now();
    const occurredAt = input.occurredAt ?? ts;
    const actorKey =
      input.actorKey !== undefined ? input.actorKey : this.deriveActorKey(input);

    const row = this.db
      .insert(productEvents)
      .values({
        id: generateId('pe'),
        eventId: input.eventId ?? generateId('evt'),
        eventName: input.eventName,
        eventSchemaVersion: input.eventSchemaVersion ?? '1.0.0',
        occurredAt,
        receivedAt: input.receivedAt ?? ts,
        environment: input.environment ?? 'development',
        appVersion: input.appVersion ?? '1.0.0',
        mode: input.mode ?? 'quick',
        sourceKind: input.sourceKind ?? 'custom',
        analyticsSessionId: input.sessionId,
        actorKey,
        stage: input.stage ?? null,
        experimentId: input.experimentId ?? null,
        attributesJson: JSON.stringify(input.attributes ?? {}),
        createdAt: ts,
        expiresAt: addDays(ts, PRODUCT_EVENT_RETENTION_DAYS),
      })
      .returning()
      .get();

    return row;
  }

  /**
   * Insert a batch of events, categorizing outcomes by `event_id` uniqueness.
   *
   * Duplicate `event_id` values (already present) are counted as duplicates
   * rather than failures; other errors count as rejected. Insertion is
   * per-event so one bad event does not roll back the rest.
   */
  batchCreate(events: ProductEventInput[]): BatchResult {
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    for (const ev of events) {
      try {
        this.create(ev);
        accepted++;
      } catch (err) {
        if (isUniqueViolation(err)) {
          duplicates++;
        } else {
          rejected++;
        }
      }
    }
    return { accepted, duplicates, rejected };
  }

  /**
   * Purge events older than `days` (default 90). Returns the number of rows
   * deleted. Uses `created_at < now - days` to match the retention window.
   */
  purgeOldEvents(days = PRODUCT_EVENT_RETENTION_DAYS): number {
    const threshold = addDays(now(), -days);
    const result = this.db
      .delete(productEvents)
      .where(sql`${productEvents.createdAt} < ${threshold}`)
      .run();
    return result.changes;
  }

  /**
   * Minimal SQL report for the quick-completion-rate metric (PRD §12.6).
   *
   *   numerator   = distinct custom sessions with a `brief_generated` event
   *   denominator = distinct custom sessions with a `quick_session_started`
   *
   * `internal_test` is excluded by restricting to `source_kind = 'custom'`.
   * Both counts are scoped to the `[startDate, endDate]` occurred_at window.
   */
  getQuickCompletionRate(
    opts: QuickCompletionRateOptions,
  ): QuickCompletionRateResult {
    const { startDate, endDate, sourceKind = 'custom' } = opts;
    const range = and(
      gte(productEvents.occurredAt, startDate),
      lte(productEvents.occurredAt, endDate),
      eq(productEvents.sourceKind, sourceKind),
    );

    const denom = this.db
      .select({
        n: sql<number>`count(distinct ${productEvents.analyticsSessionId})`,
      })
      .from(productEvents)
      .where(
        and(range, eq(productEvents.eventName, 'quick_session_started')),
      )
      .get();
    const num = this.db
      .select({
        n: sql<number>`count(distinct ${productEvents.analyticsSessionId})`,
      })
      .from(productEvents)
      .where(and(range, eq(productEvents.eventName, 'brief_generated')))
      .get();

    return {
      numerator: Number(num?.n ?? 0),
      denominator: Number(denom?.n ?? 0),
    };
  }

  /**
   * Derive a non-reversible pseudonym from the auth identity.
   *
   * The raw `userId`/`guestSessionId` never reach `product_events`; only this
   * truncated sha256 digest is stored as `actor_key`.
   */
  private deriveActorKey(input: ProductEventInput): string | null {
    const identity = input.userId ?? input.guestSessionId;
    if (!identity) return null;
    return createHash('sha256')
      .update(`${input.actorKind}:${identity}`, 'utf8')
      .digest('hex')
      .slice(0, 32);
  }
}

/**
 * Detect a SQLite UNIQUE-constraint violation from a better-sqlite3 error.
 *
 * `event_id` has a UNIQUE constraint; a duplicate insert surfaces as
 * `SQLITE_CONSTRAINT_UNIQUE`.
 */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (e.code === 'SQLITE_CONSTRAINT' && typeof e.message === 'string') {
    return /unique/i.test(e.message);
  }
  return false;
}
