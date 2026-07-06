import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { blobs, sources, type Blob, type Source } from '../db/schema/source';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface CreateSourceInput {
  projectId: string;
  blobId: string;
  filename: string;
  mediaType: string;
  /** Byte size of the underlying blob; not stored on sources directly. */
  size?: number;
  submittedBy: string;
  /** Accepted for API symmetry; sources has no retention_kind column. */
  retentionKind?: string;
  /** Source type (e.g. document, transcript). Defaults to `upload`. */
  sourceType?: string;
  /** Sensitivity classification. Defaults to `internal`. */
  sensitivity?: string;
  /** Optional author attribution. */
  author?: string | null;
  /** Optional capture timestamp (ISO 8601). */
  capturedAt?: string | null;
}

export interface CreateBlobInput {
  sha256: string;
  size: number;
  mediaType: string;
  storagePath: string;
}

export interface ListSourceOptions {
  limit?: number;
  cursor?: string;
}

interface SourceCursor {
  createdAt: string;
  id: string;
}

export class SourceRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of sources for a project, newest-first. */
  listByProject(projectId: string, opts: ListSourceOptions = {}): {
    items: Source[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(sources.projectId, projectId)];

    if (cursor) {
      const c = decodeCursor<SourceCursor>(cursor);
      conditions.push(
        or(
          lt(sources.createdAt, c.createdAt),
          and(
            eq(sources.createdAt, c.createdAt),
            lt(sources.id, c.id),
          ),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(sources)
      .where(and(...conditions))
      .orderBy(desc(sources.createdAt), desc(sources.id))
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

  /**
   * Create a source row referencing an existing blob.
   *
   * Defaults: `source_type='upload'`, `sensitivity='internal'`,
   * `extraction_status='uploaded'`.
   */
  create(input: CreateSourceInput): Source {
    const ts = now();
    const row = this.db
      .insert(sources)
      .values({
        id: generateId('src'),
        projectId: input.projectId,
        blobId: input.blobId,
        fileName: input.filename,
        mediaType: input.mediaType,
        sourceType: input.sourceType ?? 'upload',
        sensitivity: input.sensitivity ?? 'internal',
        author: input.author ?? null,
        capturedAt: input.capturedAt ?? null,
        extractionStatus: 'uploaded',
        createdBy: input.submittedBy,
        createdAt: ts,
      })
      .returning()
      .get();

    return row;
  }

  /** Insert a blob record (physical file metadata). */
  createBlob(input: CreateBlobInput): Blob {
    const row = this.db
      .insert(blobs)
      .values({
        id: generateId('blb'),
        sha256: input.sha256,
        storagePath: input.storagePath,
        byteSize: input.size,
        mediaType: input.mediaType,
        scanStatus: 'pending',
        createdAt: now(),
      })
      .returning()
      .get();

    return row;
  }

  /** Find a source by id, or null. */
  findById(id: string): Source | null {
    const row = this.db
      .select()
      .from(sources)
      .where(eq(sources.id, id))
      .get();
    return row ?? null;
  }
}
