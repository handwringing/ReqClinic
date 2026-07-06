import { eq } from 'drizzle-orm';
import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { paginatedResponse } from '../../response';
import { requireUser, requireProjectCapability } from '../../middleware/auth';
import { reportSnapshots } from '../../../db/schema/report';
import { requirements } from '../../../db/schema/core';
import type { OutcomeRepo } from '../../../repo/outcome-repo';
import type { DriverRepo } from '../../../repo/driver-repo';
import type { RequirementRepo } from '../../../repo/requirement-repo';
import type { AcceptanceRepo } from '../../../repo/acceptance-repo';
import type { SignalRepo } from '../../../repo/signal-repo';
import type { ScenarioRepo } from '../../../repo/scenario-repo';
import { type ConflictRepo, loadConflictDetail } from '../../../repo/conflict-repo';
import type { StakeholderRepo } from '../../../repo/stakeholder-repo';
import type { EvidenceLinkRepo } from '../../../repo/evidence-link-repo';
import type { BaselineRepo } from '../../../repo/baseline-repo';

/**
 * Core requirements-engineering query routes (Task 24, 14 operationIds).
 *
 * Every handler enforces `requireUser` + the project `read` capability and
 * returns snake_case DTOs matching `docs/03-api-openapi.yaml`. List endpoints
 * return paginated envelopes; single-resource reads return `{ data, meta }`.
 */

export interface CoreQueryRouteDeps {
  outcomeRepo: OutcomeRepo;
  driverRepo: DriverRepo;
  requirementRepo: RequirementRepo;
  acceptanceRepo: AcceptanceRepo;
  signalRepo: SignalRepo;
  scenarioRepo: ScenarioRepo;
  conflictRepo: ConflictRepo;
  stakeholderRepo: StakeholderRepo;
  evidenceLinkRepo: EvidenceLinkRepo;
  baselineRepo: BaselineRepo;
}

// ── Response mappers (camelCase row → snake_case DTO) ───────────────────────

export function mapOutcome(o: ReturnType<OutcomeRepo['findById']>) {
  if (!o) return null;
  return {
    id: o.id,
    project_id: o.projectId,
    driver_id: o.driverId,
    job_id: o.jobId,
    description: o.description,
    success_metric: o.successMetric,
    baseline_value: o.baselineValue,
    target_value: o.targetValue,
    unit: o.unit,
    failure_condition: o.failureCondition,
    horizon: o.horizon,
    owner_id: o.ownerId,
    epistemic_type: o.epistemicType,
    status: o.status,
    version: o.version,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

export function mapDriver(d: ReturnType<DriverRepo['findById']>) {
  if (!d) return null;
  return {
    id: d.id,
    project_id: d.projectId,
    driver_type: d.driverType,
    statement: d.statement,
    owner_id: d.ownerId,
    status: d.status,
    version: d.version,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}

export function mapRequirement(r: ReturnType<RequirementRepo['findById']>) {
  if (!r) return null;
  return {
    id: r.id,
    project_id: r.projectId,
    requirement_key: r.requirementKey,
    title: r.title,
    statement: r.statement,
    requirement_type: r.requirementType,
    provenance: r.provenance,
    horizon: r.horizon,
    scope_disposition: r.scopeDisposition,
    commitment: r.commitment,
    stability: r.stability,
    priority: r.priority,
    valid_from: r.validFrom,
    valid_until: r.validUntil,
    activation_trigger: r.activationTrigger,
    deactivation_trigger: r.deactivationTrigger,
    volatility_drivers: JSON.parse(r.volatilityDriversJson),
    migration_strategy: r.migrationStrategy,
    reversibility: r.reversibility,
    owner_id: r.ownerId,
    supersedes_requirement_id: r.supersedesRequirementId,
    lifecycle_status: r.lifecycleStatus,
    rationale: r.rationale,
    version: r.version,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export function mapAcceptance(a: {
  id: string; projectId: string; requirementId: string; context: string | null;
  actionOrCondition: string; expectedResult: string; measurementMethod: string | null;
  evidenceType: string | null; thresholdValue: string | null; unit: string | null;
  status: string; version: number; createdAt: string; updatedAt: string;
}) {
  return {
    id: a.id,
    project_id: a.projectId,
    requirement_id: a.requirementId,
    context: a.context,
    action_or_condition: a.actionOrCondition,
    expected_result: a.expectedResult,
    measurement_method: a.measurementMethod,
    evidence_type: a.evidenceType,
    threshold_value: a.thresholdValue,
    unit: a.unit,
    status: a.status,
    version: a.version,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

function mapSignal(s: {
  id: string; projectId: string; requirementId: string; name: string;
  measurement: string; thresholdValue: string | null; unit: string | null;
  observationWindow: string | null; ownerId: string | null; reviewCadence: string | null;
  triggerCondition: string | null; status: string; version: number;
  createdAt: string; updatedAt: string;
}) {
  return {
    id: s.id,
    project_id: s.projectId,
    requirement_id: s.requirementId,
    name: s.name,
    measurement: s.measurement,
    threshold_value: s.thresholdValue,
    unit: s.unit,
    observation_window: s.observationWindow,
    owner_id: s.ownerId,
    review_cadence: s.reviewCadence,
    trigger_condition: s.triggerCondition,
    status: s.status,
    version: s.version,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export function mapScenario(s: {
  id: string; projectId: string; name: string; description: string;
  probabilityClass: string | null; activationTrigger: string;
  leadingIndicatorsJson: string; horizon: string; architectureResponse: string | null;
  status: string; version: number; createdAt: string; updatedAt: string;
}) {
  return {
    id: s.id,
    project_id: s.projectId,
    name: s.name,
    description: s.description,
    probability_class: s.probabilityClass,
    activation_trigger: s.activationTrigger,
    leading_indicators: JSON.parse(s.leadingIndicatorsJson),
    horizon: s.horizon,
    architecture_response: s.architectureResponse,
    status: s.status,
    version: s.version,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

function mapConflict(c: {
  id: string; projectId: string; statement: string; severity: string;
  blocking: number; ownerId: string | null; status: string; version: number;
  createdAt: string; updatedAt: string;
}) {
  return {
    id: c.id,
    project_id: c.projectId,
    statement: c.statement,
    severity: c.severity,
    blocking: c.blocking === 1,
    owner_id: c.ownerId,
    status: c.status,
    version: c.version,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function mapStakeholder(s: {
  id: string; projectId: string; name: string; role: string; influence: string | null;
  interest: string | null; authority: string | null; contactScope: string | null;
  notes: string | null; epistemicType: string; status: string; version: number;
  createdAt: string; updatedAt: string;
}) {
  return {
    id: s.id,
    project_id: s.projectId,
    name: s.name,
    role: s.role,
    influence: s.influence,
    interest: s.interest,
    authority: s.authority,
    contact_scope: s.contactScope,
    notes: s.notes,
    epistemic_type: s.epistemicType,
    status: s.status,
    version: s.version,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

function mapInterviewTurn(t: {
  id: string; projectId: string; turnIndex: number; role: string;
  stakeholderId: string | null; speakerLabel: string; content: string;
  evidenceSpanId: string | null; createdAt: string;
}) {
  return {
    id: t.id,
    project_id: t.projectId,
    turn_index: t.turnIndex,
    role: t.role,
    stakeholder_id: t.stakeholderId,
    speaker_label: t.speakerLabel,
    content: t.content,
    evidence_span_id: t.evidenceSpanId,
    created_at: t.createdAt,
  };
}

function mapEvidenceLink(e: {
  id: string; projectId: string; entityType: string; entityId: string;
  evidenceSpanId: string; relation: string; createdBy: string; createdAt: string;
}) {
  return {
    id: e.id,
    project_id: e.projectId,
    entity_type: e.entityType,
    entity_id: e.entityId,
    evidence_span_id: e.evidenceSpanId,
    relation: e.relation,
    created_by: e.createdBy,
    created_at: e.createdAt,
  };
}

function mapTraceLink(t: {
  id: string; projectId: string; fromType: string; fromId: string; relation: string;
  toType: string; toId: string; status: string; createdAt: string;
}) {
  return {
    id: t.id,
    project_id: t.projectId,
    from_type: t.fromType,
    from_id: t.fromId,
    relation: t.relation,
    to_type: t.toType,
    to_id: t.toId,
    status: t.status,
    created_at: t.createdAt,
  };
}

function mapBaseline(b: {
  id: string; projectId: string; baselineVersion: number; status: string;
  approvedBy: string | null; approvedAt: string | null; dataHash: string;
  version: number; createdAt: string;
}) {
  return {
    id: b.id,
    project_id: b.projectId,
    baseline_version: b.baselineVersion,
    status: b.status,
    approved_by: b.approvedBy,
    approved_at: b.approvedAt,
    data_hash: b.dataHash,
    version: b.version,
    created_at: b.createdAt,
  };
}

function mapReport(r: {
  id: string; projectId: string; reportVersion: number; baselineId: string;
  audience: string; language: string; status: string; generatedAt: string;
  releasedAt: string | null; releasedBy: string | null;
}) {
  return {
    id: r.id,
    project_id: r.projectId,
    report_version: r.reportVersion,
    baseline_id: r.baselineId,
    audience: r.audience,
    language: r.language,
    status: r.status,
    generated_at: r.generatedAt,
    released_at: r.releasedAt,
    released_by: r.releasedBy,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a requirement id → its project id (for capability checks). */
async function resolveRequirementProject(ctx: RouteContext, requirementId: string): Promise<string> {
  const row = ctx.db.db
    .select({ id: requirements.id, projectId: requirements.projectId })
    .from(requirements)
    .where(eq(requirements.id, requirementId))
    .get();
  if (!row) throw ApiError.notFound('Requirement not found', 'requirement');
  return row.projectId;
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerCoreQueryRoutes(
  registry: RouteRegistry,
  deps: CoreQueryRouteDeps,
): void {
  // 1. listOutcomes — GET /projects/{id}/outcomes ───────────────────────────
  registry.register(
    'listOutcomes',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const { items, nextCursor } = deps.outcomeRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        status: typeof ctx.query.status === 'string' ? ctx.query.status : undefined,
        epistemicType:
          typeof ctx.query.epistemic_type === 'string' ? ctx.query.epistemic_type : undefined,
      });
      return paginatedResponse(items.map(mapOutcome), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 2. listRequirements — GET /projects/{id}/requirements ───────────────────
  registry.register(
    'listRequirements',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const { items, nextCursor } = deps.requirementRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        lifecycleStatus:
          typeof ctx.query.lifecycle_status === 'string' ? ctx.query.lifecycle_status : undefined,
        provenance:
          typeof ctx.query.provenance === 'string' ? ctx.query.provenance : undefined,
      });
      return paginatedResponse(items.map(mapRequirement), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 3. listDrivers — GET /projects/{id}/drivers ─────────────────────────────
  registry.register(
    'listDrivers',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const { items, nextCursor } = deps.driverRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        driverType:
          typeof ctx.query.driver_type === 'string' ? ctx.query.driver_type : undefined,
        status: typeof ctx.query.status === 'string' ? ctx.query.status : undefined,
      });
      return paginatedResponse(items.map(mapDriver), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 4. listInterviewTurns — GET /projects/{id}/interview-turns ───────────────
  registry.register(
    'listInterviewTurns',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const { items, nextCursor } = deps.stakeholderRepo.listInterviewTurns(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        role: typeof ctx.query.role === 'string' ? ctx.query.role : undefined,
      });
      return paginatedResponse(items.map(mapInterviewTurn), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 5. listStakeholders — GET /projects/{id}/stakeholders ───────────────────
  registry.register(
    'listStakeholders',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const { items, nextCursor } = deps.stakeholderRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
      });
      return paginatedResponse(items.map(mapStakeholder), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 6. listEvidenceLinks — GET /projects/{id}/evidence-links ─────────────────
  registry.register(
    'listEvidenceLinks',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const items = deps.evidenceLinkRepo.listByProject(ctx.params.id, {
        entityType:
          typeof ctx.query.entity_type === 'string' ? ctx.query.entity_type : undefined,
        entityId:
          typeof ctx.query.entity_id === 'string' ? ctx.query.entity_id : undefined,
      });
      return paginatedResponse(items.map(mapEvidenceLink));
    },
    { requireActor: 'user' },
  );

  // 7. listTraceLinks — GET /projects/{id}/trace-links ──────────────────────
  registry.register(
    'listTraceLinks',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const items = deps.evidenceLinkRepo.listTraceLinks(ctx.params.id, {
        fromType: typeof ctx.query.from_type === 'string' ? ctx.query.from_type : undefined,
        fromId: typeof ctx.query.from_id === 'string' ? ctx.query.from_id : undefined,
        toType: typeof ctx.query.to_type === 'string' ? ctx.query.to_type : undefined,
        toId: typeof ctx.query.to_id === 'string' ? ctx.query.to_id : undefined,
      });
      return paginatedResponse(items.map(mapTraceLink));
    },
    { requireActor: 'user' },
  );

  // 8. getConflictDetail — GET /conflicts/{id} ──────────────────────────────
  registry.register(
    'getConflictDetail',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const conflict = deps.conflictRepo.findById(ctx.params.id);
      if (!conflict) throw ApiError.notFound('Conflict not found', 'conflict');
      await requireProjectCapability(ctx.actor, ctx.db.db, conflict.projectId, 'read');

      // Load sides + options + current decision via the conflict-repo helper.
      const detail = loadConflictDetail(ctx.db.db, conflict);
      return {
        ...mapConflict(detail.conflict),
        sides: detail.sides.map((s) => ({
          id: s.id,
          label: s.label,
          statement: s.statement,
          stance: s.stance,
          evidence_link_ids: JSON.parse(s.evidenceLinkIdsJson),
        })),
        options: detail.options.map((o) => ({
          id: o.id,
          description: o.description,
          benefits: o.benefits,
          costs: o.costs,
          risks: o.risks,
          reversibility: o.reversibility,
          status: o.status,
        })),
        current_decision_id: detail.currentDecision?.id ?? null,
      };
    },
    { requireActor: 'user' },
  );

  // 9. listConflicts — GET /projects/{id}/conflicts ─────────────────────────
  registry.register(
    'listConflicts',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const { items, nextCursor } = deps.conflictRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        status: typeof ctx.query.status === 'string' ? ctx.query.status : undefined,
      });
      return paginatedResponse(items.map(mapConflict), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 10. listAcceptanceCriteria — GET /requirements/{id}/acceptance-criteria ─
  registry.register(
    'listAcceptanceCriteria',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const projectId = await resolveRequirementProject(ctx, ctx.params.id);
      await requireProjectCapability(ctx.actor, ctx.db.db, projectId, 'read');
      const { items, nextCursor } = deps.acceptanceRepo.listByRequirement(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
      });
      return paginatedResponse(items.map(mapAcceptance), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 11. listOperationalSignals — GET /requirements/{id}/operational-signals ─
  registry.register(
    'listOperationalSignals',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const projectId = await resolveRequirementProject(ctx, ctx.params.id);
      await requireProjectCapability(ctx.actor, ctx.db.db, projectId, 'read');
      const items = deps.signalRepo.listByRequirement(ctx.params.id);
      return paginatedResponse(items.map(mapSignal));
    },
    { requireActor: 'user' },
  );

  // 12. listFutureScenarios — GET /projects/{id}/future-scenarios ───────────
  registry.register(
    'listFutureScenarios',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const { items, nextCursor } = deps.scenarioRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
      });
      return paginatedResponse(items.map(mapScenario), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 13. listBaselines — GET /projects/{id}/baselines ────────────────────────
  registry.register(
    'listBaselines',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const { items, nextCursor } = deps.baselineRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
        status: typeof ctx.query.status === 'string' ? ctx.query.status : undefined,
      });
      return paginatedResponse(items.map(mapBaseline), nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 14. listReports — GET /projects/{id}/reports ────────────────────────────
  registry.register(
    'listReports',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const rows = ctx.db.db
        .select()
        .from(reportSnapshots)
        .where(eq(reportSnapshots.projectId, ctx.params.id))
        .orderBy(reportSnapshots.reportVersion)
        .all()
        .map(mapReport);
      return paginatedResponse(rows);
    },
    { requireActor: 'user' },
  );
}
