import { eq, and, lt, or, desc, max } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { DrizzleDB } from '../db/client';
import { projectIntakes, type ProjectIntake } from '../db/schema/project';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface CreateIntakeInput {
  projectId: string;
  originalText: string;
  decisionIntent?: string;
  selectedWorkType?: string;
  candidateRoles?: string[];
  candidateConstraints?: string[];
  submittedBy: string;
  sourceQuickSessionId?: string;
  sourceBriefVersionId?: string;
  sourceQuickSessionHash?: string;
  sourceBriefSnapshotHash?: string;
}

export interface ListIntakeOptions {
  limit?: number;
  cursor?: string;
}

interface IntakeCursor {
  intakeVersion: number;
  id: string;
}

export class IntakeRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Create a new intake version for a project.
   *
   * `intake_version` auto-increments per project. When version > 1, the
   * previous latest intake is superseded. `content_hash` is computed as
   * SHA-256 over the canonical payload.
   */
  create(input: CreateIntakeInput): ProjectIntake {
    // Source-id XOR: both set or both null.
    const hasSessionId = input.sourceQuickSessionId !== undefined;
    const hasBriefId = input.sourceBriefVersionId !== undefined;
    if (hasSessionId !== hasBriefId) {
      throw ApiError.validationError({
        sourceQuickSessionId: 'must be both set or both null with sourceBriefVersionId',
      });
    }

    const last = this.db
      .select({ m: max(projectIntakes.intakeVersion) })
      .from(projectIntakes)
      .where(eq(projectIntakes.projectId, input.projectId))
      .get();
    const nextVersion = (last?.m ?? 0) + 1;

    // Find the previous latest intake to supersede.
    let supersededId: string | null = null;
    if (nextVersion > 1) {
      const prev = this.db
        .select()
        .from(projectIntakes)
        .where(eq(projectIntakes.projectId, input.projectId))
        .orderBy(desc(projectIntakes.intakeVersion))
        .limit(1)
        .get();
      supersededId = prev?.id ?? null;
    }

    const contentHash = computeContentHash(input);
    const ts = now();

    const row = this.db
      .insert(projectIntakes)
      .values({
        id: generateId('int'),
        projectId: input.projectId,
        intakeVersion: nextVersion,
        originalText: input.originalText,
        decisionIntent: input.decisionIntent ?? null,
        selectedWorkType: input.selectedWorkType ?? null,
        candidateRolesJson: JSON.stringify(input.candidateRoles ?? []),
        candidateConstraintsJson: JSON.stringify(input.candidateConstraints ?? []),
        submittedBy: input.submittedBy,
        supersedesIntakeId: supersededId,
        sourceQuickSessionId: input.sourceQuickSessionId ?? null,
        sourceBriefVersionId: input.sourceBriefVersionId ?? null,
        sourceQuickSessionHash: input.sourceQuickSessionHash ?? null,
        sourceBriefSnapshotHash: input.sourceBriefSnapshotHash ?? null,
        contentHash,
        createdAt: ts,
      })
      .returning()
      .get();

    return row;
  }

  /** Paginated list of intakes for a project, newest-version first. */
  listByProject(projectId: string, opts: ListIntakeOptions = {}): {
    items: ProjectIntake[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(projectIntakes.projectId, projectId)];

    if (cursor) {
      const c = decodeCursor<IntakeCursor>(cursor);
      conditions.push(
        or(
          lt(projectIntakes.intakeVersion, c.intakeVersion),
          and(
            eq(projectIntakes.intakeVersion, c.intakeVersion),
            lt(projectIntakes.id, c.id),
          ),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(projectIntakes)
      .where(and(...conditions))
      .orderBy(desc(projectIntakes.intakeVersion), desc(projectIntakes.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        intakeVersion: last.intakeVersion,
        id: last.id,
      });
    }

    return { items, nextCursor };
  }

  /** Return the highest-numbered intake for a project, or null. */
  findLatest(projectId: string): ProjectIntake | null {
    const row = this.db
      .select()
      .from(projectIntakes)
      .where(eq(projectIntakes.projectId, projectId))
      .orderBy(desc(projectIntakes.intakeVersion))
      .limit(1)
      .get();
    return row ?? null;
  }
}

/**
 * Compute a deterministic SHA-256 content hash over the intake payload.
 *
 * The hash covers the fields that define the semantic content of the intake;
 * it excludes bookkeeping fields (id, version, timestamps) so that identical
 * submissions yield the same hash.
 */
function computeContentHash(input: CreateIntakeInput): string {
  const payload = JSON.stringify({
    originalText: input.originalText,
    decisionIntent: input.decisionIntent ?? null,
    selectedWorkType: input.selectedWorkType ?? null,
    candidateRoles: input.candidateRoles ?? [],
    candidateConstraints: input.candidateConstraints ?? [],
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
