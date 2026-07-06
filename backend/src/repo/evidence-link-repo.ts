import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { evidenceLinks, traceLinks, type EvidenceLink, type TraceLink } from '../db/schema/core';

export interface ListEvidenceLinkOptions {
  entityType?: string;
  entityId?: string;
}

export interface ListTraceLinkOptions {
  fromType?: string;
  fromId?: string;
  toType?: string;
  toId?: string;
}

/**
 * Repository for §6.4 evidence_links and trace_links.
 *
 * Evidence links connect a descriptive entity to an evidence span (supports /
 * contradicts / qualifies / originates); trace links connect two entities
 * across the requirements graph (driver → requirement → decision, etc.). Both
 * are read-only here — creation happens through the analysis pipeline.
 */
export class EvidenceLinkRepo {
  constructor(private db: DrizzleDB) {}

  /** List evidence links for a project, optionally filtered by entity. */
  listByProject(projectId: string, opts: ListEvidenceLinkOptions = {}): EvidenceLink[] {
    const conditions = [eq(evidenceLinks.projectId, projectId)];
    if (opts.entityType) conditions.push(eq(evidenceLinks.entityType, opts.entityType));
    if (opts.entityId) conditions.push(eq(evidenceLinks.entityId, opts.entityId));

    return this.db
      .select()
      .from(evidenceLinks)
      .where(and(...conditions))
      .orderBy(desc(evidenceLinks.createdAt))
      .all();
  }

  /** List trace links for a project, optionally filtered by from/to endpoints. */
  listTraceLinks(projectId: string, opts: ListTraceLinkOptions = {}): TraceLink[] {
    const conditions = [eq(traceLinks.projectId, projectId)];
    if (opts.fromType) conditions.push(eq(traceLinks.fromType, opts.fromType));
    if (opts.fromId) conditions.push(eq(traceLinks.fromId, opts.fromId));
    if (opts.toType) conditions.push(eq(traceLinks.toType, opts.toType));
    if (opts.toId) conditions.push(eq(traceLinks.toId, opts.toId));

    return this.db
      .select()
      .from(traceLinks)
      .where(and(...conditions))
      .orderBy(desc(traceLinks.createdAt))
      .all();
  }
}
