import { eq, and, lt, or, desc } from 'drizzle-orm';
import { createHash as nodeCreateHash } from 'node:crypto';
import type { DrizzleDB } from '../db/client';
import { evidenceSpans, sources, type EvidenceSpan } from '../db/schema/source';
import { evidenceLinks, traceLinks, type EvidenceLink, type TraceLink } from '../db/schema/core';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface CreateSpanInput {
  sourceId: string;
  startOffset: number;
  endOffset: number;
  content: string;
  /** Maps to the `section` column (closest semantic match). */
  category?: string;
}

export interface ListEvidenceOptions {
  limit?: number;
  cursor?: string;
}

interface EvidenceCursor {
  createdAt: string;
  id: string;
}

export class EvidenceRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Paginated list of evidence spans for a project (joined through sources),
   * newest-first.
   */
  listByProject(projectId: string, opts: ListEvidenceOptions = {}): {
    items: EvidenceSpan[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(sources.projectId, projectId)];

    if (cursor) {
      const c = decodeCursor<EvidenceCursor>(cursor);
      conditions.push(
        or(
          lt(evidenceSpans.createdAt, c.createdAt),
          and(
            eq(evidenceSpans.createdAt, c.createdAt),
            lt(evidenceSpans.id, c.id),
          ),
        )!,
      );
    }

    const items = this.db
      .select({
        id: evidenceSpans.id,
        sourceId: evidenceSpans.sourceId,
        page: evidenceSpans.page,
        section: evidenceSpans.section,
        coordinateSpace: evidenceSpans.coordinateSpace,
        normalizedDocumentHash: evidenceSpans.normalizedDocumentHash,
        startOffset: evidenceSpans.startOffset,
        endOffset: evidenceSpans.endOffset,
        exactText: evidenceSpans.exactText,
        normalizedText: evidenceSpans.normalizedText,
        spanHash: evidenceSpans.spanHash,
        createdAt: evidenceSpans.createdAt,
      })
      .from(evidenceSpans)
      .innerJoin(sources, eq(evidenceSpans.sourceId, sources.id))
      .where(and(...conditions))
      .orderBy(desc(evidenceSpans.createdAt), desc(evidenceSpans.id))
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

  /** List all evidence links for a project. */
  listEvidenceLinks(projectId: string): EvidenceLink[] {
    return this.db
      .select()
      .from(evidenceLinks)
      .where(eq(evidenceLinks.projectId, projectId))
      .all();
  }

  /** List all trace links for a project. */
  listTraceLinks(projectId: string): TraceLink[] {
    return this.db
      .select()
      .from(traceLinks)
      .where(eq(traceLinks.projectId, projectId))
      .all();
  }

  /**
   * Create an evidence span on a source.
   *
   * `exact_text` and `normalized_text` are both set to `content`.
   * `span_hash` is SHA-256 of the content. `normalized_document_hash` is
   * derived from the source's blob id (a stable per-source identifier).
   */
  createSpan(input: CreateSpanInput): EvidenceSpan {
    // Look up the source to derive a stable normalized_document_hash.
    const source = this.db
      .select({ id: sources.id, blobId: sources.blobId })
      .from(sources)
      .where(eq(sources.id, input.sourceId))
      .get();

    const normalizedDocumentHash = source
      ? nodeCreateHash('sha256').update(`source:${source.id}`, 'utf8').digest('hex')
      : nodeCreateHash('sha256').update(`source:${input.sourceId}`, 'utf8').digest('hex');

    const spanHash = nodeCreateHash('sha256').update(input.content, 'utf8').digest('hex');

    const row = this.db
      .insert(evidenceSpans)
      .values({
        id: generateId('ev'),
        sourceId: input.sourceId,
        section: input.category ?? null,
        coordinateSpace: 'normalized_unicode_codepoint_v1',
        normalizedDocumentHash,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        exactText: input.content,
        normalizedText: input.content,
        spanHash,
        createdAt: now(),
      })
      .returning()
      .get();

    return row;
  }
}
