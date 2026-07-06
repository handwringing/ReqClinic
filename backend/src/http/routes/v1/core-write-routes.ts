import { eq } from 'drizzle-orm';
import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { requireUser, requireProjectCapability } from '../../middleware/auth';
import { requirements } from '../../../db/schema/core';
import type { DriverRepo } from '../../../repo/driver-repo';
import type { OutcomeRepo } from '../../../repo/outcome-repo';
import type { RequirementRepo } from '../../../repo/requirement-repo';
import type { AcceptanceRepo } from '../../../repo/acceptance-repo';
import type { VerificationRepo } from '../../../repo/verification-repo';
import type { ScenarioRepo } from '../../../repo/scenario-repo';
import type { ConflictRepo } from '../../../repo/conflict-repo';
import type { ReviewRepo, ReviewGateType } from '../../../repo/review-repo';
import type { ProjectRepo } from '../../../repo/project-repo';
import {
  mapDriver,
  mapOutcome,
  mapRequirement,
  mapAcceptance,
  mapScenario,
} from './core-query-routes';

/**
 * Core requirements-engineering write & review routes (Task 25, 13 operationIds).
 *
 * Write commands (create/update) require the `edit` capability; typed reviews
 * and gate reviews require the `review` capability. Every entity-mutating write
 * is guarded by `expected_version` optimistic concurrency. The three human gates
 * (scope / outcome / evidence_conflict) drive the project state machine and may
 * never be approved by an AI actor — `requireUser` enforces that only a real
 * `actor.kind === 'user'` can reach the gate handler.
 */

export interface CoreWriteRouteDeps {
  driverRepo: DriverRepo;
  outcomeRepo: OutcomeRepo;
  requirementRepo: RequirementRepo;
  acceptanceRepo: AcceptanceRepo;
  verificationRepo: VerificationRepo;
  scenarioRepo: ScenarioRepo;
  conflictRepo: ConflictRepo;
  reviewRepo: ReviewRepo;
  projectRepo: ProjectRepo;
}

// ── Gate → project-state-transition map ─────────────────────────────────────
//
// The OpenAPI spec gate enum is `outcome | evidence_conflict | scope`. Each
// gate, when accepted, advances the project one phase:
//   scope            : Ingesting  → Eliciting
//   outcome          : Eliciting  → Reviewing
//   evidence_conflict: Reviewing  → Baselined

const GATE_TRANSITIONS: Record<ReviewGateType, { source: string; target: string }> = {
  scope: { source: 'Ingesting', target: 'Eliciting' },
  outcome: { source: 'Eliciting', target: 'Reviewing' },
  evidence_conflict: { source: 'Reviewing', target: 'Baselined' },
};

const VALID_REVIEW_ACTIONS = new Set(['accept', 'modify', 'reject', 'uncertain']);

// ── Response mappers specific to write routes ───────────────────────────────

function mapVerification(v: {
  id: string; projectId: string; requirementId: string; acceptanceCriterionId: string | null;
  artifactType: string; description: string | null; sourceId: string | null;
  artifactPath: string | null; result: string | null; executedAt: string | null;
  verifiedBy: string | null; status: string; createdAt: string;
}) {
  return {
    id: v.id,
    project_id: v.projectId,
    requirement_id: v.requirementId,
    acceptance_criterion_id: v.acceptanceCriterionId,
    artifact_type: v.artifactType,
    description: v.description,
    source_id: v.sourceId,
    artifact_path: v.artifactPath,
    result: v.result,
    executed_at: v.executedAt,
    verified_by: v.verifiedBy,
    status: v.status,
    created_at: v.createdAt,
  };
}

function mapReviewAction(r: {
  id: string; projectId: string; gate: string | null; entityType: string;
  entityId: string; entityVersion: number; action: string; beforeValue: string | null;
  afterValue: string | null; reviewerId: string; reason: string; followUpJson: string | null;
  createdAt: string;
}) {
  return {
    id: r.id,
    project_id: r.projectId,
    gate: r.gate,
    entity_type: r.entityType,
    entity_id: r.entityId,
    entity_version: r.entityVersion,
    action: r.action,
    reviewer_id: r.reviewerId,
    reason: r.reason,
    before_value: r.beforeValue ? JSON.parse(r.beforeValue) : null,
    after_value: r.afterValue ? JSON.parse(r.afterValue) : null,
    follow_up: r.followUpJson ? JSON.parse(r.followUpJson) : null,
    created_at: r.createdAt,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Require an integer `expected_version` field on the body. */
function requireExpectedVersion(body: any): number {
  if (typeof body.expected_version !== 'number' || !Number.isInteger(body.expected_version)) {
    throw ApiError.validationError({ expected_version: 'required integer' });
  }
  return body.expected_version;
}

/** Resolve a requirement id → its project id (for capability checks). */
function resolveRequirementProject(ctx: RouteContext, requirementId: string): string {
  const row = ctx.db.db
    .select({ id: requirements.id, projectId: requirements.projectId })
    .from(requirements)
    .where(eq(requirements.id, requirementId))
    .get();
  if (!row) throw ApiError.notFound('Requirement not found', 'requirement');
  return row.projectId;
}

/** Validate + normalise a review action body. */
function parseReviewBody(body: any): {
  action: string;
  entityVersion: number;
  reason: string;
  afterValue?: unknown;
  followUp?: unknown;
} {
  if (typeof body.action !== 'string' || !VALID_REVIEW_ACTIONS.has(body.action)) {
    throw ApiError.validationError({
      action: 'must be one of accept, modify, reject, uncertain',
    });
  }
  if (typeof body.entity_version !== 'number' || !Number.isInteger(body.entity_version)) {
    throw ApiError.validationError({ entity_version: 'required integer' });
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    throw ApiError.validationError({ reason: 'required non-empty string' });
  }
  return {
    action: body.action,
    entityVersion: body.entity_version,
    reason: body.reason,
    afterValue: body.after_value,
    followUp: body.follow_up,
  };
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerCoreWriteRoutes(
  registry: RouteRegistry,
  deps: CoreWriteRouteDeps,
): void {
  // 1. createDriver — POST /projects/{id}/drivers ────────────────────────────
  registry.register(
    'createDriver',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      if (typeof body.driver_type !== 'string' || body.driver_type.length === 0) {
        throw ApiError.validationError({ driver_type: 'required string' });
      }
      if (typeof body.statement !== 'string' || body.statement.trim().length === 0) {
        throw ApiError.validationError({ statement: 'required non-empty string' });
      }
      const driver = deps.driverRepo.create({
        projectId: ctx.params.id,
        driverType: body.driver_type,
        statement: body.statement,
        ownerId: typeof body.owner_id === 'string' ? body.owner_id : undefined,
      });
      return mapDriver(driver);
    },
    { requireActor: 'user' },
  );

  // 2. updateDriver — PATCH /drivers/{id} ────────────────────────────────────
  registry.register(
    'updateDriver',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const driver = deps.driverRepo.findById(ctx.params.id);
      if (!driver) throw ApiError.notFound('Driver not found', 'driver');
      await requireProjectCapability(ctx.actor, ctx.db.db, driver.projectId, 'edit');
      const body = ctx.body ?? {};
      const expectedVersion = requireExpectedVersion(body);
      const updated = deps.driverRepo.update(ctx.params.id, {
        statement: typeof body.statement === 'string' ? body.statement : undefined,
        ownerId: typeof body.owner_id === 'string' ? body.owner_id : undefined,
        status: typeof body.status === 'string' ? body.status : undefined,
        expectedVersion,
      });
      return mapDriver(updated);
    },
    { requireActor: 'user' },
  );

  // 3. updateOutcome — PATCH /outcomes/{id} ──────────────────────────────────
  registry.register(
    'updateOutcome',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const outcome = deps.outcomeRepo.findById(ctx.params.id);
      if (!outcome) throw ApiError.notFound('Outcome not found', 'outcome');
      await requireProjectCapability(ctx.actor, ctx.db.db, outcome.projectId, 'edit');
      const body = ctx.body ?? {};
      const expectedVersion = requireExpectedVersion(body);
      const updated = deps.outcomeRepo.update(ctx.params.id, {
        description: typeof body.description === 'string' ? body.description : undefined,
        successMetric: typeof body.success_metric === 'string' ? body.success_metric : undefined,
        baselineValue: typeof body.baseline_value === 'string' ? body.baseline_value : undefined,
        targetValue: typeof body.target_value === 'string' ? body.target_value : undefined,
        unit: typeof body.unit === 'string' ? body.unit : undefined,
        failureCondition:
          typeof body.failure_condition === 'string' ? body.failure_condition : undefined,
        horizon: typeof body.horizon === 'string' ? body.horizon : undefined,
        ownerId: typeof body.owner_id === 'string' ? body.owner_id : undefined,
        expectedVersion,
      });
      return mapOutcome(updated);
    },
    { requireActor: 'user' },
  );

  // 4. updateRequirement — PATCH /requirements/{id} ──────────────────────────
  registry.register(
    'updateRequirement',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const requirement = deps.requirementRepo.findById(ctx.params.id);
      if (!requirement) throw ApiError.notFound('Requirement not found', 'requirement');
      await requireProjectCapability(ctx.actor, ctx.db.db, requirement.projectId, 'edit');
      const body = ctx.body ?? {};
      const expectedVersion = requireExpectedVersion(body);
      const updated = deps.requirementRepo.update(ctx.params.id, {
        title: typeof body.title === 'string' ? body.title : undefined,
        statement: typeof body.statement === 'string' ? body.statement : undefined,
        requirementType:
          typeof body.requirement_type === 'string' ? body.requirement_type : undefined,
        provenance: typeof body.provenance === 'string' ? body.provenance : undefined,
        horizon: typeof body.horizon === 'string' ? body.horizon : undefined,
        scopeDisposition:
          typeof body.scope_disposition === 'string' ? body.scope_disposition : undefined,
        commitment: typeof body.commitment === 'string' ? body.commitment : undefined,
        stability: typeof body.stability === 'string' ? body.stability : undefined,
        priority: typeof body.priority === 'string' ? body.priority : undefined,
        ownerId: typeof body.owner_id === 'string' ? body.owner_id : undefined,
        rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
        expectedVersion,
      });
      return mapRequirement(updated);
    },
    { requireActor: 'user' },
  );

  // 5. createAcceptanceCriterion — POST /requirements/{id}/acceptance-criteria ─
  registry.register(
    'createAcceptanceCriterion',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const projectId = resolveRequirementProject(ctx, ctx.params.id);
      await requireProjectCapability(ctx.actor, ctx.db.db, projectId, 'edit');
      const body = ctx.body ?? {};
      if (
        typeof body.action_or_condition !== 'string' ||
        body.action_or_condition.trim().length === 0
      ) {
        throw ApiError.validationError({ action_or_condition: 'required non-empty string' });
      }
      if (typeof body.expected_result !== 'string' || body.expected_result.trim().length === 0) {
        throw ApiError.validationError({ expected_result: 'required non-empty string' });
      }
      const ac = deps.acceptanceRepo.create({
        requirementId: ctx.params.id,
        context: typeof body.context === 'string' ? body.context : undefined,
        actionOrCondition: body.action_or_condition,
        expectedResult: body.expected_result,
        measurementMethod:
          typeof body.measurement_method === 'string' ? body.measurement_method : undefined,
        evidenceType: typeof body.evidence_type === 'string' ? body.evidence_type : undefined,
        thresholdValue:
          typeof body.threshold_value === 'string' ? body.threshold_value : undefined,
        unit: typeof body.unit === 'string' ? body.unit : undefined,
      });
      return mapAcceptance(ac);
    },
    { requireActor: 'user' },
  );

  // 6. createVerificationArtifact — POST /requirements/{id}/verification-artifacts
  registry.register(
    'createVerificationArtifact',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const projectId = resolveRequirementProject(ctx, ctx.params.id);
      await requireProjectCapability(ctx.actor, ctx.db.db, projectId, 'edit');
      const body = ctx.body ?? {};
      if (typeof body.artifact_type !== 'string' || body.artifact_type.length === 0) {
        throw ApiError.validationError({ artifact_type: 'required string' });
      }
      const va = deps.verificationRepo.create({
        requirementId: ctx.params.id,
        acceptanceCriterionId:
          typeof body.acceptance_criterion_id === 'string'
            ? body.acceptance_criterion_id
            : undefined,
        artifactType: body.artifact_type,
        description: typeof body.description === 'string' ? body.description : undefined,
        sourceId: typeof body.source_id === 'string' ? body.source_id : undefined,
        artifactPath: typeof body.artifact_path === 'string' ? body.artifact_path : undefined,
        result: typeof body.result === 'string' ? body.result : undefined,
        executedAt: typeof body.executed_at === 'string' ? body.executed_at : undefined,
        verifiedBy: ctx.actor.userId,
      });
      return mapVerification(va);
    },
    { requireActor: 'user' },
  );

  // 7. createFutureScenario — POST /projects/{id}/future-scenarios ───────────
  registry.register(
    'createFutureScenario',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        throw ApiError.validationError({ name: 'required non-empty string' });
      }
      if (typeof body.description !== 'string' || body.description.trim().length === 0) {
        throw ApiError.validationError({ description: 'required non-empty string' });
      }
      if (typeof body.activation_trigger !== 'string' || body.activation_trigger.length === 0) {
        throw ApiError.validationError({ activation_trigger: 'required string' });
      }
      if (typeof body.horizon !== 'string' || !['next', 'later', 'watch'].includes(body.horizon)) {
        throw ApiError.validationError({ horizon: 'must be one of next, later, watch' });
      }
      const scenario = deps.scenarioRepo.create({
        projectId: ctx.params.id,
        name: body.name,
        description: body.description,
        probabilityClass:
          typeof body.probability_class === 'string' ? body.probability_class : undefined,
        activationTrigger: body.activation_trigger,
        leadingIndicators: Array.isArray(body.leading_indicators) ? body.leading_indicators : [],
        horizon: body.horizon,
        architectureResponse:
          typeof body.architecture_response === 'string' ? body.architecture_response : undefined,
      });
      return mapScenario(scenario);
    },
    { requireActor: 'user' },
  );

  // 8. reviewOutcome — POST /outcomes/{id}/reviews ───────────────────────────
  registry.register(
    'reviewOutcome',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const outcome = deps.outcomeRepo.findById(ctx.params.id);
      if (!outcome) throw ApiError.notFound('Outcome not found', 'outcome');
      await requireProjectCapability(ctx.actor, ctx.db.db, outcome.projectId, 'review');
      const parsed = parseReviewBody(ctx.body ?? {});
      const review = deps.reviewRepo.create({
        projectId: outcome.projectId,
        entityType: 'outcome',
        entityId: outcome.id,
        entityVersion: parsed.entityVersion,
        action: parsed.action,
        reviewerId: ctx.actor.userId!,
        reason: parsed.reason,
        afterValue: parsed.afterValue,
        followUp: parsed.followUp,
      });
      return { data: mapReviewAction(review), meta: {}, statusCode: 201 };
    },
    { requireActor: 'user' },
  );

  // 9. reviewDriver — POST /drivers/{id}/reviews ─────────────────────────────
  registry.register(
    'reviewDriver',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const driver = deps.driverRepo.findById(ctx.params.id);
      if (!driver) throw ApiError.notFound('Driver not found', 'driver');
      await requireProjectCapability(ctx.actor, ctx.db.db, driver.projectId, 'review');
      const parsed = parseReviewBody(ctx.body ?? {});
      const review = deps.reviewRepo.create({
        projectId: driver.projectId,
        entityType: 'driver',
        entityId: driver.id,
        entityVersion: parsed.entityVersion,
        action: parsed.action,
        reviewerId: ctx.actor.userId!,
        reason: parsed.reason,
        afterValue: parsed.afterValue,
        followUp: parsed.followUp,
      });
      return { data: mapReviewAction(review), meta: {}, statusCode: 201 };
    },
    { requireActor: 'user' },
  );

  // 10. reviewRequirement — POST /requirements/{id}/reviews ──────────────────
  registry.register(
    'reviewRequirement',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const requirement = deps.requirementRepo.findById(ctx.params.id);
      if (!requirement) throw ApiError.notFound('Requirement not found', 'requirement');
      await requireProjectCapability(ctx.actor, ctx.db.db, requirement.projectId, 'review');
      const parsed = parseReviewBody(ctx.body ?? {});
      const review = deps.reviewRepo.create({
        projectId: requirement.projectId,
        entityType: 'requirement',
        entityId: requirement.id,
        entityVersion: parsed.entityVersion,
        action: parsed.action,
        reviewerId: ctx.actor.userId!,
        reason: parsed.reason,
        afterValue: parsed.afterValue,
        followUp: parsed.followUp,
      });
      return { data: mapReviewAction(review), meta: {}, statusCode: 201 };
    },
    { requireActor: 'user' },
  );

  // 11. reviewConflict — POST /conflicts/{id}/reviews ────────────────────────
  registry.register(
    'reviewConflict',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const conflict = deps.conflictRepo.findById(ctx.params.id);
      if (!conflict) throw ApiError.notFound('Conflict not found', 'conflict');
      await requireProjectCapability(ctx.actor, ctx.db.db, conflict.projectId, 'review');
      const parsed = parseReviewBody(ctx.body ?? {});
      const review = deps.reviewRepo.create({
        projectId: conflict.projectId,
        entityType: 'conflict',
        entityId: conflict.id,
        entityVersion: parsed.entityVersion,
        action: parsed.action,
        reviewerId: ctx.actor.userId!,
        reason: parsed.reason,
        afterValue: parsed.afterValue,
        followUp: parsed.followUp,
      });
      return { data: mapReviewAction(review), meta: {}, statusCode: 201 };
    },
    { requireActor: 'user' },
  );

  // 12. reviewGate — POST /projects/{id}/gates/{gate}/reviews ────────────────
  //
  // Executes one of the three human gates (scope / outcome / evidence_conflict).
  // `accept` advances the project state machine; `reject` blocks progression
  // with 409 GATE_NOT_PASSED; `uncertain` / `modify` record a pending follow-up
  // without transitioning. AI actors are excluded upstream by `requireUser`.
  registry.register(
    'reviewGate',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'review');

      const gate = ctx.params.gate as ReviewGateType;
      const transition = GATE_TRANSITIONS[gate];
      if (!transition) {
        throw ApiError.validationError({
          gate: `must be one of scope, outcome, evidence_conflict`,
        });
      }

      const parsed = parseReviewBody(ctx.body ?? {});
      const project = deps.projectRepo.findById(ctx.params.id);
      if (!project) throw ApiError.notFound('Project not found', 'project');

      // Record the gate review action (append-only audit trail).
      const review = deps.reviewRepo.reviewGate({
        projectId: project.id,
        gateType: gate,
        action: parsed.action,
        reviewerId: ctx.actor.userId!,
        entityVersion: parsed.entityVersion,
        reason: parsed.reason,
        afterValue: parsed.afterValue,
        followUp: parsed.followUp,
      });

      if (parsed.action === 'accept') {
        // Gate passes only when the project is in the gate's source phase.
        if (project.status !== transition.source) {
          throw ApiError.gateNotPassed(
            `Cannot pass '${gate}' gate: project is in '${project.status}', expected '${transition.source}'`,
          );
        }
        deps.projectRepo.updateStatus(project.id, transition.target);
      } else if (parsed.action === 'reject') {
        // An explicit rejection means the gate has not passed — block the
        // forward transition and surface a 409 to the client.
        throw ApiError.gateNotPassed(
          `Gate '${gate}' rejected: project remains in '${project.status}'`,
        );
      }
      // `uncertain` / `modify`: review recorded, no transition, 201 returned.

      return { data: mapReviewAction(review), meta: {}, statusCode: 201 };
    },
    { requireActor: 'user' },
  );

  // 13. resolveConflict — POST /conflicts/{id}/resolve ───────────────────────
  registry.register(
    'resolveConflict',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const conflict = deps.conflictRepo.findById(ctx.params.id);
      if (!conflict) throw ApiError.notFound('Conflict not found', 'conflict');
      await requireProjectCapability(ctx.actor, ctx.db.db, conflict.projectId, 'edit');

      const body = ctx.body ?? {};
      const decisionBody = body.decision;
      if (!decisionBody || typeof decisionBody !== 'object') {
        throw ApiError.validationError({ decision: 'required object' });
      }
      if (typeof decisionBody.question !== 'string' || decisionBody.question.length === 0) {
        throw ApiError.validationError({ 'decision.question': 'required string' });
      }
      if (
        typeof decisionBody.selected_option_id !== 'string' ||
        decisionBody.selected_option_id.length === 0
      ) {
        throw ApiError.validationError({ 'decision.selected_option_id': 'required string' });
      }
      if (typeof decisionBody.rationale !== 'string' || decisionBody.rationale.length === 0) {
        throw ApiError.validationError({ 'decision.rationale': 'required string' });
      }
      if (typeof body.owner_id !== 'string' || body.owner_id.length === 0) {
        throw ApiError.validationError({ owner_id: 'required string' });
      }

      // `expected_version` is optional in the OpenAPI schema; when absent we
      // use the current conflict version (no concurrency check).
      const expectedVersion =
        typeof body.expected_version === 'number'
          ? body.expected_version
          : conflict.version;

      const { conflict: resolved, decision } = deps.conflictRepo.resolve(ctx.params.id, {
        resolution: {
          decision: {
            question: decisionBody.question,
            selectedOptionId: decisionBody.selected_option_id,
            rationale: decisionBody.rationale,
            reviewTrigger:
              typeof decisionBody.review_trigger === 'string'
                ? decisionBody.review_trigger
                : undefined,
          },
          ownerId: body.owner_id,
          applicableScope:
            typeof body.applicable_scope === 'string' ? body.applicable_scope : undefined,
          expiryCondition:
            typeof body.expiry_condition === 'string' ? body.expiry_condition : undefined,
        },
        resolverId: ctx.actor.userId!,
        expectedVersion,
      });

      return {
        data: {
          conflict_id: resolved.id,
          conflict_status: resolved.status,
          decision_id: decision.id,
          decision_status: decision.status,
          selected_option_id: decision.selectedOptionId,
          rationale: decision.rationale,
          decided_by: decision.decidedBy,
          decided_at: decision.decidedAt,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { requireActor: 'user' },
  );
}
