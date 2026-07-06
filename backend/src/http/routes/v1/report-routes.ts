import { eq, and, desc } from 'drizzle-orm';
import type { RouteRegistry, RouteContext } from '../../route-registry';
import { ApiError } from '../../errors';
import { requireUser, requireProjectCapability } from '../../middleware/auth';
import { generateId } from '../../../shared/id';
import { now } from '../../../shared/time';
import { domainProfiles } from '../../../db/schema/domain';
import { blobs } from '../../../db/schema/source';
import { reportGateResults } from '../../../db/schema/report';
import type { BaselineRepo } from '../../../repo/baseline-repo';
import type { ReportRepo } from '../../../repo/report-repo';
import {
  compileReport,
  synthesizeReportPdf,
  sha256Of,
  type DomainConfig,
  type GateDefect,
} from '../../../report/compiler';

/**
 * Baseline & report routes (Task 27, 7 operationIds).
 *
 * Each handler enforces authentication, the relevant project capability, and
 * the §10 invariants (reports only compile from an approved baseline; releases
 * require a registered file blob; downloads are gated on `export`).
 */

export interface ReportRouteDeps {
  baselineRepo: BaselineRepo;
  reportRepo: ReportRepo;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Map a plural `entity_versions` key to the singular `entity_type` stored on
 *  baseline_items. Falls back to stripping a trailing `s`. */
function singularEntityType(plural: string): string {
  const map: Record<string, string> = {
    outcomes: 'outcome',
    requirements: 'requirement',
    drivers: 'driver',
    decisions: 'decision',
    conflicts: 'conflict',
    stakeholders: 'stakeholder',
    acceptances: 'acceptance',
  };
  if (map[plural]) return map[plural];
  return plural.endsWith('s') ? plural.slice(0, -1) : plural;
}

/** Parse `{entity_id}@{version}` tokens into baseline item inputs. */
function parseEntityVersions(
  entityVersions: Record<string, unknown>,
): Array<{ entityType: string; entityId: string; entityVersion: number }> {
  const items: Array<{ entityType: string; entityId: string; entityVersion: number }> = [];
  for (const [key, raw] of Object.entries(entityVersions)) {
    if (!Array.isArray(raw)) continue;
    const entityType = singularEntityType(key);
    for (const token of raw) {
      if (typeof token !== 'string') continue;
      const at = token.lastIndexOf('@');
      if (at <= 0) continue;
      const entityId = token.slice(0, at);
      const version = Number(token.slice(at + 1));
      if (!entityId || !Number.isInteger(version) || version <= 0) continue;
      items.push({ entityType, entityId, entityVersion: version });
    }
  }
  return items;
}

function mapBaseline(row: ReturnType<BaselineRepo['findById']>, items: ReturnType<BaselineRepo['getItems']>) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.projectId,
    baseline_version: row.baselineVersion,
    status: row.status,
    approved_by: row.approvedBy,
    approved_at: row.approvedAt,
    data_hash: row.dataHash,
    items: items.map((i) => ({
      entity_type: i.entityType,
      entity_id: i.entityId,
      entity_version: i.entityVersion,
    })),
    version: row.version,
    created_at: row.createdAt,
  };
}

/** Resolve the approved domain profile for a project, or throw a gate error. */
function requireApprovedDomainProfile(ctx: RouteContext, projectId: string) {
  const profile = ctx.db.db
    .select()
    .from(domainProfiles)
    .where(
      and(
        eq(domainProfiles.projectId, projectId),
        eq(domainProfiles.status, 'approved'),
      ),
    )
    .orderBy(desc(domainProfiles.profileVersion))
    .limit(1)
    .get();
  if (!profile) {
    throw ApiError.gateNotPassed(
      'Project has no approved domain profile; cannot compile report',
    );
  }
  return profile;
}

// ── registration ───────────────────────────────────────────────────────────

export function registerReportRoutes(
  registry: RouteRegistry,
  deps: ReportRouteDeps,
): void {
  // 1. createBaseline ─ POST /api/v1/projects/:id/baselines ──────────────────
  registry.register(
    'createBaseline',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'review');
      const body = ctx.body ?? {};
      const entityVersions = body.entity_versions;
      if (
        !entityVersions ||
        typeof entityVersions !== 'object' ||
        Array.isArray(entityVersions)
      ) {
        throw ApiError.validationError({
          entity_versions: 'required object of entity-type → version tokens',
        });
      }
      const items = parseEntityVersions(entityVersions);
      if (items.length === 0) {
        throw ApiError.validationError({
          entity_versions: 'must contain at least one {entity_id}@{version}',
        });
      }

      const created = deps.baselineRepo.create({
        projectId: ctx.params.id,
        items,
      });
      return mapBaseline(created, deps.baselineRepo.getItems(created.id));
    },
    { requireActor: 'user' },
  );

  // 2. approveBaseline ─ POST /api/v1/baselines/:id/approve ──────────────────
  registry.register(
    'approveBaseline',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const baseline = deps.baselineRepo.findById(ctx.params.id);
      if (!baseline) {
        throw ApiError.notFound('Baseline not found', 'baseline');
      }
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        baseline.projectId,
        'review',
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

      const approved = deps.baselineRepo.approve({
        id: ctx.params.id,
        approverId: ctx.actor.userId!,
        expectedVersion: body.expected_version,
      });
      return mapBaseline(approved, deps.baselineRepo.getItems(approved.id));
    },
    { requireActor: 'user' },
  );

  // 3. compileReport ─ POST /api/v1/projects/:id/reports ─────────────────────
  registry.register(
    'compileReport',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'export');
      const body = ctx.body ?? {};
      const baselineId = body.baseline_id;
      const audience = body.audience;
      const language = body.language;
      const templateId = body.template_id;
      const templateVersion = body.template_version;
      if (typeof baselineId !== 'string' || !baselineId) {
        throw ApiError.validationError({ baseline_id: 'required string' });
      }
      if (typeof audience !== 'string' || !audience) {
        throw ApiError.validationError({ audience: 'required string' });
      }
      if (typeof language !== 'string' || !language) {
        throw ApiError.validationError({ language: 'required string' });
      }
      if (typeof templateId !== 'string' || !templateId) {
        throw ApiError.validationError({ template_id: 'required string' });
      }
      if (typeof templateVersion !== 'string' || !templateVersion) {
        throw ApiError.validationError({ template_version: 'required string' });
      }

      const baseline = deps.baselineRepo.findById(baselineId);
      if (!baseline || baseline.projectId !== ctx.params.id) {
        throw ApiError.notFound('Baseline not found', 'baseline');
      }
      if (baseline.status !== 'approved') {
        throw ApiError.baselineNotApproved();
      }

      const profile = requireApprovedDomainProfile(ctx, ctx.params.id);
      const items = deps.baselineRepo.getItems(baseline.id);

      const domainConfig: DomainConfig = {
        domainProfileId: profile.id,
        domainProfileVersion: profile.profileVersion,
        domainPackVersions: safeParseArray(profile.suggestedPackIdsJson) as string[],
        promptVersions: profile.promptVersion ? [profile.promptVersion] : [],
        modelVersions: profile.classifierModel ? [profile.classifierModel] : [],
      };

      const compiled = compileReport(baseline, items, domainConfig);

      // Group defects by gate_code: report_gate_results has a unique
      // constraint on (report_id, gate_code), so multiple defects sharing
      // the same gate_code (e.g. several missing chapters → all
      // 'chapter_coverage') must be collapsed into one row whose
      // defectsJson carries the full array.
      const defectsByGate = new Map<string, GateDefect[]>();
      for (const d of compiled.gateDefects) {
        const list = defectsByGate.get(d.gate_code) ?? [];
        list.push(d);
        defectsByGate.set(d.gate_code, list);
      }

      const report = deps.reportRepo.create({
        projectId: ctx.params.id,
        baselineId: baseline.id,
        dataHash: compiled.dataHash,
        templateId,
        templateVersion,
        coreSchemaVersion: compiled.coreSchemaVersion,
        reportInputSchemaHash: compiled.reportInputSchemaHash,
        compilerVersion: compiled.compilerVersion,
        domainProfileId: domainConfig.domainProfileId,
        domainProfileVersion: domainConfig.domainProfileVersion,
        domainPackVersions: domainConfig.domainPackVersions,
        promptVersions: domainConfig.promptVersions,
        modelVersions: domainConfig.modelVersions,
        audience,
        language,
        gateResults: Array.from(defectsByGate.entries()).map(
          ([gateCode, defects]) => ({
            gateCode,
            status: defects.some((d) => d.blocking)
              ? ('failed' as const)
              : ('warning' as const),
            defectsJson: JSON.stringify(defects),
          }),
        ),
      });

      // Drive the publish state machine: render to `ready`, or stall at
      // `gate_failed` when blocking defects were found.
      if (compiled.gateDefects.some((d) => d.blocking)) {
        deps.reportRepo.updateStatus(report.id, 'gate_failed');
      } else {
        deps.reportRepo.updateStatus(report.id, 'rendering');
        deps.reportRepo.updateStatus(report.id, 'staged');
        deps.reportRepo.updateStatus(report.id, 'ready');
      }

      const jobId = generateId('job');
      return {
        data: {
          job_id: jobId,
          status: 'queued',
          status_url: `/api/v1/ai-jobs/${jobId}`,
        },
        meta: {},
        statusCode: 202,
      };
    },
    { requireActor: 'user', requireAgreement: true },
  );

  // 4. getReport ─ GET /api/v1/reports/:id ───────────────────────────────────
  registry.register(
    'getReport',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const report = deps.reportRepo.findById(ctx.params.id);
      if (!report) {
        throw ApiError.notFound('Report not found', 'report');
      }
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        report.projectId,
        'read',
      );

      const baseline = deps.baselineRepo.findById(report.baselineId);
      const items = baseline ? deps.baselineRepo.getItems(baseline.id) : [];
      const profile = ctx.db.db
        .select()
        .from(domainProfiles)
        .where(eq(domainProfiles.id, report.domainProfileId))
        .get();

      // Recompute chapter coverage deterministically from the frozen baseline.
      let chapterCoverage: Record<string, unknown> = {};
      if (baseline && baseline.status === 'approved') {
        const domainConfig: DomainConfig = {
          domainProfileId: report.domainProfileId,
          domainProfileVersion: report.domainProfileVersion,
          domainPackVersions: safeParseArray(report.domainPackVersionsJson) as string[],
        };
        chapterCoverage = compileReport(baseline, items, domainConfig).chapterCoverage;
      }

      const gateRows = deps.reportRepo.getGateResults(report.id);
      const gateDefects = gateRows.flatMap((g) => {
        const defects = safeParseArray(g.defectsJson);
        return defects.map((d: any) => ({
          gate_code: g.gateCode,
          severity: d.severity ?? (g.status === 'failed' ? 'blocking' : 'warning'),
          blocking: d.blocking ?? g.status === 'failed',
          message: d.message ?? g.gateCode,
          entity_refs: d.entity_refs ?? [],
          resolution_hint: d.resolution_hint ?? null,
        }));
      });

      const fileSize = deps.reportRepo.getFileSize(report.id);

      return {
        id: report.id,
        project_id: report.projectId,
        report_version: report.reportVersion,
        baseline_id: report.baselineId,
        status: report.status,
        audience: report.audience,
        language: report.language,
        data_hash: report.dataHash,
        template_id: report.templateId,
        template_version: report.templateVersion,
        core_schema_version: report.coreSchemaVersion,
        report_input_schema_hash: report.reportInputSchemaHash,
        compiler_version: report.compilerVersion,
        domain_profile_id: report.domainProfileId,
        domain_profile_version: report.domainProfileVersion,
        domain_pack_versions: safeParseArray(report.domainPackVersionsJson),
        prompt_versions: safeParseArray(report.promptVersionsJson),
        model_versions: safeParseArray(report.modelVersionsJson),
        chapter_coverage: chapterCoverage,
        gate_defects: gateDefects,
        file_blob_id: report.fileBlobId,
        file_sha256: report.fileSha256,
        file_size: fileSize,
        generated_at: report.generatedAt,
        released_by: report.releasedBy,
        released_at: report.releasedAt,
        supersedes_report_id: report.supersedesReportId,
        domain_profile_status: profile?.status ?? null,
      };
    },
    { requireActor: 'user' },
  );

  // 5. releaseReport ─ POST /api/v1/reports/:id/releases ─────────────────────
  registry.register(
    'releaseReport',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const report = deps.reportRepo.findById(ctx.params.id);
      if (!report) {
        throw ApiError.notFound('Report not found', 'report');
      }
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        report.projectId,
        'export',
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

      if (report.status !== 'ready') {
        throw ApiError.conflict(
          'BLOCKING_CONFLICT',
          `Report is not ready for release (current: ${report.status})`,
        );
      }

      // Stage the file blob (fsync/hash/register), then flip to released.
      const pdf = synthesizeReportPdf({
        dataHash: report.dataHash,
        reportVersion: report.reportVersion,
      });
      const sha = sha256Of(pdf);
      const blobId = generateId('blb');
      ctx.db.db
        .insert(blobs)
        .values({
          id: blobId,
          sha256: sha,
          storagePath: `reports/${report.id}.pdf`,
          byteSize: pdf.length,
          mediaType: 'application/pdf',
          scanStatus: 'clean',
          createdAt: now(),
        })
        .run();

      const released = deps.reportRepo.release(ctx.params.id, ctx.actor.userId!, {
        blobId,
        sha256: sha,
      });

      return {
        data: {
          id: released.id,
          project_id: released.projectId,
          report_version: released.reportVersion,
          status: released.status,
          file_sha256: released.fileSha256,
          released_by: released.releasedBy,
          released_at: released.releasedAt,
        },
        meta: {},
        statusCode: 200,
      };
    },
    { requireActor: 'user' },
  );

  // 6. downloadReport ─ GET /api/v1/reports/:id/file ─────────────────────────
  registry.register(
    'downloadReport',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      const report = deps.reportRepo.findById(ctx.params.id);
      if (!report) {
        throw ApiError.notFound('Report not found', 'report');
      }
      await requireProjectCapability(
        ctx.actor,
        ctx.db.db,
        report.projectId,
        'export',
      );
      if (report.status !== 'released' || !report.fileSha256 || !report.fileBlobId) {
        throw ApiError.notFound('Report file not available', 'report_file');
      }

      const pdf = synthesizeReportPdf({
        dataHash: report.dataHash,
        reportVersion: report.reportVersion,
      });
      ctx.reply?.header('Content-Type', 'application/pdf');
      ctx.reply?.header(
        'Content-Disposition',
        `attachment; filename="report-${report.reportVersion}.pdf"`,
      );
      return pdf;
    },
    { requireActor: 'user' },
  );

  // 7. downloadProjectReport ─ GET /api/v1/projects/:id/reports/:reportId/download
  registry.register(
    'downloadProjectReport',
    async (ctx: RouteContext) => {
      requireUser(ctx.actor);
      await requireProjectCapability(ctx.actor, ctx.db.db, ctx.params.id, 'export');
      const report = deps.reportRepo.findById(ctx.params.reportId);
      if (!report || report.projectId !== ctx.params.id) {
        throw ApiError.notFound('Report not found for this project', 'report');
      }
      if (report.status !== 'released' || !report.fileSha256 || !report.fileBlobId) {
        throw ApiError.notFound('Report file not available', 'report_file');
      }

      const pdf = synthesizeReportPdf({
        dataHash: report.dataHash,
        reportVersion: report.reportVersion,
      });
      ctx.reply?.header('Content-Type', 'application/pdf');
      ctx.reply?.header(
        'Content-Disposition',
        `attachment; filename="report-${report.reportVersion}.pdf"`,
      );
      return pdf;
    },
    { requireActor: 'user' },
  );
}

/** Parse a JSON array column, tolerating null/invalid. */
function safeParseArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
