import { eq, and, lt, or, desc, max } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  briefVersions,
  briefExports,
  optionPreferences,
  type BriefVersion,
  type BriefExport,
} from '../db/schema/quick';
import { generateId } from '../shared/id';
import { now, addDays, isExpired } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface CreateBriefVersionInput {
  quickSessionId: string;
  /** Accepted for API symmetry; brief_versions has no view_type column. */
  viewType?: string;
  contentJson: string;
  /** 'incomplete' marks the version as isIncomplete=1. */
  status?: string;
  blockingUnknownCount?: number;
}

export interface ListBriefVersionOptions {
  limit?: number;
  cursor?: string;
}

export interface CreateBriefExportInput {
  briefVersionId: string;
  /** 'copy' or 'download' — maps to export_type. */
  format: string;
  /** Optional view type; defaults to 'simple'. */
  viewType?: string;
}

export interface BriefExportResult {
  exportRow: BriefExport;
  expired: boolean;
}

export interface RecordOptionPreferenceInput {
  quickSessionId: string;
  optionId: string;
  /** Boolean preference: true = matches AI recommendation. */
  preference: boolean;
  briefVersionId?: string;
}

export interface SubmitFeedbackInput {
  briefVersionId: string;
  usefulnessScore: number;
  comment?: string;
}

interface BriefVersionCursor {
  version: number;
  id: string;
}

export class BriefRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Create a new brief version. `version` auto-increments per session.
   */
  createVersion(input: CreateBriefVersionInput): BriefVersion {
    const last = this.db
      .select({ m: max(briefVersions.version) })
      .from(briefVersions)
      .where(eq(briefVersions.quickSessionId, input.quickSessionId))
      .get();
    const nextVersion = (last?.m ?? 0) + 1;

    const ts = now();
    const row = this.db
      .insert(briefVersions)
      .values({
        id: generateId('bn'),
        quickSessionId: input.quickSessionId,
        version: nextVersion,
        snapshotJson: input.contentJson,
        isIncomplete: input.status === 'incomplete' ? 1 : 0,
        blockingUnknownCount: input.blockingUnknownCount ?? 0,
        generatedAt: ts,
        generatedBy: 'system',
      })
      .returning()
      .get();

    return row;
  }

  /** Find a specific version by session + version number. */
  findVersion(quickSessionId: string, version: number): BriefVersion | null {
    const row = this.db
      .select()
      .from(briefVersions)
      .where(
        and(
          eq(briefVersions.quickSessionId, quickSessionId),
          eq(briefVersions.version, version),
        ),
      )
      .get();
    return row ?? null;
  }

  /** Paginated list of versions, newest first. */
  listVersions(quickSessionId: string, opts: ListBriefVersionOptions = {}): {
    items: BriefVersion[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(briefVersions.quickSessionId, quickSessionId)];

    if (cursor) {
      const c = decodeCursor<BriefVersionCursor>(cursor);
      conditions.push(
        or(
          lt(briefVersions.version, c.version),
          and(
            eq(briefVersions.version, c.version),
            lt(briefVersions.id, c.id),
          ),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(briefVersions)
      .where(and(...conditions))
      .orderBy(desc(briefVersions.version), desc(briefVersions.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        version: last.version,
        id: last.id,
      });
    }

    return { items, nextCursor };
  }

  /** Return the highest-numbered version for a session, or null. */
  findLatestVersion(quickSessionId: string): BriefVersion | null {
    const row = this.db
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.quickSessionId, quickSessionId))
      .orderBy(desc(briefVersions.version))
      .limit(1)
      .get();
    return row ?? null;
  }

  /**
   * Return the projection view (latest version's snapshot) for a session.
   *
   * `viewType` is accepted for API symmetry but brief_versions does not store
   * it — the latest version is returned regardless of view.
   */
  getView(quickSessionId: string, _viewType: string): BriefVersion | null {
    return this.findLatestVersion(quickSessionId);
  }

  /**
   * Create an export record with a 24-hour expiry.
   */
  createExport(input: CreateBriefExportInput): BriefExport {
    const ts = now();
    const row = this.db
      .insert(briefExports)
      .values({
        id: generateId('be'),
        briefVersionId: input.briefVersionId,
        viewType: input.viewType ?? 'simple',
        exportType: input.format,
        exportedAt: ts,
        exportedBy: 'system',
        expiresAt: addDays(ts, 1),
      })
      .returning()
      .get();

    return row;
  }

  /**
   * Find an export by id and report whether it has expired.
   */
  findExport(exportId: string): BriefExportResult | null {
    const row = this.db
      .select()
      .from(briefExports)
      .where(eq(briefExports.id, exportId))
      .get();
    if (!row) return null;
    const expired = row.expiresAt !== null && isExpired(row.expiresAt);
    return { exportRow: row, expired };
  }

  /** Record a user's preference on a brief option. */
  recordOptionPreference(input: RecordOptionPreferenceInput): void {
    this.db
      .insert(optionPreferences)
      .values({
        id: generateId('op'),
        quickSessionId: input.quickSessionId,
        briefVersionId: input.briefVersionId ?? null,
        optionId: input.optionId,
        matchesAiRecommendation: input.preference ? 1 : 0,
        recordedBy: 'system',
        recordedAt: now(),
      })
      .run();
  }

  /**
   * Submit feedback on a brief version.
   *
   * The schema has no dedicated brief-feedback table, so feedback is persisted
   * as an `option_preferences` row with optionId `__brief_feedback__`. The
   * usefulness score (0-5) is encoded as matchesAiRecommendation (>=4 → 1).
   * The quickSessionId is resolved from the brief version to satisfy the NOT
   * NULL FK on option_preferences.
   */
  submitFeedback(input: SubmitFeedbackInput): void {
    const bv = this.db
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.id, input.briefVersionId))
      .get();
    if (!bv) {
      throw new Error(`Brief version not found: ${input.briefVersionId}`);
    }
    this.db
      .insert(optionPreferences)
      .values({
        id: generateId('op'),
        quickSessionId: bv.quickSessionId,
        briefVersionId: input.briefVersionId,
        optionId: '__brief_feedback__',
        matchesAiRecommendation: input.usefulnessScore >= 4 ? 1 : 0,
        recordedBy: 'system',
        recordedAt: now(),
      })
      .run();
  }
}
