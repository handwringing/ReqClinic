import { eq, and } from 'drizzle-orm';
import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { requireUser, requireActor, requireProjectCapability } from '../../middleware/auth';
import { generateId } from '../../../shared/id';
import { now } from '../../../shared/time';
import { reviewActions } from '../../../db/schema/review';
import { projectDomainPacks, domainPacks, type DomainProfile } from '../../../db/schema/domain';
import {
  STATIC_DOMAIN_PACKS,
  findPackVersion,
  type StaticDomainPack,
} from '../../../domain-packs';
import type { DomainProfileRepo } from '../../../repo/domain-repo';

/**
 * Domain profile & static domain-pack routes (Task 21, §6).
 *
 * Registers 7 operationIds against the OpenAPI spec. Domain-profile generation
 * itself is asynchronous (an AI job enqueued via `createAnalysisRun`); these
 * handlers cover reading, human review, and static-pack management.
 */

export interface DomainRouteDeps {
  domainProfileRepo: DomainProfileRepo;
}

// ── response mappers ─────────────────────────────────────────────────────────

function mapDomainProfile(row: DomainProfile) {
  return {
    id: row.id,
    project_id: row.projectId,
    profile_version: row.profileVersion,
    work_type: row.workType,
    domain_labels: JSON.parse(row.domainLabelsJson),
    risk_flags: JSON.parse(row.riskFlagsJson),
    terminology_map: JSON.parse(row.terminologyMapJson),
    suggested_pack_ids: JSON.parse(row.suggestedPackIdsJson),
    required_human_roles: JSON.parse(row.requiredHumanRolesJson),
    routing_risk: row.routingRisk,
    routing_basis: JSON.parse(row.routingBasisJson),
    rationale_evidence_links: JSON.parse(row.rationaleEvidenceLinksJson),
    unknowns: JSON.parse(row.unknownsJson),
    status: row.status,
    classifier_model: row.classifierModel,
    prompt_version: row.promptVersion,
    approved_by: row.approvedBy,
    approved_at: row.approvedAt,
    supersedes_profile_id: row.supersedesProfileId,
    created_at: row.createdAt,
  };
}

function mapPackSummary(pack: StaticDomainPack) {
  return {
    id: pack.id,
    name: pack.name,
    latest_version: pack.version,
    status: pack.status,
    compatible_core_schema: pack.compatible_core_schema,
    released_at: pack.released_at,
  };
}

function mapPackVersion(pack: StaticDomainPack) {
  return {
    id: pack.id,
    version: pack.version,
    name: pack.name,
    status: pack.status,
    compatible_core_schema: pack.compatible_core_schema,
    manifest: pack.manifest,
    manifest_hash: pack.manifest_hash,
    released_at: pack.released_at,
    deprecated_at: pack.deprecated_at,
  };
}

function mapProjectDomainPack(row: typeof projectDomainPacks.$inferSelect) {
  return {
    id: row.id,
    project_id: row.projectId,
    domain_pack_id: row.domainPackId,
    domain_pack_version: row.domainPackVersion,
    domain_profile_id: row.domainProfileId,
    activation_reason: row.activationReason,
    status: row.status,
    activated_by: row.activatedBy,
    activated_at: row.activatedAt,
    deactivated_at: row.deactivatedAt,
  };
}

// ── registration ─────────────────────────────────────────────────────────────

export function registerDomainRoutes(
  registry: RouteRegistry,
  deps: DomainRouteDeps,
): void {
  // 1. getDomainProfile ─ GET /api/v1/projects/:id/domain-profile ─────────────
  registry.register(
    'getDomainProfile',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');
      const profile = deps.domainProfileRepo.findCurrentByProject(ctx.params.id);
      if (!profile) {
        throw ApiError.notFound('Domain profile not found', 'domain_profile');
      }
      return mapDomainProfile(profile);
    },
    { requireActor: 'user' },
  );

  // 2. reviewDomainProfile ─ POST /api/v1/projects/:id/domain-profile/reviews ─
  registry.register(
    'reviewDomainProfile',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'review');
      const body = ctx.body ?? {};
      const action = typeof body.action === 'string' ? body.action : undefined;
      if (!action || !['accept', 'modify', 'reject', 'uncertain'].includes(action)) {
        throw ApiError.validationError({ action: 'must be accept|modify|reject|uncertain' });
      }
      if (typeof body.entity_version !== 'number' || !Number.isInteger(body.entity_version)) {
        throw ApiError.validationError({ entity_version: 'required integer' });
      }
      if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
        throw ApiError.validationError({ reason: 'required non-empty string' });
      }

      const profile = deps.domainProfileRepo.findById(body.entity_id ?? '');
      // entity_id is optional in the wire format; fall back to the project's
      // current profile when omitted.
      const target =
        profile ??
        deps.domainProfileRepo.findCurrentByProject(ctx.params.id);
      if (!target) {
        throw ApiError.notFound('Domain profile not found', 'domain_profile');
      }
      if (target.profileVersion !== body.entity_version) {
        throw ApiError.versionConflict();
      }

      const reviewerId = ctx.actor.userId!;
      const ts = now();

      // AI must not approve a domain profile: only human reviewers (already
      // enforced by the `review` capability gate above). On `accept`, flip the
      // profile to `approved` and supersede any prior approved version.
      if (action === 'accept') {
        deps.domainProfileRepo.updateStatus(
          target.id,
          'approved',
          target.profileVersion,
          reviewerId,
        );
      } else if (action === 'reject') {
        deps.domainProfileRepo.updateStatus(target.id, 'rejected', target.profileVersion);
      } else if (action === 'uncertain') {
        deps.domainProfileRepo.updateStatus(target.id, 'candidate', target.profileVersion);
      }

      const reviewId = generateId('rv');
      ctx.db.db
        .insert(reviewActions)
        .values({
          id: reviewId,
          projectId: ctx.params.id,
          gate: 'domain_profile',
          entityType: 'domain_profile',
          entityId: target.id,
          entityVersion: target.profileVersion,
          action,
          beforeValue: null,
          afterValue:
            action === 'modify' && body.after_value
              ? JSON.stringify(body.after_value)
              : null,
          reviewerId,
          reason: body.reason,
          followUpJson: null,
          createdAt: ts,
        })
        .run();

      const row = ctx.db.db
        .select()
        .from(reviewActions)
        .where(eq(reviewActions.id, reviewId))
        .get();
      return {
        id: row!.id,
        gate: row!.gate,
        entity_type: row!.entityType,
        entity_id: row!.entityId,
        entity_version: row!.entityVersion,
        action: row!.action,
        reviewer_id: row!.reviewerId,
        reason: row!.reason,
        after_value: row!.afterValue ? JSON.parse(row!.afterValue) : null,
        follow_up: row!.followUpJson ? JSON.parse(row!.followUpJson) : null,
        created_at: row!.createdAt,
      };
    },
    { requireActor: 'user' },
  );

  // 3. listDomainPacks ─ GET /api/v1/domain-packs ─────────────────────────────
  registry.register(
    'listDomainPacks',
    async (ctx: RouteContext) => {
      requireActor(ctx.actor);
      return STATIC_DOMAIN_PACKS.map(mapPackSummary);
    },
    { requireActor: 'any' },
  );

  // 4. getDomainPackVersion ─ GET /api/v1/domain-packs/:id/versions/:version ──
  registry.register(
    'getDomainPackVersion',
    async (ctx: RouteContext) => {
      requireActor(ctx.actor);
      const pack = findPackVersion(ctx.params.id, ctx.params.version);
      if (!pack) {
        throw ApiError.notFound('Domain pack version not found', 'domain_pack');
      }
      return mapPackVersion(pack);
    },
    { requireActor: 'any' },
  );

  // 5. activateDomainPack ─ POST /api/v1/projects/:id/domain-packs/:packId/activations ─
  registry.register(
    'activateDomainPack',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      const packVersionRaw =
        typeof body.domain_pack_version === 'string'
          ? body.domain_pack_version
          : undefined;
      if (!packVersionRaw) {
        throw ApiError.validationError({ domain_pack_version: 'required string' });
      }
      if (typeof body.domain_profile_id !== 'string') {
        throw ApiError.validationError({ domain_profile_id: 'required string' });
      }
      if (
        typeof body.activation_reason !== 'string' ||
        body.activation_reason.trim().length === 0
      ) {
        throw ApiError.validationError({ activation_reason: 'required non-empty string' });
      }

      // Accept both `id@version` and a bare version; the pack id comes from
      // the path to avoid mismatched pairs.
      const version = packVersionRaw.includes('@')
        ? packVersionRaw.split('@')[1]
        : packVersionRaw;
      const pack = findPackVersion(ctx.params.packId, version);
      if (!pack) {
        throw ApiError.notFound('Domain pack version not found', 'domain_pack');
      }

      // Verify the referenced domain profile exists and belongs to the project.
      const profile = deps.domainProfileRepo.findById(body.domain_profile_id);
      if (!profile || profile.projectId !== ctx.params.id) {
        throw ApiError.validationError({ domain_profile_id: 'unknown for this project' });
      }

      // Enforce: at most one `active` version per (project, pack) pair. A
      // prior active version must be deactivated first.
      const existing = ctx.db.db
        .select()
        .from(projectDomainPacks)
        .where(
          and(
            eq(projectDomainPacks.projectId, ctx.params.id),
            eq(projectDomainPacks.domainPackId, ctx.params.packId),
            eq(projectDomainPacks.status, 'active'),
          ),
        )
        .limit(1)
        .get();
      if (existing) {
        throw ApiError.conflict(
          'PACK_ALREADY_ACTIVE',
          'An active version of this pack already exists; deactivate it first.',
        );
      }

      // The static packs are loaded from JSON at runtime; the `domain_packs`
      // table is the persistence layer referenced by the composite FK on
      // `project_domain_packs`. Seed the row idempotently so the FK is
      // satisfied without requiring a separate migration step.
      ctx.db.db
        .insert(domainPacks)
        .values({
          id: pack.id,
          version: pack.version,
          name: pack.name,
          status: pack.status,
          compatibleCoreSchema: pack.compatible_core_schema,
          manifestJson: JSON.stringify(pack.manifest),
          manifestHash: pack.manifest_hash,
          releasedAt: pack.released_at,
          deprecatedAt: pack.deprecated_at,
        })
        .onConflictDoNothing()
        .run();

      const ts = now();
      const id = generateId('pdp');
      const row = ctx.db.db
        .insert(projectDomainPacks)
        .values({
          id,
          projectId: ctx.params.id,
          domainPackId: ctx.params.packId,
          domainPackVersion: version,
          domainProfileId: body.domain_profile_id,
          activationReason: body.activation_reason,
          status: 'active',
          activatedBy: ctx.actor.userId!,
          activatedAt: ts,
          deactivatedAt: null,
        })
        .returning()
        .get();

      return mapProjectDomainPack(row);
    },
    { requireActor: 'user' },
  );

  // 6. previewDeactivation ─ POST /api/v1/projects/:id/domain-packs/:packId/deactivation-previews ─
  registry.register(
    'previewDeactivation',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      const packVersionRaw =
        typeof body.domain_pack_version === 'string'
          ? body.domain_pack_version
          : undefined;
      if (!packVersionRaw) {
        throw ApiError.validationError({ domain_pack_version: 'required string' });
      }
      const version = packVersionRaw.includes('@')
        ? packVersionRaw.split('@')[1]
        : packVersionRaw;

      const active = ctx.db.db
        .select()
        .from(projectDomainPacks)
        .where(
          and(
            eq(projectDomainPacks.projectId, ctx.params.id),
            eq(projectDomainPacks.domainPackId, ctx.params.packId),
            eq(projectDomainPacks.status, 'active'),
          ),
        )
        .limit(1)
        .get();

      return {
        data: {
          preview_id: generateId('dpv'),
          project_id: ctx.params.id,
          domain_pack_id: ctx.params.packId,
          domain_pack_version: version,
          currently_active: active?.domainPackVersion === version,
          impact: {
            historical_references_preserved: true,
            affected_entities: [],
          },
        },
        meta: {},
        statusCode: 200,
      };
    },
    { requireActor: 'user' },
  );

  // 7. deactivateDomainPack ─ POST /api/v1/projects/:id/domain-packs/:packId/deactivations ─
  registry.register(
    'deactivateDomainPack',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      if (typeof body.preview_id !== 'string') {
        throw ApiError.validationError({ preview_id: 'required string' });
      }
      if (typeof body.domain_pack_version !== 'string') {
        throw ApiError.validationError({ domain_pack_version: 'required string' });
      }
      if (
        typeof body.expected_version !== 'number' ||
        !Number.isInteger(body.expected_version)
      ) {
        throw ApiError.validationError({ expected_version: 'required integer' });
      }

      const version = body.domain_pack_version.includes('@')
        ? body.domain_pack_version.split('@')[1]
        : body.domain_pack_version;

      const active = ctx.db.db
        .select()
        .from(projectDomainPacks)
        .where(
          and(
            eq(projectDomainPacks.projectId, ctx.params.id),
            eq(projectDomainPacks.domainPackId, ctx.params.packId),
            eq(projectDomainPacks.status, 'active'),
          ),
        )
        .limit(1)
        .get();
      if (!active) {
        throw ApiError.notFound('No active domain pack to deactivate', 'project_domain_pack');
      }
      if (active.domainPackVersion !== version) {
        throw ApiError.versionConflict();
      }

      const ts = now();
      const updated = ctx.db.db
        .update(projectDomainPacks)
        .set({
          status: 'inactive',
          deactivatedAt: ts,
        })
        .where(eq(projectDomainPacks.id, active.id))
        .returning()
        .get();

      return {
        data: mapProjectDomainPack(updated),
        meta: {},
        statusCode: 200,
      };
    },
    { requireActor: 'user' },
  );
}
