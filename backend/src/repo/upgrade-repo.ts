import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  upgradeRecords,
  briefVersions,
  type UpgradeRecord,
} from '../db/schema/quick';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now } from '../shared/time';

export interface CreateUpgradeInput {
  quickSessionId: string;
  projectId: string;
  /** Accepted for API symmetry; upgrade_records has no hash column. */
  briefSnapshotHash?: string;
}

export class UpgradeRepo {
  constructor(private db: DrizzleDB) {}

  /**
   * Record a successful upgrade from a quick session to a formal project.
   *
   * The latest brief version for the session is linked as `brief_version_id`
   * (required NOT NULL by schema). Status is set to `succeeded` with
   * `target_project_id` set, satisfying the schema's status-target XOR
   * constraint. The idempotency key is derived from the session id so that
   * only one upgrade record can exist per session.
   */
  create(input: CreateUpgradeInput): UpgradeRecord {
    const latestBrief = this.db
      .select()
      .from(briefVersions)
      .where(eq(briefVersions.quickSessionId, input.quickSessionId))
      .orderBy(desc(briefVersions.version))
      .limit(1)
      .get();

    if (!latestBrief) {
      throw ApiError.conflict(
        'NO_BRIEF_VERSION',
        'Cannot upgrade a session without at least one brief version',
      );
    }

    const ts = now();
    const row = this.db
      .insert(upgradeRecords)
      .values({
        id: generateId('up'),
        quickSessionId: input.quickSessionId,
        briefVersionId: latestBrief.id,
        targetProjectId: input.projectId,
        idempotencyKey: `upgrade-${input.quickSessionId}`,
        status: 'succeeded',
        startedAt: ts,
        completedAt: ts,
      })
      .returning()
      .get();

    return row;
  }

  /** Find the upgrade record for a session, or null. */
  findByQuickSession(quickSessionId: string): UpgradeRecord | null {
    const row = this.db
      .select()
      .from(upgradeRecords)
      .where(eq(upgradeRecords.quickSessionId, quickSessionId))
      .get();
    return row ?? null;
  }

  /** True when a succeeded upgrade record exists for the session. */
  hasUpgraded(quickSessionId: string): boolean {
    const row = this.db
      .select({ id: upgradeRecords.id })
      .from(upgradeRecords)
      .where(
        and(
          eq(upgradeRecords.quickSessionId, quickSessionId),
          eq(upgradeRecords.status, 'succeeded'),
        ),
      )
      .get();
    return row !== undefined;
  }
}
