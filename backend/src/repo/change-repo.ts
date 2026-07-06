import { eq, and, desc, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../db/client';
import {
  changePreviews,
  changes,
  changeImpacts,
  type ChangePreview,
  type Change,
  type ChangeImpact,
} from '../db/schema/change';
import { projects } from '../db/schema/project';
import { tasks } from '../db/schema/review';
import { ApiError } from '../http/errors';
import { generateId } from '../shared/id';
import { now, addDays } from '../shared/time';

/**
 * Repository for change previews, real changes & impacts (§8, §11).
 *
 * Previews are isolated: they only ever read an approved baseline and write
 * `change_impacts` rows pointing at `preview_id`. They never mutate formal
 * entities, baselines or released reports, and never transition the project.
 *
 * Confirming a real change is a single transaction: the change record moves to
 * `confirmed`, candidate impacts are promoted to `accepted`, the project moves
 * to `Changing` (when not already there), and one reopen task is created per
 * distinct `required_stage`. A change already referenced by a baseline cannot
 * be withdrawn — only superseded by a corrective change.
 */

const PREVIEW_TTL_DAYS = 7;

/** Stage → which entity types are relevant for reopening. */
const STAGE_BY_ENTITY_TYPE: Record<string, string> = {
  outcome: 'outcome',
  requirement: 'scope',
  driver: 'scope',
  decision: 'scope',
  conflict: 'scope',
  acceptance: 'scope',
  evidence: 'scope',
  stakeholder: 'interview',
};

export interface CreatePreviewInput {
  projectId: string;
  baselineId: string;
  scenario: unknown;
  createdBy: string;
}

export interface CreateChangeInput {
  projectId: string;
  sourceType: string;
  description: string;
  triggerType?: string | null;
  occurredAt?: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sourceId?: string | null;
}

export interface ListChangeOptions {
  limit?: number;
  cursor?: string;
  status?: string;
}

export interface ConfirmResult {
  change: Change;
  projectStatus: string;
  reopenedStages: string[];
  reopenTasks: Array<{ task_id: string; stage: string; reason: string }>;
}

interface ChangeCursor {
  createdAt: string;
  id: string;
}

export class ChangeRepo {
  constructor(private db: DrizzleDB) {}

  // ── Previews ──────────────────────────────────────────────────────────────

  /**
   * Create an isolated change preview. Candidate impacts are derived from the
   * scenario's `affected_entities`; the preview ends in `ready` status. Formal
   * data is untouched.
   */
  createPreview(input: CreatePreviewInput): ChangePreview {
    const ts = now();
    const id = generateId('cpv');
    const scenarioJson = JSON.stringify(input.scenario ?? {});

    return this.db.transaction((tx) => {
      const preview = tx
        .insert(changePreviews)
        .values({
          id,
          projectId: input.projectId,
          baselineId: input.baselineId,
          scenarioJson,
          status: 'ready',
          createdBy: input.createdBy,
          createdAt: ts,
          expiresAt: addDays(ts, PREVIEW_TTL_DAYS),
        })
        .returning()
        .get();

      const scenario = (input.scenario ?? {}) as {
        type?: string;
        description?: string;
        affected_entities?: Array<{ entity_type: string; entity_id: string }>;
      };
      const affected = Array.isArray(scenario.affected_entities)
        ? scenario.affected_entities
        : [];
      const description = scenario.description ?? 'change preview';
      const scenarioType = scenario.type ?? 'modification';

      for (const e of affected) {
        const stage = STAGE_BY_ENTITY_TYPE[e.entity_type] ?? 'scope';
        tx.insert(changeImpacts)
          .values({
            id: generateId('cim'),
            changeId: null,
            previewId: id,
            entityType: e.entity_type,
            entityId: e.entity_id,
            impactType: scenarioType,
            severity: 'medium',
            recommendedAction: `重新评估受影响的 ${e.entity_type}`,
            requiredStage: stage,
            rationale: description,
            status: 'candidate',
          })
          .run();
      }

      return preview;
    });
  }

  /** Find a preview by id, or null. */
  findPreview(id: string): ChangePreview | null {
    const row = this.db
      .select()
      .from(changePreviews)
      .where(eq(changePreviews.id, id))
      .get();
    return row ?? null;
  }

  /** Preview impacts + computed unresolved items and suggested stages. */
  getPreviewImpact(previewId: string): {
    preview: ChangePreview;
    impacts: ChangeImpact[];
    unresolvedItems: Array<{ type: string; description: string }>;
    suggestedStages: string[];
  } {
    const preview = this.findPreview(previewId);
    if (!preview) {
      throw ApiError.notFound('Change preview not found', 'change_preview');
    }
    const impacts = this.db
      .select()
      .from(changeImpacts)
      .where(eq(changeImpacts.previewId, previewId))
      .all();

    const scenario = JSON.parse(preview.scenarioJson) as {
      unknowns?: Array<{ type: string; description: string }>;
    };
    const unresolvedItems = Array.isArray(scenario.unknowns)
      ? scenario.unknowns
      : [];
    const suggestedStages = distinctStages(impacts);

    return { preview, impacts, unresolvedItems, suggestedStages };
  }

  // ── Real changes ──────────────────────────────────────────────────────────

  /** Find a change by id, or null. */
  findById(id: string): Change | null {
    const row = this.db
      .select()
      .from(changes)
      .where(eq(changes.id, id))
      .get();
    return row ?? null;
  }

  /** Paginated list of real changes for a project, newest-first. */
  listByProject(projectId: string, opts: ListChangeOptions = {}): {
    items: Change[];
    nextCursor: string | null;
  } {
    const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 50)));
    const conditions = [eq(changes.projectId, projectId)];
    if (opts.status) {
      conditions.push(eq(changes.status, opts.status));
    }
    if (opts.cursor) {
      const c = JSON.parse(
        Buffer.from(opts.cursor, 'base64url').toString('utf8'),
      ) as ChangeCursor;
      conditions.push(
        sql`(${changes.createdAt} < ${c.createdAt} OR (${changes.createdAt} = ${c.createdAt} AND ${changes.id} < ${c.id}))`,
      );
    }

    const items = this.db
      .select()
      .from(changes)
      .where(and(...conditions))
      .orderBy(desc(changes.createdAt), desc(changes.id))
      .limit(limit)
      .all();

    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: last.createdAt, id: last.id }),
        'utf8',
      ).toString('base64url');
    }
    return { items, nextCursor };
  }

  /** Register a real change in `draft` status. Does not create impacts. */
  create(input: CreateChangeInput): Change {
    const ts = now();
    const id = generateId('chg');
    return this.db
      .insert(changes)
      .values({
        id,
        projectId: input.projectId,
        sourceId: input.sourceId ?? null,
        sourceType: input.sourceType,
        description: input.description,
        triggerType: input.triggerType ?? null,
        occurredAt: input.occurredAt ?? null,
        severity: input.severity,
        status: 'draft',
        confirmedBy: null,
        confirmedAt: null,
        withdrawnBy: null,
        withdrawnAt: null,
        withdrawalReason: null,
        supersedesChangeId: null,
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .get();
  }

  /**
   * Return a change's impacts, lazily generating candidate impacts from the
   * change's severity when none exist yet (Stage B stands in for async impact
   * analysis). Also returns the computed suggested-stages set.
   */
  getImpact(changeId: string): {
    change: Change;
    impacts: ChangeImpact[];
    suggestedStages: string[];
  } {
    const change = this.findById(changeId);
    if (!change) {
      throw ApiError.notFound('Change not found', 'change');
    }

    let impacts = this.db
      .select()
      .from(changeImpacts)
      .where(eq(changeImpacts.changeId, changeId))
      .all();

    if (impacts.length === 0) {
      this.generateCandidateImpacts(change);
      impacts = this.db
        .select()
        .from(changeImpacts)
        .where(eq(changeImpacts.changeId, changeId))
        .all();
    }

    return { change, impacts, suggestedStages: distinctStages(impacts) };
  }

  /**
   * Confirm a change in one transaction:
   *   1. change → `confirmed` (version bump, confirmer + time)
   *   2. candidate impacts → `accepted`
   *   3. project → `Changing` (when not already there)
   *   4. one reopen task per distinct `required_stage`
   *
   * `expectedVersion` must match `changes.version`.
   */
  confirm(
    id: string,
    confirmerId: string,
    expectedVersion?: number,
  ): ConfirmResult {
    return this.db.transaction((tx) => {
      const current = tx
        .select()
        .from(changes)
        .where(eq(changes.id, id))
        .get();
      if (!current) {
        throw ApiError.notFound('Change not found', 'change');
      }
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw ApiError.versionConflict();
      }
      if (current.status === 'confirmed') {
        throw ApiError.conflict(
          'CHANGE_ALREADY_CONFIRMED',
          'Change has already been confirmed',
        );
      }
      if (current.status === 'withdrawn' || current.status === 'superseded' || current.status === 'baselined') {
        throw ApiError.conflict(
          'INVALID_CHANGE_STATUS',
          `Cannot confirm change in status '${current.status}'`,
        );
      }

      const ts = now();

      // Ensure candidate impacts exist (lazy analysis), then promote to accepted.
      let impacts = tx
        .select()
        .from(changeImpacts)
        .where(eq(changeImpacts.changeId, id))
        .all();
      if (impacts.length === 0) {
        this.generateCandidateImpactsTx(tx, current);
        impacts = tx
          .select()
          .from(changeImpacts)
          .where(eq(changeImpacts.changeId, id))
          .all();
      }
      for (const imp of impacts) {
        tx.update(changeImpacts)
          .set({ status: 'accepted' })
          .where(eq(changeImpacts.id, imp.id))
          .run();
      }

      // Transition the project to `Changing` (allowed from `Released`; no-op
      // when already `Changing`).
      const project = tx
        .select()
        .from(projects)
        .where(eq(projects.id, current.projectId))
        .get();
      if (!project) {
        throw ApiError.notFound('Project not found', 'project');
      }
      let projectStatus = project.status;
      if (project.status === 'Released') {
        tx.update(projects)
          .set({ status: 'Changing', version: project.version + 1, updatedAt: ts })
          .where(eq(projects.id, project.id))
          .run();
        projectStatus = 'Changing';
      } else if (project.status !== 'Changing') {
        throw ApiError.conflict(
          'INVALID_TRANSITION',
          `Cannot transition project from '${project.status}' to 'Changing'`,
        );
      }

      // Update the change row.
      const updated = tx
        .update(changes)
        .set({
          status: 'confirmed',
          confirmedBy: confirmerId,
          confirmedAt: ts,
          version: current.version + 1,
          updatedAt: ts,
        })
        .where(eq(changes.id, id))
        .returning()
        .get();

      // Create one reopen task per distinct required_stage.
      const stageReasons = new Map<string, string>();
      for (const imp of impacts) {
        const stage = imp.requiredStage ?? 'scope';
        if (!stageReasons.has(stage)) {
          stageReasons.set(stage, imp.rationale);
        }
      }
      const priority =
        current.severity === 'critical'
          ? 'blocking'
          : current.severity === 'high'
            ? 'high'
            : 'normal';

      const reopenTasks: ConfirmResult['reopenTasks'] = [];
      for (const [stage, reason] of stageReasons) {
        const taskId = generateId('tsk');
        tx.insert(tasks)
          .values({
            id: taskId,
            projectId: current.projectId,
            entityType: 'stage_reopen',
            entityId: stage,
            assigneeId: confirmerId,
            dueAt: null,
            status: 'pending',
            priority,
            createdBy: confirmerId,
            createdAt: ts,
            updatedAt: ts,
            completedAt: null,
            version: 1,
          })
          .run();
        reopenTasks.push({ task_id: taskId, stage, reason });
      }

      return {
        change: updated,
        projectStatus,
        reopenedStages: Array.from(stageReasons.keys()),
        reopenTasks,
      };
    });
  }

  /**
   * Withdraw a change that has not yet been baselined. A baselined or
   * superseded change cannot be withdrawn (409) — only superseded by a
   * corrective change.
   */
  withdraw(
    id: string,
    withdrawerId: string,
    reason: string,
    expectedVersion?: number,
  ): Change {
    const current = this.findById(id);
    if (!current) {
      throw ApiError.notFound('Change not found', 'change');
    }
    if (current.status === 'baselined' || current.status === 'superseded') {
      throw ApiError.conflict(
        'CHANGE_BASELINED',
        'Change is already referenced by a baseline and cannot be withdrawn; create a corrective change instead',
      );
    }
    if (current.status === 'withdrawn') {
      throw ApiError.conflict(
        'CHANGE_ALREADY_WITHDRAWN',
        'Change has already been withdrawn',
      );
    }
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw ApiError.versionConflict();
    }
    const ts = now();
    return this.db
      .update(changes)
      .set({
        status: 'withdrawn',
        withdrawnBy: withdrawerId,
        withdrawnAt: ts,
        withdrawalReason: reason,
        version: current.version + 1,
        updatedAt: ts,
      })
      .where(eq(changes.id, id))
      .returning()
      .get();
  }

  // ── Impact generation (Stage B stands in for async analysis) ─────────────

  /**
   * Deterministically derive candidate impacts from a real change's severity.
   * Always creates at least one scope impact; high/critical changes also
   * reopen the outcome stage. Idempotent — guarded by the caller.
   */
  private generateCandidateImpacts(change: Change): void {
    this.generateCandidateImpactsTx(this.db, change);
  }

  private generateCandidateImpactsTx(
    tx: DrizzleDB | Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
    change: Change,
  ): void {
    const impacts: Array<{
      entityType: string;
      entityId: string;
      impactType: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      requiredStage: string;
      rationale: string;
    }> = [
      {
        entityType: 'requirement',
        entityId: `${change.id}::requirement`,
        impactType: 'new_requirement',
        severity: change.severity as 'low' | 'medium' | 'high' | 'critical',
        requiredStage: 'scope',
        rationale: change.description,
      },
    ];
    if (change.severity === 'high' || change.severity === 'critical') {
      impacts.push({
        entityType: 'outcome',
        entityId: `${change.id}::outcome`,
        impactType: 'modification',
        severity: 'medium',
        requiredStage: 'outcome',
        rationale: `变化影响成果定义：${change.description}`,
      });
    }

    for (const imp of impacts) {
      tx.insert(changeImpacts)
        .values({
          id: generateId('cim'),
          changeId: change.id,
          previewId: null,
          entityType: imp.entityType,
          entityId: imp.entityId,
          impactType: imp.impactType,
          severity: imp.severity,
          recommendedAction: `重新评估受影响的 ${imp.entityType}`,
          requiredStage: imp.requiredStage,
          rationale: imp.rationale,
          status: 'candidate',
        })
        .run();
    }
  }
}

/** Distinct, ordered list of `required_stage` values from a set of impacts. */
function distinctStages(impacts: ChangeImpact[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const imp of impacts) {
    const stage = imp.requiredStage ?? 'scope';
    if (!seen.has(stage)) {
      seen.add(stage);
      out.push(stage);
    }
  }
  return out;
}
