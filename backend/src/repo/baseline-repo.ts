import { eq, and, lt, or, desc, max } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { DrizzleDB } from '../db/client';
import {
  baselines,
  baselineItems,
  type Baseline,
  type BaselineItem,
} from '../db/schema/review';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface ListBaselineOptions {
  limit?: number;
  cursor?: string;
  status?: string;
}

/** A single entity-version entry to freeze inside a baseline. */
export interface BaselineEntityVersion {
  entityType: string;
  entityId: string;
  entityVersion: number;
}

export interface CreateBaselineInput {
  projectId: string;
  /** Parsed `{entity_id}@{version}` entries to freeze. */
  items: BaselineEntityVersion[];
  expectedProjectVersion?: number;
}

export interface ApproveBaselineInput {
  id: string;
  approverId: string;
  expectedVersion: number;
}

interface BaselineCursor {
  baselineVersion: number;
  id: string;
}

/**
 * Repository for §7.2 baselines & baseline_items.
 *
 * A baseline freezes a set of entity versions under a `data_hash`. Approval is
 * a separate one-shot transition (`draft → approved`); reports may only read
 * from an approved baseline's frozen items.
 */
export class BaselineRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of baselines for a project, newest-version first. */
  listByProject(projectId: string, opts: ListBaselineOptions = {}): {
    items: Baseline[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(baselines.projectId, projectId)];
    if (opts.status) conditions.push(eq(baselines.status, opts.status));

    if (cursor) {
      const c = decodeCursor<BaselineCursor>(cursor);
      conditions.push(
        or(
          lt(baselines.baselineVersion, c.baselineVersion),
          and(eq(baselines.baselineVersion, c.baselineVersion), lt(baselines.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(baselines)
      .where(and(...conditions))
      .orderBy(desc(baselines.baselineVersion), desc(baselines.id))
      .limit(limit)
      .all()
      .reverse();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ baselineVersion: last.baselineVersion, id: last.id });
    }
    return { items, nextCursor };
  }

  /** Find a single baseline by id, or null. */
  findById(id: string): Baseline | null {
    const row = this.db
      .select()
      .from(baselines)
      .where(eq(baselines.id, id))
      .get();
    return row ?? null;
  }

  /** Return all frozen items for a baseline. */
  getItems(baselineId: string): BaselineItem[] {
    return this.db
      .select()
      .from(baselineItems)
      .where(eq(baselineItems.baselineId, baselineId))
      .all();
  }

  /** Create a candidate (`draft`) baseline freezing the given entity versions. */
  create(input: CreateBaselineInput): Baseline {
    if (input.items.length === 0) {
      throw ApiError.validationError({ entity_versions: 'must not be empty' });
    }

    const last = this.db
      .select({ m: max(baselines.baselineVersion) })
      .from(baselines)
      .where(eq(baselines.projectId, input.projectId))
      .get();
    const nextVersion = (last?.m ?? 0) + 1;

    const dataHash = computeBaselineHash(input.projectId, nextVersion, input.items);
    const ts = now();
    const id = generateId('bl');

    return this.db.transaction((tx) => {
      const baseline = tx
        .insert(baselines)
        .values({
          id,
          projectId: input.projectId,
          baselineVersion: nextVersion,
          status: 'draft',
          approvedBy: null,
          approvedAt: null,
          dataHash,
          version: 1,
          createdAt: ts,
        })
        .returning()
        .get();

      for (const ev of input.items) {
        tx.insert(baselineItems)
          .values({
            baselineId: id,
            entityType: ev.entityType,
            entityId: ev.entityId,
            entityVersion: ev.entityVersion,
            snapshotHash: dataHash,
          })
          .run();
      }

      return baseline;
    });
  }

  /**
   * Approve a draft baseline (one-shot `draft → approved`).
   *
   * Wrapped in a single transaction that first supersedes any prior approved
   * baseline for the project, enforcing the §7.2 invariant: at most one
   * approved baseline per project at any time. Approving a newer draft thus
   * supersedes the previously-approved one.
   */
  approve(input: ApproveBaselineInput): Baseline {
    const current = this.findById(input.id);
    if (!current) throw ApiError.notFound('Baseline not found', 'baseline');
    if (current.version !== input.expectedVersion) {
      throw ApiError.versionConflict();
    }
    if (current.status !== 'draft') {
      throw ApiError.conflict(
        'BASELINE_NOT_DRAFT',
        `Baseline is in '${current.status}' status, only 'draft' can be approved`,
      );
    }

    const ts = now();
    return this.db.transaction((tx) => {
      // Supersede any prior approved baseline for this project.
      const prior = tx
        .select()
        .from(baselines)
        .where(
          and(
            eq(baselines.projectId, current.projectId),
            eq(baselines.status, 'approved'),
          ),
        )
        .all();
      for (const p of prior) {
        tx.update(baselines)
          .set({ status: 'superseded' })
          .where(eq(baselines.id, p.id))
          .run();
      }

      return tx
        .update(baselines)
        .set({
          status: 'approved',
          approvedBy: input.approverId,
          approvedAt: ts,
          version: current.version + 1,
        })
        .where(eq(baselines.id, input.id))
        .returning()
        .get();
    });
  }

  /** Return the latest approved baseline for a project, or null. */
  findApproved(projectId: string): Baseline | null {
    const row = this.db
      .select()
      .from(baselines)
      .where(
        and(
          eq(baselines.projectId, projectId),
          eq(baselines.status, 'approved'),
        ),
      )
      .orderBy(desc(baselines.baselineVersion))
      .limit(1)
      .get();
    return row ?? null;
  }
}

/** Deterministic SHA-256 over the baseline's frozen entity versions. */
function computeBaselineHash(
  projectId: string,
  baselineVersion: number,
  entityVersions: BaselineEntityVersion[],
): string {
  const payload = JSON.stringify({
    projectId,
    baselineVersion,
    items: entityVersions
      .map((ev) => ({ type: ev.entityType, id: ev.entityId, version: ev.entityVersion }))
      .sort((a, b) =>
        a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type),
      ),
  });
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}
