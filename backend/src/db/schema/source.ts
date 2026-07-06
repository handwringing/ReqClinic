import { sqliteTable, text, integer, check, uniqueIndex, index, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projects } from './project';

/**
 * Sources & evidence (§5): blobs, sources, evidence_spans.
 *
 * Same-hash files share one `blobs` physical object; different projects or
 * semantics keep independent `sources`. `storage_path` lives only on the blob
 * and must be a normalized relative path under the controlled root.
 */

// §5.1 blobs
export const blobs = sqliteTable(
  'blobs',
  {
    id: text('id').primaryKey(),
    sha256: text('sha256').notNull().unique(),
    storagePath: text('storage_path').notNull().unique(),
    byteSize: integer('byte_size').notNull(),
    mediaType: text('media_type').notNull(),
    scanStatus: text('scan_status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('blobs_byte_size_check', sql`byte_size >= 0`),
    check('blobs_scan_status_check', sql`scan_status IN ('pending','clean','blocked','failed')`),
    index('idx_blobs_sha256').on(t.sha256),
  ],
);

// §5.1 sources
export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
    blobId: text('blob_id').notNull().references(() => blobs.id, { onDelete: 'restrict' }),
    fileName: text('file_name').notNull(),
    mediaType: text('media_type').notNull(),
    sourceType: text('source_type').notNull(),
    author: text('author'),
    capturedAt: text('captured_at'),
    extractedTextHash: text('extracted_text_hash'),
    parserVersion: text('parser_version'),
    // Self-reference declared as a table-level FK below.
    supersedesSourceId: text('supersedes_source_id'),
    sensitivity: text('sensitivity').notNull(),
    extractionStatus: text('extraction_status').notNull(),
    createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('sources_sensitivity_check', sql`sensitivity IN ('public','internal','confidential','restricted')`),
    check(
      'sources_extraction_status_check',
      sql`extraction_status IN ('uploaded','queued','parsing','parsed','failed')`,
    ),
    index('idx_sources_project_extraction_created').on(t.projectId, t.extractionStatus, t.createdAt),
    index('idx_sources_project_blob').on(t.projectId, t.blobId),
    // Self-reference: supersedes_source_id -> sources(id) ON DELETE RESTRICT
    foreignKey({
      columns: [t.supersedesSourceId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
  ],
);

// §5.2 evidence_spans
export const evidenceSpans = sqliteTable(
  'evidence_spans',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'restrict' }),
    page: integer('page'),
    section: text('section'),
    coordinateSpace: text('coordinate_space').notNull().default('normalized_unicode_codepoint_v1'),
    normalizedDocumentHash: text('normalized_document_hash').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    exactText: text('exact_text').notNull(),
    normalizedText: text('normalized_text').notNull(),
    spanHash: text('span_hash').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('evidence_spans_page_check', sql`page IS NULL OR page > 0`),
    check('evidence_spans_start_offset_check', sql`start_offset >= 0`),
    check('evidence_spans_end_offset_check', sql`end_offset > start_offset`),
    uniqueIndex('uq_evidence_spans_source_span').on(t.sourceId, t.startOffset, t.endOffset, t.spanHash),
    index('idx_evidence_spans_source_start').on(t.sourceId, t.startOffset),
  ],
);

export type Blob = typeof blobs.$inferSelect;
export type NewBlob = typeof blobs.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type EvidenceSpan = typeof evidenceSpans.$inferSelect;
export type NewEvidenceSpan = typeof evidenceSpans.$inferInsert;
