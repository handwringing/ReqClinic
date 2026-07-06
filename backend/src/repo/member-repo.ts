import { eq, and, lt, or, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import { projectMembers, type ProjectMember } from '../db/schema/project';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';
import { encodeCursor, decodeCursor, parsePagination } from '../shared/pagination';

export interface AddMemberInput {
  projectId: string;
  userId: string;
  capabilities: string[];
  grantedBy: string;
}

export interface UpdateMemberInput {
  capabilities?: string[];
  status?: string;
  expectedVersion?: number;
}

export interface ListMemberOptions {
  limit?: number;
  cursor?: string;
}

interface MemberCursor {
  createdAt: string;
  userId: string;
}

export class MemberRepo {
  constructor(private db: DrizzleDB) {}

  /** Paginated list of members for a project, oldest-first. */
  listByProject(projectId: string, opts: ListMemberOptions = {}): {
    items: ProjectMember[];
    nextCursor: string | null;
  } {
    const { limit, cursor } = parsePagination({
      limit: opts.limit ?? 50,
      cursor: opts.cursor,
    });

    const conditions = [eq(projectMembers.projectId, projectId)];

    if (cursor) {
      const c = decodeCursor<MemberCursor>(cursor);
      conditions.push(
        or(
          lt(projectMembers.createdAt, c.createdAt),
          and(
            eq(projectMembers.createdAt, c.createdAt),
            lt(projectMembers.userId, c.userId),
          ),
        )!,
      );
    }

    const items = this.db
      .select()
      .from(projectMembers)
      .where(and(...conditions))
      .orderBy(desc(projectMembers.createdAt), desc(projectMembers.userId))
      .limit(limit)
      .all()
      .reverse();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        createdAt: last.createdAt,
        userId: last.userId,
      });
    }

    return { items, nextCursor };
  }

  /** Add a member to a project. */
  add(input: AddMemberInput): ProjectMember {
    const ts = now();
    const row = this.db
      .insert(projectMembers)
      .values({
        projectId: input.projectId,
        userId: input.userId,
        capabilitiesJson: JSON.stringify(input.capabilities),
        status: 'active',
        grantedBy: input.grantedBy,
        createdAt: ts,
        updatedAt: ts,
        version: 1,
      })
      .returning()
      .get();

    return row;
  }

  /**
   * Update a member's capabilities or status with optimistic-concurrency
   * check.
   */
  update(projectId: string, userId: string, input: UpdateMemberInput): ProjectMember {
    const current = this.findMember(projectId, userId);
    if (!current) {
      throw ApiError.notFound('Project member not found', 'project_member');
    }
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw ApiError.versionConflict();
    }

    const patch: Partial<typeof projectMembers.$inferInsert> = {
      version: current.version + 1,
      updatedAt: now(),
    };
    if (input.capabilities !== undefined) {
      patch.capabilitiesJson = JSON.stringify(input.capabilities);
    }
    if (input.status !== undefined) {
      patch.status = input.status;
    }

    const updated = this.db
      .update(projectMembers)
      .set(patch)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .returning()
      .get();

    return updated;
  }

  /** Find a member by project + user, or null. */
  findMember(projectId: string, userId: string): ProjectMember | null {
    const row = this.db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .get();
    return row ?? null;
  }

  /** True when the user is an active member with the given capability. */
  hasCapability(projectId: string, userId: string, capability: string): boolean {
    const member = this.findMember(projectId, userId);
    if (!member || member.status !== 'active') return false;
    try {
      const caps = JSON.parse(member.capabilitiesJson) as string[];
      return Array.isArray(caps) && caps.includes(capability);
    } catch {
      return false;
    }
  }
}
