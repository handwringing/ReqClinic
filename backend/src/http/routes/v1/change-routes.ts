import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { requireUser, requireProjectCapability } from '../../middleware/auth';
import { paginatedResponse } from '../../response';
import type { ChangeRepo } from '../../../repo/change-repo';
import type { BaselineRepo } from '../../../repo/baseline-repo';
import type { ChangePreview } from '../../../db/schema/change';
import type { Change } from '../../../db/schema/change';
import type { ChangeImpact } from '../../../db/schema/change';

/**
 * Change preview & real change routes (Task 28, 7 operationIds).
 *
 * Previews are isolated: they only ever read an approved baseline and write
 * `change_impacts` rows pointing at `preview_id`. Confirming a real change is
 * a single transaction that moves the project to `Changing`, promotes
 * candidate impacts to `accepted`, and creates one reopen task per distinct
 * required stage. A change already referenced by a baseline cannot be
 * withdrawn — only superseded by a corrective change.
 */

export interface ChangeRouteDeps {
  changeRepo: ChangeRepo;
  baselineRepo: BaselineRepo;
}

// ── mappers ─────────────────────────────────────────────────────────────────

function mapPreview(p: ChangePreview) {
  return {
    id: p.id,
    project_id: p.projectId,
    baseline_id: p.baselineId,
    status: p.status,
    created_by: p.createdBy,
    created_at: p.createdAt,
    expires_at: p.expiresAt,
  };
}

function mapImpact(i: ChangeImpact) {
  return {
    id: i.id,
    entity_type: i.entityType,
    entity_id: i.entityId,
    impact_type: i.impactType,
    severity: i.severity,
    recommended_action: i.recommendedAction,
    required_stage: i.requiredStage,
    rationale: i.rationale,
    status: i.status,
  };
}

function mapChange(c: Change) {
  return {
    id: c.id,
    project_id: c.projectId,
    source_id: c.sourceId,
    source_type: c.sourceType,
    description: c.description,
    trigger_type: c.triggerType,
    occurred_at: c.occurredAt,
    severity: c.severity,
    status: c.status,
    confirmed_by: c.confirmedBy,
    confirmed_at: c.confirmedAt,
    withdrawn_by: c.withdrawnBy,
    withdrawn_at: c.withdrawnAt,
    withdrawal_reason: c.withdrawalReason,
    supersedes_change_id: c.supersedesChangeId,
    version: c.version,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

// ── registration ───────────────────────────────────────────────────────────

export function registerChangeRoutes(
  registry: RouteRegistry,
  deps: ChangeRouteDeps,
): void {
  // 1. createChangePreview ─ POST /api/v1/projects/:id/change-previews ───────
  registry.register(
    'createChangePreview',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      const baselineId = body.baseline_id;
      if (typeof baselineId !== 'string' || !baselineId) {
        throw ApiError.validationError({ baseline_id: 'required string' });
      }
      const scenario = body.scenario;
      if (
        scenario === null ||
        typeof scenario !== 'object' ||
        Array.isArray(scenario)
      ) {
        throw ApiError.validationError({
          scenario: 'required object describing the hypothetical change',
        });
      }

      // The preview only reads the formal baseline; verify scope so a preview
      // cannot be seeded against another project's baseline.
      const baseline = deps.baselineRepo.findById(baselineId);
      if (!baseline || baseline.projectId !== ctx.params.id) {
        throw ApiError.notFound('Baseline not found for this project', 'baseline');
      }

      const preview = deps.changeRepo.createPreview({
        projectId: ctx.params.id,
        baselineId,
        scenario,
        createdBy: ctx.actor.userId!,
      });
      return mapPreview(preview);
    },
    { requireActor: 'user' },
  );

  // 2. getChangePreviewImpact ─ GET /api/v1/change-previews/:id/impact ───────
  registry.register(
    'getChangePreviewImpact',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const result = deps.changeRepo.getPreviewImpact(ctx.params.id);
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        result.preview.projectId,
        'read',
      );
      return {
        preview_id: result.preview.id,
        status: result.preview.status,
        impacts: result.impacts.map(mapImpact),
        unresolved_items: result.unresolvedItems,
        suggested_stages: result.suggestedStages,
        created_at: result.preview.createdAt,
        expires_at: result.preview.expiresAt,
      };
    },
    { requireActor: 'user' },
  );

  // 3. listChanges ─ GET /api/v1/projects/:id/changes ───────────────────────
  registry.register(
    'listChanges',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');

      const { items, nextCursor } = deps.changeRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        status: ctx.query.status,
      });
      return paginatedResponse(items.map(mapChange), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 4. createChange ─ POST /api/v1/projects/:id/changes ─────────────────────
  registry.register(
    'createChange',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      const sourceType = body.source_type;
      const description = body.description;
      const severity = body.severity;
      if (typeof sourceType !== 'string' || !sourceType) {
        throw ApiError.validationError({ source_type: 'required string' });
      }
      if (typeof description !== 'string' || !description) {
        throw ApiError.validationError({ description: 'required string' });
      }
      if (typeof severity !== 'string' || !SEVERITIES.has(severity)) {
        throw ApiError.validationError({
          severity: 'must be one of low|medium|high|critical',
        });
      }
      const triggerType =
        body.trigger_type === undefined || body.trigger_type === null
          ? null
          : typeof body.trigger_type === 'string'
            ? body.trigger_type
            : (throwInvalid('trigger_type', 'must be a string') as never);
      const occurredAt =
        body.occurred_at === undefined || body.occurred_at === null
          ? null
          : typeof body.occurred_at === 'string'
            ? body.occurred_at
            : (throwInvalid('occurred_at', 'must be an ISO 8601 string') as never);
      const sourceId =
        body.source_id === undefined || body.source_id === null
          ? null
          : typeof body.source_id === 'string'
            ? body.source_id
            : (throwInvalid('source_id', 'must be a string') as never);

      const change = deps.changeRepo.create({
        projectId: ctx.params.id,
        sourceType,
        description,
        triggerType,
        occurredAt,
        severity: severity as 'low' | 'medium' | 'high' | 'critical',
        sourceId,
      });
      return mapChange(change);
    },
    { requireActor: 'user' },
  );

  // 5. getChangeImpact ─ GET /api/v1/changes/:id/impact ─────────────────────
  registry.register(
    'getChangeImpact',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const result = deps.changeRepo.getImpact(ctx.params.id);
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        result.change.projectId,
        'read',
      );
      return {
        change_id: result.change.id,
        status: result.change.status,
        impacts: result.impacts.map(mapImpact),
        suggested_stages: result.suggestedStages,
        created_at: result.change.createdAt,
      };
    },
    { requireActor: 'user' },
  );

  // 6. confirmChange ─ POST /api/v1/changes/:id/confirm ─────────────────────
  registry.register(
    'confirmChange',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      // Resolve the change first to scope the capability check.
      const existing = deps.changeRepo.findById(ctx.params.id);
      if (!existing) {
        throw ApiError.notFound('Change not found', 'change');
      }
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        existing.projectId,
        'edit',
      );
      const body = ctx.body ?? {};
      if (
        typeof body.expected_version !== 'number' ||
        !Number.isInteger(body.expected_version)
      ) {
        throw ApiError.validationError({
          expected_version: 'required integer',
        });
      }

      const result = deps.changeRepo.confirm(
        ctx.params.id,
        ctx.actor.userId!,
        body.expected_version,
      );
      // OpenAPI declares 200 (not 201): the change already existed, confirm is
      // a state transition rather than a creation.
      return {
        data: {
          id: result.change.id,
          project_id: result.change.projectId,
          status: result.change.status,
          confirmed_by: result.change.confirmedBy,
          confirmed_at: result.change.confirmedAt,
          project_status: result.projectStatus,
          reopened_stages: result.reopenedStages,
          reopen_tasks: result.reopenTasks,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { requireActor: 'user' },
  );

  // 7. withdrawChange ─ POST /api/v1/changes/:id/withdraw ───────────────────
  registry.register(
    'withdrawChange',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const existing = deps.changeRepo.findById(ctx.params.id);
      if (!existing) {
        throw ApiError.notFound('Change not found', 'change');
      }
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        existing.projectId,
        'edit',
      );
      const body = ctx.body ?? {};
      const reason = body.reason;
      if (typeof reason !== 'string' || !reason.trim()) {
        throw ApiError.validationError({ reason: 'required non-empty string' });
      }
      if (
        body.expected_version !== undefined &&
        (typeof body.expected_version !== 'number' ||
          !Number.isInteger(body.expected_version))
      ) {
        throw ApiError.validationError({
          expected_version: 'must be an integer when provided',
        });
      }

      const withdrawn = deps.changeRepo.withdraw(
        ctx.params.id,
        ctx.actor.userId!,
        reason,
        body.expected_version,
      );
      // OpenAPI declares 200 (not 201).
      return {
        data: {
          id: withdrawn.id,
          project_id: withdrawn.projectId,
          status: withdrawn.status,
          withdrawn_by: withdrawn.withdrawnBy,
          withdrawn_at: withdrawn.withdrawnAt,
          withdrawal_reason: withdrawn.withdrawalReason,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { requireActor: 'user' },
  );
}

/** Throw a validation error for a malformed field, used in inline ternaries. */
function throwInvalid(field: string, message: string): never {
  throw ApiError.validationError({ [field]: message });
}
