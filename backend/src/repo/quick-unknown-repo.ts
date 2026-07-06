import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { quickUnknowns, type QuickUnknown } from '../db/schema/quick';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

export interface CreateQuickUnknownInput {
  quickSessionId: string;
  /** Coverage slot / category — one of the schema CHECK values. */
  slot: string;
  question: string;
  /** 'blocking' maps to is_blocking=1; any other value maps to 0. */
  severity?: string;
  /** 'resolved' sets resolved_at; other values leave it null. */
  status?: string;
}

export class QuickUnknownRepo {
  constructor(private db: DrizzleDB) {}

  create(input: CreateQuickUnknownInput): QuickUnknown {
    const row = this.db
      .insert(quickUnknowns)
      .values({
        id: generateId('qu'),
        quickSessionId: input.quickSessionId,
        category: input.slot,
        description: input.question,
        isBlocking: input.severity === 'blocking' ? 1 : 0,
        resolvedAt: input.status === 'resolved' ? now() : null,
        createdAt: now(),
      })
      .returning()
      .get();

    return row;
  }

  listBySession(quickSessionId: string): QuickUnknown[] {
    return this.db
      .select()
      .from(quickUnknowns)
      .where(eq(quickUnknowns.quickSessionId, quickSessionId))
      .all();
  }

  replaceForSession(
    quickSessionId: string,
    items: Array<Omit<CreateQuickUnknownInput, 'quickSessionId'>>,
  ): QuickUnknown[] {
    this.db
      .delete(quickUnknowns)
      .where(eq(quickUnknowns.quickSessionId, quickSessionId))
      .run();
    return items.map((item) =>
      this.create({
        quickSessionId,
        slot: item.slot,
        question: item.question,
        severity: item.severity,
        status: item.status,
      }),
    );
  }

  /**
   * Update the resolution status of an unknown.
   *
   * `status='resolved'` stamps `resolved_at`; any other value clears it.
   */
  updateStatus(id: string, status: string): QuickUnknown {
    const row = this.db
      .update(quickUnknowns)
      .set({ resolvedAt: status === 'resolved' ? now() : null })
      .where(eq(quickUnknowns.id, id))
      .returning()
      .get();

    return row;
  }
}
