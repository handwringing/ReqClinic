import { eq, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { paginatedResponse } from '../../response';
import { requireUser, requireProjectCapability } from '../../middleware/auth';
import { generateId } from '../../../shared/id';
import { now, addDays } from '../../../shared/time';
import { blobs, evidenceSpans } from '../../../db/schema/source';
import { deleteTasks } from '../../../db/schema/lifecycle';
import type { ProjectRepo } from '../../../repo/project-repo';
import type { MemberRepo } from '../../../repo/member-repo';
import type { IntakeRepo } from '../../../repo/intake-repo';
import type { SourceRepo } from '../../../repo/source-repo';
import type { EvidenceRepo } from '../../../repo/evidence-repo';
import type { UserRepo } from '../../../repo/user-repo';
import type { AgreementRepo } from '../../../repo/agreement-repo';
import { JobRepo } from '../../../repo/job-repo';
import { resolveFormalUserId, formalUserActor } from '../../formal-actor';
import { enqueueFormalGuidanceJob } from '../../formal-job';
import type { FormalMapRepo } from '../../../repo/formal-map-repo';
import {
  buildDeterministicFormalSnapshot,
  formalInputHash,
} from '../../../agent/formal-runtime';

/**
 * Project / intake / member / source / evidence routes (Task 16-17).
 *
 * Registers 12 operationIds against the OpenAPI spec via the RouteRegistry.
 * Each handler assembles its own RouteContext, enforces capability gates, and
 * returns snake_case DTOs matching the response schemas in `03-api-openapi.yaml`.
 */

export interface ProjectRouteDeps {
  projectRepo: ProjectRepo;
  memberRepo: MemberRepo;
  intakeRepo: IntakeRepo;
  sourceRepo: SourceRepo;
  evidenceRepo: EvidenceRepo;
  userRepo: UserRepo;
  agreementRepo?: AgreementRepo;
  jobRepo?: JobRepo;
  formalMapRepo?: FormalMapRepo;
}

// ── Upload-source constants (API §7.1) ──────────────────────────────────────

/** Single-file size cap: 25 MiB (API design §7.1). */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Media-type whitelist for source uploads (API §7.1).
 * PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, PNG, JPEG.
 */
const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
]);

/** File-signature (magic-byte) expectations per media-type family. */
interface SignatureRule {
  /** Expected leading bytes, as a hex string (lowercase). */
  hex: string;
  /** Human-readable label for diagnostics. */
  label: string;
}

const SIGNATURE_RULES: Record<string, SignatureRule> = {
  'application/pdf': { hex: '25504446', label: '%PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    hex: '504b0304',
    label: 'PK (ZIP/OOXML)',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    hex: '504b0304',
    label: 'PK (ZIP/OOXML)',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    hex: '504b0304',
    label: 'PK (ZIP/OOXML)',
  },
  'image/png': { hex: '89504e470d0a1a0a', label: 'PNG signature' },
  'image/jpeg': { hex: 'ffd8ff', label: 'JPEG SOI' },
};

// ── Response mappers ─────────────────────────────────────────────────────────

function mapProject(row: ReturnType<ProjectRepo['findById']>) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    risk_level: row.riskLevel,
    language: row.language,
    version: row.version,
    owner_id: row.ownerId,
    created_by: row.createdBy,
    current_domain_profile_id: row.currentDomainProfileId,
    current_baseline: null,
    current_report: null,
    blockers: [],
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function mapProjectSummary(row: ReturnType<ProjectRepo['findById']>) {
  if (!row) return null;
  return {
    id: row.id,
    owner_id: row.ownerId,
    name: row.name,
    description: row.description,
    status: row.status,
    risk_level: row.riskLevel,
    language: row.language,
    version: row.version,
    updated_at: row.updatedAt,
  };
}

interface MemberRow {
  userId: string;
  capabilitiesJson: string;
  status: string;
  grantedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

async function mapMember(
  member: MemberRow,
  userRepo: UserRepo,
): Promise<Record<string, unknown>> {
  const user = await userRepo.findById(member.userId);
  return {
    user_id: member.userId,
    display_name: user?.displayName ?? '',
    email: user?.email ?? null,
    capabilities: JSON.parse(member.capabilitiesJson) as string[],
    status: member.status,
    version: member.version,
    granted_by: member.grantedBy,
    created_at: member.createdAt,
    updated_at: member.updatedAt,
  };
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerProjectRoutes(
  registry: RouteRegistry,
  deps: ProjectRouteDeps,
): void {
  // 1. createProject ─ POST /api/v1/projects ─────────────────────────────────
  registry.register(
    'createProject',
    async (ctx: RouteContext) => {
      const body = ctx.body ?? {};
      const initialRequest = body.initial_request;
      if (typeof initialRequest !== 'string' || initialRequest.trim().length === 0) {
        throw ApiError.validationError({
          initial_request: 'must be a non-empty string',
        });
      }

      const userId = await resolveFormalUserId(ctx, {
        userRepo: deps.userRepo,
        agreementRepo: deps.agreementRepo,
      });
      const project = deps.projectRepo.create({
        ownerId: userId,
        name: typeof body.name === 'string' ? body.name : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        language: typeof body.language === 'string' ? body.language : undefined,
      });

      // Create the initial intake version (§5.1: project + Owner + intake same tx).
      deps.intakeRepo.create({
        projectId: project.id,
        originalText: initialRequest,
        decisionIntent:
          typeof body.decision_intent === 'string' ? body.decision_intent : undefined,
        selectedWorkType:
          typeof body.selected_work_type === 'string' ? body.selected_work_type : undefined,
        candidateRoles: Array.isArray(body.candidate_roles) ? body.candidate_roles : [],
        candidateConstraints: Array.isArray(body.candidate_constraints)
          ? body.candidate_constraints
          : [],
        submittedBy: userId,
      });

      const sourceKind = body.source_kind === 'sample' ? 'sample' : 'custom';
      const sourceCaseId =
        typeof body.source_case_id === 'string' && body.source_case_id.trim()
          ? body.source_case_id.trim()
          : null;

      if (sourceKind === 'sample' && deps.formalMapRepo) {
        const snapshot = buildDeterministicFormalSnapshot({
          projectId: project.id,
          projectTitle: project.name ?? '示例项目',
          projectDescription: project.description ?? '',
          intakeText: initialRequest,
          turns: [],
          previousSnapshot: null,
          sourceKind: 'direct',
          quickBriefSnapshot: null,
          modelEnabled: false,
        });
        const persisted = deps.formalMapRepo.createSnapshot({
          projectId: project.id,
          status: 'fallback',
          sourceKind: 'fallback',
          sourceQuickSessionId: null,
          sourceBriefVersionId: null,
          aiJobId: null,
          snapshot,
          inputHash: formalInputHash({
            project,
            initialRequest,
            sourceKind,
            sourceCaseId,
          }),
        });
        deps.formalMapRepo.appendAiTurnOnce(project.id, snapshot.nextQuestion, 'question');
        return {
          data: {
            project_id: project.id,
            job_id: null,
            status: 'accepted',
            status_url: null,
            map_snapshot_id: persisted.id,
            map_snapshot_version: persisted.version,
            source_kind: sourceKind,
            source_case_id: sourceCaseId,
          },
          meta: {},
          statusCode: 202,
        };
      }

      const job = enqueueFormalGuidanceJob({
        ctx,
        jobRepo: deps.jobRepo ?? new JobRepo(ctx.db.db),
        projectId: project.id,
        userId,
        payload: {
          event: 'project_created',
          source_kind: 'direct',
          initial_request: initialRequest,
          name: typeof body.name === 'string' ? body.name : null,
          description: typeof body.description === 'string' ? body.description : null,
          decision_intent: typeof body.decision_intent === 'string' ? body.decision_intent : null,
          selected_work_type: typeof body.selected_work_type === 'string' ? body.selected_work_type : null,
          candidate_roles: Array.isArray(body.candidate_roles) ? body.candidate_roles : [],
          candidate_constraints: Array.isArray(body.candidate_constraints)
            ? body.candidate_constraints
            : [],
        },
      });
      return {
        data: {
          project_id: project.id,
          job_id: job.job_id,
          status: job.status,
          status_url: job.status_url,
        },
        meta: {},
        statusCode: 202,
      };
    },
    { requireActor: 'any', requireAgreement: true },
  );

  // 2. getProject ─ GET /api/v1/projects/:id ─────────────────────────────────
  registry.register(
    'getProject',
    async (ctx: RouteContext) => {
      const userId = await resolveFormalUserId(ctx, { userRepo: deps.userRepo });
      await requireProjectCapability(formalUserActor(userId), ctx.db.db, ctx.params.id, 'read');
      const project = deps.projectRepo.findById(ctx.params.id);
      if (!project) {
        throw ApiError.notFound('Project not found', 'project');
      }
      return mapProject(project);
    },
    { requireActor: 'any' },
  );

  // 3. updateProject ─ PATCH /api/v1/projects/:id ────────────────────────────
  registry.register(
    'updateProject',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      if (
        typeof body.expected_version !== 'number' ||
        !Number.isInteger(body.expected_version)
      ) {
        throw ApiError.validationError({
          expected_version: 'required integer',
        });
      }

      const updated = deps.projectRepo.update(ctx.params.id, {
        name: typeof body.name === 'string' ? body.name : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        riskLevel: typeof body.risk_level === 'string' ? body.risk_level : undefined,
        expectedVersion: body.expected_version,
      });
      return mapProjectSummary(updated);
    },
    { requireActor: 'user' },
  );

  // 4. deleteProject ─ DELETE /api/v1/projects/:id ───────────────────────────
  registry.register(
    'deleteProject',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      // Only the Owner (manage_members capability) may delete.
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        ctx.params.id,
        'manage_members',
      );

      const projectId = ctx.params.id;
      const userId = ctx.actor.userId!;
      const ts = now();
      const estimatedPurgeAt = addDays(ts, 30);
      const deleteTaskId = generateId('dt');

      ctx.db.db
        .insert(deleteTasks)
        .values({
          id: deleteTaskId,
          scope: 'formal_project',
          targetId: projectId,
          requesterType: 'user',
          requesterId: userId,
          status: 'pending',
          legalHold: 0,
          estimatedPurgeAt,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();

      return {
        data: {
          delete_task_id: deleteTaskId,
          scope: 'formal_project',
          target_id: projectId,
          status: 'pending',
          estimated_purge_at: estimatedPurgeAt,
        },
        meta: {},
        statusCode: 202,
      };
    },
    { requireActor: 'user' },
  );

  // 5. getDeleteTask ─ GET /api/v1/delete-tasks/:id ──────────────────────────
  registry.register(
    'getDeleteTask',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const row = ctx.db.db
        .select()
        .from(deleteTasks)
        .where(eq(deleteTasks.id, ctx.params.id))
        .get();
      if (!row) {
        throw ApiError.notFound('Delete task not found', 'delete_task');
      }
      return {
        delete_task_id: row.id,
        scope: row.scope,
        target_id: row.targetId,
        status: row.status,
        legal_hold: row.legalHold === 1,
        legal_hold_reason: row.legalHoldReason,
        failure_reason: row.failureReason,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        completed_at: row.completedAt,
        estimated_purge_at: row.estimatedPurgeAt,
      };
    },
    { requireActor: 'user' },
  );

  // 6. createIntake ─ POST /api/v1/projects/:id/intakes ──────────────────────
  registry.register(
    'createIntake',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');
      const body = ctx.body ?? {};
      if (
        typeof body.original_text !== 'string' ||
        body.original_text.trim().length === 0
      ) {
        throw ApiError.validationError({
          original_text: 'must be a non-empty string',
        });
      }
      if (typeof body.supersedes_intake_id !== 'string') {
        throw ApiError.validationError({
          supersedes_intake_id: 'required string',
        });
      }

      const intake = deps.intakeRepo.create({
        projectId: ctx.params.id,
        originalText: body.original_text,
        decisionIntent:
          typeof body.decision_intent === 'string' ? body.decision_intent : undefined,
        selectedWorkType:
          typeof body.selected_work_type === 'string'
            ? body.selected_work_type
            : undefined,
        candidateRoles: Array.isArray(body.candidate_roles) ? body.candidate_roles : [],
        candidateConstraints: Array.isArray(body.candidate_constraints)
          ? body.candidate_constraints
          : [],
        submittedBy: ctx.actor.userId!,
      });

      return {
        id: intake.id,
        project_id: intake.projectId,
        intake_version: intake.intakeVersion,
        original_text: intake.originalText,
        decision_intent: intake.decisionIntent,
        selected_work_type: intake.selectedWorkType,
        candidate_roles: JSON.parse(intake.candidateRolesJson),
        candidate_constraints: JSON.parse(intake.candidateConstraintsJson),
        supersedes_intake_id: intake.supersedesIntakeId,
        content_hash: intake.contentHash,
        submitted_by: intake.submittedBy,
        created_at: intake.createdAt,
      };
    },
    { requireActor: 'user' },
  );

  // 7. listMembers ─ GET /api/v1/projects/:id/members ────────────────────────
  registry.register(
    'listMembers',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');

      const { items, nextCursor } = deps.memberRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
      });

      const data = await Promise.all(
        items.map((m) =>
          mapMember(
            {
              userId: m.userId,
              capabilitiesJson: m.capabilitiesJson,
              status: m.status,
              grantedBy: m.grantedBy,
              createdAt: m.createdAt,
              updatedAt: m.updatedAt,
              version: m.version,
            },
            deps.userRepo,
          ),
        ),
      );

      return paginatedResponse(data, nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 8. addMember ─ POST /api/v1/projects/:id/members ─────────────────────────
  registry.register(
    'addMember',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        ctx.params.id,
        'manage_members',
      );
      const body = ctx.body ?? {};
      if (typeof body.user_id !== 'string' || body.user_id.length === 0) {
        throw ApiError.validationError({ user_id: 'required string' });
      }
      if (!Array.isArray(body.capabilities)) {
        throw ApiError.validationError({ capabilities: 'required string array' });
      }

      const targetUser = await deps.userRepo.findById(body.user_id);
      if (!targetUser) {
        throw ApiError.validationError({ user_id: 'user not found' });
      }

      const member = deps.memberRepo.add({
        projectId: ctx.params.id,
        userId: body.user_id,
        capabilities: body.capabilities,
        grantedBy: ctx.actor.userId!,
      });

      return mapMember(
        {
          userId: member.userId,
          capabilitiesJson: member.capabilitiesJson,
          status: member.status,
          grantedBy: member.grantedBy,
          createdAt: member.createdAt,
          updatedAt: member.updatedAt,
          version: member.version,
        },
        deps.userRepo,
      );
    },
    { requireActor: 'user' },
  );

  // 9. updateMember ─ PATCH /api/v1/projects/:id/members/:userId ─────────────
  registry.register(
    'updateMember',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        ctx.params.id,
        'manage_members',
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

      const updated = deps.memberRepo.update(ctx.params.id, ctx.params.userId, {
        capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined,
        status: typeof body.status === 'string' ? body.status : undefined,
        expectedVersion: body.expected_version,
      });

      return mapMember(
        {
          userId: updated.userId,
          capabilitiesJson: updated.capabilitiesJson,
          status: updated.status,
          grantedBy: updated.grantedBy,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          version: updated.version,
        },
        deps.userRepo,
      );
    },
    { requireActor: 'user' },
  );

  // 10. listSources ─ GET /api/v1/projects/:id/sources ───────────────────────
  registry.register(
    'listSources',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'read');

      const { items, nextCursor } = deps.sourceRepo.listByProject(ctx.params.id, {
        limit: ctx.query.limit,
        cursor: ctx.query.cursor,
      });

      // Join blob byte_size for each source.
      const blobIds = items.map((s) => s.blobId);
      const blobRows =
        blobIds.length > 0
          ? ctx.db.db
              .select({ id: blobs.id, byteSize: blobs.byteSize })
              .from(blobs)
              .where(inArray(blobs.id, blobIds))
              .all()
          : [];
      const blobSize = new Map(blobRows.map((b) => [b.id, b.byteSize]));

      const data = items.map((s) => ({
        id: s.id,
        file_name: s.fileName,
        media_type: s.mediaType,
        source_type: s.sourceType,
        sensitivity: s.sensitivity,
        extraction_status: s.extractionStatus,
        byte_size: blobSize.get(s.blobId) ?? 0,
        created_by: s.createdBy,
        created_at: s.createdAt,
      }));

      return paginatedResponse(data, nextCursor ?? undefined);
    },
    { requireActor: 'user' },
  );

  // 11. uploadSource ─ POST /api/v1/projects/:id/sources ─────────────────────
  registry.register(
    'uploadSource',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'edit');

      // The OpenAPI spec declares multipart/form-data, but the route registry
      // does not parse multipart bodies. For Stage B the handler accepts a JSON
      // body with the same fields so the core logic (whitelist, signature
      // check, hash, blob+source creation) is exercised end-to-end. Production
      // multipart wiring requires @fastify/multipart (TODO Task 20).
      const body = ctx.body ?? {};
      const fileName = typeof body.file_name === 'string' ? body.file_name : undefined;
      const mediaType =
        typeof body.media_type === 'string' ? body.media_type : undefined;
      const sourceType =
        typeof body.source_type === 'string' ? body.source_type : 'document';
      const sensitivity =
        typeof body.sensitivity === 'string' ? body.sensitivity : 'internal';
      const author =
        typeof body.author === 'string' ? body.author : null;
      const capturedAt =
        typeof body.captured_at === 'string' ? body.captured_at : null;

      if (!fileName) {
        throw ApiError.validationError({ file_name: 'required string' });
      }
      if (!mediaType) {
        throw ApiError.validationError({ media_type: 'required string' });
      }
      if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
        throw ApiError.validationError(
          { media_type: mediaType },
          '不支持的文件类型。允许：PDF、DOCX、TXT、MD、CSV、PNG、JPEG。',
        );
      }

      const content = typeof body.content === 'string' ? body.content : '';
      const bytes = Buffer.from(content, 'utf-8');

      if (bytes.length > MAX_FILE_BYTES) {
        throw ApiError.validationError(
          { file: `exceeds ${MAX_FILE_BYTES} bytes` },
          '文件大小超过限制。',
        );
      }

      // File-signature (magic-byte) validation.
      const rule = SIGNATURE_RULES[mediaType];
      if (rule) {
        const sigHex = bytes.subarray(0, rule.hex.length / 2).toString('hex');
        if (sigHex !== rule.hex) {
          throw ApiError.validationError(
            { file: `expected signature ${rule.label}` },
            '文件签名与声明类型不匹配。',
          );
        }
      }

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const blob = deps.sourceRepo.createBlob({
        sha256,
        size: bytes.length,
        mediaType,
        storagePath: `blobs/${sha256}`,
      });
      const source = deps.sourceRepo.create({
        projectId: ctx.params.id,
        blobId: blob.id,
        filename: fileName,
        mediaType,
        sourceType,
        sensitivity,
        author,
        capturedAt,
        submittedBy: ctx.actor.userId!,
      });

      return {
        id: source.id,
        project_id: source.projectId,
        file_name: source.fileName,
        media_type: source.mediaType,
        source_type: source.sourceType,
        author: source.author,
        captured_at: source.capturedAt,
        sensitivity: source.sensitivity,
        extraction_status: source.extractionStatus,
        blob_id: source.blobId,
        byte_size: blob.byteSize,
        sha256: blob.sha256,
        created_by: source.createdBy,
        created_at: source.createdAt,
      };
    },
    { requireActor: 'user' },
  );

  // 12. getEvidence ─ GET /api/v1/evidence/:id ───────────────────────────────
  // Note: the OpenAPI spec mounts this at /evidence/{id} (not /projects/:id/
  // evidence). The handler resolves the evidence span → source → project, then
  // enforces read capability on the owning project.
  registry.register(
    'getEvidence',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);

      // EvidenceRepo has no findById, so query the table directly.
      const row = ctx.db.db
        .select()
        .from(evidenceSpans)
        .where(eq(evidenceSpans.id, ctx.params.id))
        .get();
      if (!row) {
        throw ApiError.notFound('Evidence span not found', 'evidence_span');
      }

      // Resolve source → project for capability check.
      const sourceRow = deps.sourceRepo.findById(row.sourceId);
      if (!sourceRow) {
        throw ApiError.notFound('Source not found', 'source');
      }
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        sourceRow.projectId,
        'read',
      );

      return {
        id: row.id,
        source_id: row.sourceId,
        page: row.page,
        section: row.section,
        coordinate_space: row.coordinateSpace,
        start_offset: row.startOffset,
        end_offset: row.endOffset,
        exact_text: row.exactText,
        normalized_text: row.normalizedText,
        span_hash: row.spanHash,
        created_at: row.createdAt,
      };
    },
    { requireActor: 'user' },
  );
}
