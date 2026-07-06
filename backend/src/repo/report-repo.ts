import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  reportSnapshots,
  reportGateResults,
  type ReportSnapshot,
  type ReportGateResult,
} from '../db/schema/report';
import { blobs } from '../db/schema/source';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

/**
 * Repository for `report_snapshots` & `report_gate_results` (§10).
 *
 * The publish lifecycle is a recoverable state machine (§10.7):
 *   draft → gate_failed | rendering → staged → ready → released → superseded
 *                                                ↘ publish_failed ↗ (retry via rendering)
 *
 * `released` requires a registered file blob/sha, the confirmer identity and
 * time. Released snapshots are immutable; supersession is modelled by
 * superseding the prior released snapshot.
 */

export type ReportStatus =
  | 'draft'
  | 'gate_failed'
  | 'rendering'
  | 'staged'
  | 'ready'
  | 'released'
  | 'publish_failed'
  | 'superseded';

/** Allowed forward transitions per §10.7. */
const REPORT_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['gate_failed', 'rendering']),
  gate_failed: new Set(['rendering']),
  rendering: new Set(['staged', 'publish_failed']),
  staged: new Set(['ready']),
  ready: new Set(['released', 'publish_failed']),
  released: new Set(['superseded']),
  publish_failed: new Set(['rendering']),
  superseded: new Set(),
};

export interface CreateReportInput {
  projectId: string;
  baselineId: string;
  dataHash: string;
  templateId: string;
  templateVersion: string;
  coreSchemaVersion: string;
  reportInputSchemaHash: string;
  compilerVersion: string;
  domainProfileId: string;
  domainProfileVersion: number;
  domainPackVersions: string[];
  promptVersions?: string[];
  modelVersions?: string[];
  audience: string;
  language: string;
  supersedesReportId?: string | null;
  /** Gate results to seed alongside the snapshot (may be empty). */
  gateResults?: GateResultInput[];
}

export interface GateResultInput {
  gateCode: string;
  status: 'passed' | 'failed' | 'warning';
  defectsJson?: string;
}

export interface ListReportOptions {
  limit?: number;
  cursor?: string;
  status?: string;
}

interface ReportCursor {
  reportVersion: number;
  id: string;
}

export class ReportRepo {
  constructor(private db: DrizzleDB) {}

  /** Find a report snapshot by id, or null. */
  findById(id: string): ReportSnapshot | null {
    const row = this.db
      .select()
      .from(reportSnapshots)
      .where(eq(reportSnapshots.id, id))
      .get();
    return row ?? null;
  }

  /** Paginated list of report snapshots for a project, newest version first. */
  listByProject(projectId: string, opts: ListReportOptions = {}): {
    items: ReportSnapshot[];
    nextCursor: string | null;
  } {
    const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 50)));
    const conditions = [eq(reportSnapshots.projectId, projectId)];
    if (opts.status) {
      conditions.push(eq(reportSnapshots.status, opts.status));
    }
    if (opts.cursor) {
      const c = JSON.parse(
        Buffer.from(opts.cursor, 'base64url').toString('utf8'),
      ) as ReportCursor;
      conditions.push(sql`${reportSnapshots.reportVersion} < ${c.reportVersion}`);
    }

    const items = this.db
      .select()
      .from(reportSnapshots)
      .where(and(...conditions))
      .orderBy(desc(reportSnapshots.reportVersion))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ reportVersion: last.reportVersion, id: last.id }),
        'utf8',
      ).toString('base64url');
    }
    return { items, nextCursor };
  }

  /** Gate results recorded for a report. */
  getGateResults(reportId: string): ReportGateResult[] {
    return this.db
      .select()
      .from(reportGateResults)
      .where(eq(reportGateResults.reportId, reportId))
      .all();
  }

  /**
   * Create a `draft` report snapshot. `report_version` is `max(existing) + 1`.
   * Optional gate results are inserted atomically with the snapshot.
   */
  create(input: CreateReportInput): ReportSnapshot {
    const ts = now();
    const id = generateId('rpt');

    return this.db.transaction((tx) => {
      const maxRow = tx
        .select({ mv: sql<number>`MAX(${reportSnapshots.reportVersion})` })
        .from(reportSnapshots)
        .where(eq(reportSnapshots.projectId, input.projectId))
        .get();
      const nextVersion = (maxRow?.mv ?? 0) + 1;

      const row = tx
        .insert(reportSnapshots)
        .values({
          id,
          projectId: input.projectId,
          reportVersion: nextVersion,
          baselineId: input.baselineId,
          dataHash: input.dataHash,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
          coreSchemaVersion: input.coreSchemaVersion,
          reportInputSchemaHash: input.reportInputSchemaHash,
          compilerVersion: input.compilerVersion,
          domainProfileId: input.domainProfileId,
          domainProfileVersion: input.domainProfileVersion,
          domainPackVersionsJson: JSON.stringify(input.domainPackVersions),
          promptVersionsJson: JSON.stringify(input.promptVersions ?? []),
          modelVersionsJson: JSON.stringify(input.modelVersions ?? []),
          audience: input.audience,
          language: input.language,
          fileBlobId: null,
          fileSha256: null,
          status: 'draft',
          generatedAt: ts,
          releasedBy: null,
          releasedAt: null,
          supersedesReportId: input.supersedesReportId ?? null,
        })
        .returning()
        .get();

      for (const g of input.gateResults ?? []) {
        tx.insert(reportGateResults)
          .values({
            id: generateId('rgr'),
            reportId: id,
            gateCode: g.gateCode,
            status: g.status,
            defectsJson: g.defectsJson ?? '[]',
            checkedAt: ts,
          })
          .run();
      }

      return row;
    });
  }

  /**
   * Transition the report status following §10.7. Throws on invalid
   * transitions. `expectedVersion` (when provided) must match the current
   * `report_version` (the snapshot's only version-like field).
   */
  updateStatus(
    id: string,
    nextStatus: ReportStatus,
    expectedVersion?: number,
  ): ReportSnapshot {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Report not found', 'report');
    }
    if (expectedVersion !== undefined && current.reportVersion !== expectedVersion) {
      throw ApiError.versionConflict();
    }
    const allowed = REPORT_TRANSITIONS[current.status];
    if (!allowed || !allowed.has(nextStatus)) {
      throw ApiError.conflict(
        'INVALID_REPORT_TRANSITION',
        `Cannot transition report from '${current.status}' to '${nextStatus}'`,
      );
    }
    return this.db
      .update(reportSnapshots)
      .set({ status: nextStatus })
      .where(eq(reportSnapshots.id, id))
      .returning()
      .get();
  }

  /**
   * Release a `ready` report: register the file blob/sha, set the releaser and
   * time, and flip to `released`. The prior released snapshot for the project
   * is superseded. Throws when the report is not `ready` or the file is missing.
   */
  release(
    id: string,
    releaserId: string,
    file: { blobId: string; sha256: string },
  ): ReportSnapshot {
    return this.db.transaction((tx) => {
      const current = tx
        .select()
        .from(reportSnapshots)
        .where(eq(reportSnapshots.id, id))
        .get();
      if (!current) {
        throw ApiError.notFound('Report not found', 'report');
      }
      if (current.status !== 'ready') {
        throw ApiError.conflict(
          'INVALID_REPORT_TRANSITION',
          `Cannot release report in status '${current.status}' (requires 'ready')`,
        );
      }

      const ts = now();

      // Supersede the previously-released snapshot for this project.
      const prior = tx
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.projectId, current.projectId),
            eq(reportSnapshots.status, 'released'),
          ),
        )
        .all();
      for (const p of prior) {
        tx.update(reportSnapshots)
          .set({ status: 'superseded' })
          .where(eq(reportSnapshots.id, p.id))
          .run();
      }

      const updated = tx
        .update(reportSnapshots)
        .set({
          status: 'released',
          fileBlobId: file.blobId,
          fileSha256: file.sha256,
          releasedBy: releaserId,
          releasedAt: ts,
        })
        .where(eq(reportSnapshots.id, id))
        .returning()
        .get();

      return updated;
    });
  }

  /** Byte size of the registered file blob, or null when not staged. */
  getFileSize(reportId: string): number | null {
    const row = this.db
      .select({ size: blobs.byteSize })
      .from(blobs)
      .innerJoin(reportSnapshots, eq(reportSnapshots.fileBlobId, blobs.id))
      .where(eq(reportSnapshots.id, reportId))
      .get();
    return row?.size ?? null;
  }

  /** Bulk-fetch blob sizes for a set of report ids. */
  getBlobSizes(reportIds: string[]): Map<string, number> {
    const out = new Map<string, number>();
    if (reportIds.length === 0) return out;
    const rows = this.db
      .select({ id: reportSnapshots.id, size: blobs.byteSize })
      .from(reportSnapshots)
      .leftJoin(blobs, eq(reportSnapshots.fileBlobId, blobs.id))
      .where(inArray(reportSnapshots.id, reportIds))
      .all();
    for (const r of rows) out.set(r.id, r.size ?? 0);
    return out;
  }
}
