import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { projects, projectMembers, type Project } from '../db/schema/project';
import { deleteTasks } from '../db/schema/lifecycle';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';
import type { Actor } from './quick-session-repo';

export const PROJECT_STATUS = {
  DRAFT: 'Draft',
  INGESTING: 'Ingesting',
  ELICITING: 'Eliciting',
  REVIEWING: 'Reviewing',
  BASELINED: 'Baselined',
  REPORTING: 'Reporting',
  RELEASED: 'Released',
  CHANGING: 'Changing',
  ARCHIVED: 'Archived',
} as const;

export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];

/** Allowed forward transitions in the project state machine. */
const PROJECT_TRANSITIONS: Record<string, Set<string>> = {
  Draft: new Set(['Ingesting', 'Archived']),
  Ingesting: new Set(['Eliciting', 'Archived']),
  Eliciting: new Set(['Reviewing', 'Archived']),
  Reviewing: new Set(['Baselined', 'Archived']),
  Baselined: new Set(['Reporting', 'Archived']),
  Reporting: new Set(['Released', 'Archived']),
  Released: new Set(['Changing', 'Archived']),
  Changing: new Set(['Released', 'Baselined', 'Archived']),
  Archived: new Set(),
};

/** Capabilities granted to the project Owner on creation. */
const OWNER_CAPABILITIES = ['read', 'edit', 'review', 'export', 'manage_members'];

export interface CreateProjectInput {
  ownerId: string;
  name?: string;
  description?: string;
  language?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: string;
  riskLevel?: string;
  expectedVersion?: number;
}

export interface ListProjectOptions {
  limit?: number;
  cursor?: string;
}

interface ProjectCursor {
  updatedAt: string;
  id: string;
}

export class ProjectRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Create a project in `Draft` status and insert the Owner member in the same
   * transaction.
   */
  create(input: CreateProjectInput): Project {
    const id = generateId('prj');
    const ts = now();

    return this.db.transaction((tx) => {
      const project = tx
        .insert(projects)
        .values({
          id,
          ownerId: input.ownerId,
          createdBy: input.ownerId,
          name: input.name ?? null,
          description: input.description ?? null,
          status: PROJECT_STATUS.DRAFT,
          riskLevel: 'unknown',
          language: input.language ?? 'zh-CN',
          version: 1,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning()
        .get();

      tx.insert(projectMembers)
        .values({
          projectId: id,
          userId: input.ownerId,
          capabilitiesJson: JSON.stringify(OWNER_CAPABILITIES),
          status: 'active',
          grantedBy: input.ownerId,
          createdAt: ts,
          updatedAt: ts,
          version: 1,
        })
        .run();

      return project;
    });
  }

  /** Find a project by id, or null. */
  findById(id: string): Project | null {
    const row = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .get();
    return row ?? null;
  }

  /**
   * Update project fields with optimistic-concurrency check.
   *
   * On success, `version` is incremented and `updated_at` is touched.
   */
  update(id: string, input: UpdateProjectInput): Project {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Project not found', 'project');
    }
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw ApiError.versionConflict();
    }

    const patch: Partial<typeof projects.$inferInsert> = {
      version: current.version + 1,
      updatedAt: now(),
    };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.riskLevel !== undefined) patch.riskLevel = input.riskLevel;

    const updated = this.db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, id))
      .returning()
      .get();

    return updated;
  }

  /**
   * Soft-delete by creating a `delete_task` record. The project row itself is
   * not physically removed.
   */
  softDelete(id: string, actor: Actor): void {
    const project = this.findById(id);
    if (!project) {
      throw ApiError.notFound('Project not found', 'project');
    }
    const ts = now();
    this.db
      .insert(deleteTasks)
      .values({
        id: generateId('dt'),
        scope: 'formal_project',
        targetId: id,
        requesterType: actor.kind,
        requesterId: actor.id,
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }

  /** Paginated list of projects owned by a user, newest-updated first. */
  listByOwner(userId: string, opts: ListProjectOptions = {}): {
    items: Project[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(projects.ownerId, userId)];

    if (cursor) {
      const c = decodeCursor<ProjectCursor>(cursor);
      conditions.push(
        or(
          lt(projects.updatedAt, c.updatedAt),
          and(
            eq(projects.updatedAt, c.updatedAt),
            lt(projects.id, c.id),
          ),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.updatedAt), desc(projects.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        updatedAt: last.updatedAt,
        id: last.id,
      });
    }

    return { items, nextCursor };
  }

  /**
   * Transition the project status with optional optimistic-concurrency check.
   */
  updateStatus(id: string, status: string, expectedVersion?: number): Project {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Project not found', 'project');
    }
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw ApiError.versionConflict();
    }
    const allowed = PROJECT_TRANSITIONS[current.status];
    if (!allowed || !allowed.has(status)) {
      throw ApiError.conflict(
        'INVALID_TRANSITION',
        `Cannot transition from '${current.status}' to '${status}'`,
      );
    }

    const patch: Partial<typeof projects.$inferInsert> = {
      status,
      version: current.version + 1,
      updatedAt: now(),
    };
    if (status === PROJECT_STATUS.ARCHIVED) {
      patch.archivedAt = now();
    }

    const updated = this.db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, id))
      .returning()
      .get();

    return updated;
  }
}
