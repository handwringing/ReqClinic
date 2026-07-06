import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { drivers, type Driver } from '../db/schema/core';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface ListDriverOptions {
  limit?: number;
  cursor?: string;
  driverType?: string;
  status?: string;
}

export interface CreateDriverInput {
  projectId: string;
  driverType: string;
  statement: string;
  ownerId?: string;
  status?: string;
}

export interface UpdateDriverInput {
  statement?: string;
  ownerId?: string;
  status?: string;
  expectedVersion?: number;
}

interface DriverCursor {
  createdAt: string;
  id: string;
}

/**
 * Repository for §6.1 drivers (goals, outcomes, obligations, risks, problems,
 * opportunities). Outcomes are drivers with `driver_type='outcome'` plus an
 * extended `outcomes` row.
 */
export class DriverRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of drivers for a project, newest-first. */
  listByProject(projectId: string, opts: ListDriverOptions = {}): {
    items: Driver[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(drivers.projectId, projectId)];
    if (opts.driverType) conditions.push(eq(drivers.driverType, opts.driverType));
    if (opts.status) conditions.push(eq(drivers.status, opts.status));

    if (cursor) {
      const c = decodeCursor<DriverCursor>(cursor);
      conditions.push(
        or(
          lt(drivers.createdAt, c.createdAt),
          and(eq(drivers.createdAt, c.createdAt), lt(drivers.id, c.id)),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(drivers)
      .where(and(...conditions))
      .orderBy(desc(drivers.createdAt), desc(drivers.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
    }
    return { items, nextCursor };
  }

  /** Find a driver by id, or null. */
  findById(id: string): Driver | null {
    const row = this.db.select().from(drivers).where(eq(drivers.id, id)).get();
    return row ?? null;
  }

  /** Create a new driver in `candidate` status. */
  create(input: CreateDriverInput): Driver {
    const ts = now();
    return this.db
      .insert(drivers)
      .values({
        id: generateId('drv'),
        projectId: input.projectId,
        driverType: input.driverType,
        statement: input.statement,
        ownerId: input.ownerId ?? null,
        status: input.status ?? 'candidate',
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .get();
  }

  /** Update a driver with optimistic-concurrency check. */
  update(id: string, input: UpdateDriverInput): Driver {
    const current = this.findById(id);
    if (!current) throw ApiError.notFound('Driver not found', 'driver');
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw ApiError.versionConflict();
    }

    const patch: Partial<typeof drivers.$inferInsert> = {
      version: current.version + 1,
      updatedAt: now(),
    };
    if (input.statement !== undefined) patch.statement = input.statement;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.status !== undefined) patch.status = input.status;

    return this.db
      .update(drivers)
      .set(patch)
      .where(eq(drivers.id, id))
      .returning()
      .get();
  }
}
