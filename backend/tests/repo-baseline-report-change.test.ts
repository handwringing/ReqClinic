import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type AppDb } from './helpers/test-db';
import { ProjectRepo } from '../src/repo/project-repo';
import { BaselineRepo } from '../src/repo/baseline-repo';
import { ReportRepo, type CreateReportInput } from '../src/repo/report-repo';
import { ChangeRepo } from '../src/repo/change-repo';
import { ApiError } from '../src/http/errors';
import { generateId } from '../src/shared/id';
import { now } from '../src/shared/time';
import { projects } from '../src/db/schema/project';
import { domainProfiles } from '../src/db/schema/domain';
import { reportTemplates } from '../src/db/schema/report';
import { blobs } from '../src/db/schema/source';
import { changes, changeImpacts, baselines } from '../src/db/schema';

/**
 * Repository-level tests for the baseline / report / change domain (Task 26).
 *
 * Covers the three load-bearing invariants called out in the task spec:
 *   1. baseline immutability — approved baselines cannot be re-approved, only
 *      superseded by approving a newer draft;
 *   2. report state machine — §10.7 transitions enforced, release supersedes
 *      the prior released snapshot;
 *   3. preview isolation — previews write `change_impacts` with `preview_id`
 *      only and never mutate formal baselines or the `changes` table.
 */
describe('baseline / report / change repos (Task 26)', () => {
  let db: AppDb;
  let projectRepo: ProjectRepo;
  let baselineRepo: BaselineRepo;
  let reportRepo: ReportRepo;
  let changeRepo: ChangeRepo;

  let ownerId: string;
  let projectId: string;
  let domainProfileId: string;

  beforeAll(() => {
    db = createTestDb();
    projectRepo = new ProjectRepo(db.db);
    baselineRepo = new BaselineRepo(db.db);
    reportRepo = new ReportRepo(db.db);
    changeRepo = new ChangeRepo(db.db);

    ownerId = 'usr_baseline_owner';
    db.raw
      .prepare(
        `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(ownerId, 'Baseline Owner', 'auth|blowner', 'active', now(), now());

    const project = projectRepo.create({ ownerId, name: '基线/报告/变化测试项目' });
    projectId = project.id;

    // Seed an approved domain profile (reports require one).
    domainProfileId = generateId('dpr');
    const ts = now();
    db.db
      .insert(domainProfiles)
      .values({
        id: domainProfileId,
        projectId,
        profileVersion: 1,
        workType: 'software_delivery',
        domainLabelsJson: '[]',
        riskFlagsJson: '[]',
        terminologyMapJson: '{}',
        suggestedPackIdsJson: '["general"]',
        requiredHumanRolesJson: '[]',
        routingRisk: 'low',
        routingBasisJson: '{}',
        rationaleEvidenceLinksJson: '[]',
        unknownsJson: '[]',
        status: 'approved',
        classifierModel: 'stub-classifier-v1',
        promptVersion: 'prompt-v1.0.0',
        approvedBy: ownerId,
        approvedAt: ts,
        createdAt: ts,
      })
      .run();

    // Seed a report template (composite FK target for report_snapshots).
    db.db
      .insert(reportTemplates)
      .values({
        id: 'tmpl_standard',
        audience: 'executive',
        version: '1.0.0',
        contentHash: 'sha256:template',
        status: 'active',
        createdAt: ts,
      })
      .run();
  });

  // ── BaselineRepo ───────────────────────────────────────────────────────────

  describe('BaselineRepo — immutability & supersession', () => {
    it('creates a draft baseline with frozen items and a data hash', () => {
      const created = baselineRepo.create({
        projectId,
        items: [
          { entityType: 'requirement', entityId: 'req_001', entityVersion: 2 },
          { entityType: 'outcome', entityId: 'out_001', entityVersion: 1 },
        ],
      });

      expect(created.id).toMatch(/^bl_/);
      expect(created.status).toBe('draft');
      expect(created.baselineVersion).toBe(1);
      expect(created.version).toBe(1);
      expect(created.dataHash).toMatch(/^sha256:/);
      expect(created.approvedBy).toBeNull();
      expect(created.approvedAt).toBeNull();

      const items = baselineRepo.getItems(created.id);
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.entityType).sort()).toEqual(['outcome', 'requirement']);
      expect(items.every((i) => i.snapshotHash === created.dataHash)).toBe(true);
    });

    it('approves a draft baseline one-shot and records approver/time', () => {
      const baseline = baselineRepo.create({
        projectId,
        items: [{ entityType: 'requirement', entityId: 'req_002', entityVersion: 1 }],
      });

      const approved = baselineRepo.approve({
        id: baseline.id,
        approverId: ownerId,
        expectedVersion: baseline.version,
      });
      expect(approved.status).toBe('approved');
      expect(approved.approvedBy).toBe(ownerId);
      expect(approved.approvedAt).toBeTruthy();
      expect(approved.version).toBe(baseline.version + 1);

      // findApproved returns it.
      const found = baselineRepo.findApproved(projectId);
      expect(found?.id).toBe(approved.id);
    });

    it('rejects re-approving an already-approved baseline (BASELINE_NOT_DRAFT)', () => {
      const baseline = baselineRepo.create({
        projectId,
        items: [{ entityType: 'requirement', entityId: 'req_003', entityVersion: 1 }],
      });
      const approved = baselineRepo.approve({
        id: baseline.id,
        approverId: ownerId,
        expectedVersion: baseline.version,
      });

      expect(() =>
        baselineRepo.approve({
          id: approved.id,
          approverId: ownerId,
          expectedVersion: approved.version,
        }),
      ).toThrow(ApiError);
      try {
        baselineRepo.approve({
          id: approved.id,
          approverId: ownerId,
          expectedVersion: approved.version,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('BASELINE_NOT_DRAFT');
        expect((err as ApiError).statusCode).toBe(409);
      }
    });

    it('rejects approval with a stale expected_version (VERSION_CONFLICT)', () => {
      const baseline = baselineRepo.create({
        projectId,
        items: [{ entityType: 'requirement', entityId: 'req_004', entityVersion: 1 }],
      });
      expect(() =>
        baselineRepo.approve({
          id: baseline.id,
          approverId: ownerId,
          expectedVersion: baseline.version + 999,
        }),
      ).toThrow(ApiError);
    });

    it('supersedes the prior approved baseline when a newer draft is approved', () => {
      const v1 = baselineRepo.create({
        projectId,
        items: [{ entityType: 'requirement', entityId: 'req_sup_1', entityVersion: 1 }],
      });
      const v1Approved = baselineRepo.approve({
        id: v1.id,
        approverId: ownerId,
        expectedVersion: v1.version,
      });
      expect(v1Approved.status).toBe('approved');

      const v2 = baselineRepo.create({
        projectId,
        items: [{ entityType: 'requirement', entityId: 'req_sup_2', entityVersion: 1 }],
      });
      const v2Approved = baselineRepo.approve({
        id: v2.id,
        approverId: ownerId,
        expectedVersion: v2.version,
      });
      expect(v2Approved.status).toBe('approved');

      // v1 is now superseded; findApproved returns only v2.
      const v1Now = baselineRepo.findById(v1.id);
      expect(v1Now?.status).toBe('superseded');
      const latest = baselineRepo.findApproved(projectId);
      expect(latest?.id).toBe(v2.id);

      // At most one approved baseline for the project.
      const approvedRows = db.db
        .select()
        .from(baselines)
        .where(eq(baselines.projectId, projectId))
        .all()
        .filter((b) => b.status === 'approved');
      expect(approvedRows).toHaveLength(1);
    });

    it('returns null for a missing baseline', () => {
      expect(baselineRepo.findById('bl_does_not_exist')).toBeNull();
      expect(baselineRepo.getItems('bl_does_not_exist')).toEqual([]);
    });
  });

  // ── ReportRepo — state machine ─────────────────────────────────────────────

  describe('ReportRepo — §10.7 state machine', () => {
    let approvedBaselineId: string;

    beforeAll(() => {
      const baseline = baselineRepo.create({
        projectId,
        items: [{ entityType: 'requirement', entityId: 'req_report', entityVersion: 1 }],
      });
      approvedBaselineId = baselineRepo.approve({
        id: baseline.id,
        approverId: ownerId,
        expectedVersion: baseline.version,
      }).id;
    });

    function makeReportInput(): CreateReportInput {
      return {
        projectId,
        baselineId: approvedBaselineId,
        dataHash: 'sha256:report-data',
        templateId: 'tmpl_standard',
        templateVersion: '1.0.0',
        coreSchemaVersion: '1.0.0',
        reportInputSchemaHash: 'sha256:input-schema',
        compilerVersion: 'compiler-v1.0.0',
        domainProfileId,
        domainProfileVersion: 1,
        domainPackVersions: ['general'],
        audience: 'executive',
        language: 'zh-CN',
      };
    }

    it('creates a draft report with version 1 and seeds gate results', () => {
      const report = reportRepo.create({
        ...makeReportInput(),
        gateResults: [{ gateCode: 'chapter_coverage', status: 'passed' }],
      });
      expect(report.id).toMatch(/^rpt_/);
      expect(report.status).toBe('draft');
      expect(report.reportVersion).toBe(1);
      expect(report.fileBlobId).toBeNull();
      expect(report.fileSha256).toBeNull();

      const gates = reportRepo.getGateResults(report.id);
      expect(gates).toHaveLength(1);
      expect(gates[0].gateCode).toBe('chapter_coverage');
      expect(gates[0].status).toBe('passed');
    });

    it('drives the happy-path state machine draft → rendering → staged → ready', () => {
      const report = reportRepo.create(makeReportInput());
      expect(reportRepo.updateStatus(report.id, 'rendering').status).toBe('rendering');
      expect(reportRepo.updateStatus(report.id, 'staged').status).toBe('staged');
      expect(reportRepo.updateStatus(report.id, 'ready').status).toBe('ready');
    });

    it('rejects an invalid transition (draft → ready) with INVALID_REPORT_TRANSITION', () => {
      const report = reportRepo.create(makeReportInput());
      expect(() => reportRepo.updateStatus(report.id, 'ready')).toThrow(ApiError);
      try {
        reportRepo.updateStatus(report.id, 'ready');
      } catch (err) {
        expect((err as ApiError).code).toBe('INVALID_REPORT_TRANSITION');
      }
    });

    it('recovers from publish_failed via rendering (retry path)', () => {
      const report = reportRepo.create(makeReportInput());
      reportRepo.updateStatus(report.id, 'rendering');
      reportRepo.updateStatus(report.id, 'staged');
      reportRepo.updateStatus(report.id, 'ready');
      // Publish fails.
      reportRepo.updateStatus(report.id, 'publish_failed');
      // Retry from rendering.
      expect(reportRepo.updateStatus(report.id, 'rendering').status).toBe('rendering');
      reportRepo.updateStatus(report.id, 'staged');
      reportRepo.updateStatus(report.id, 'ready');
    });

    it('releases a ready report with a file blob and supersedes the prior released', () => {
      // Seed the blob rows that report_snapshots.file_blob_id references (FK).
      const blobTs = now();
      for (const [bid, sha] of [['blb_r1', 'sha256:r1file'], ['blb_r2', 'sha256:r2file']] as const) {
        db.db
          .insert(blobs)
          .values({
            id: bid,
            sha256: sha,
            storagePath: `reports/${bid}.pdf`,
            byteSize: 1024,
            mediaType: 'application/pdf',
            scanStatus: 'clean',
            createdAt: blobTs,
          })
          .run();
      }

      const r1 = reportRepo.create(makeReportInput());
      reportRepo.updateStatus(r1.id, 'rendering');
      reportRepo.updateStatus(r1.id, 'staged');
      reportRepo.updateStatus(r1.id, 'ready');
      const released1 = reportRepo.release(r1.id, ownerId, {
        blobId: 'blb_r1',
        sha256: 'sha256:r1file',
      });
      expect(released1.status).toBe('released');
      expect(released1.fileBlobId).toBe('blb_r1');
      expect(released1.fileSha256).toBe('sha256:r1file');
      expect(released1.releasedBy).toBe(ownerId);
      expect(released1.releasedAt).toBeTruthy();

      // A second release supersedes the first.
      const r2 = reportRepo.create(makeReportInput());
      reportRepo.updateStatus(r2.id, 'rendering');
      reportRepo.updateStatus(r2.id, 'staged');
      reportRepo.updateStatus(r2.id, 'ready');
      const released2 = reportRepo.release(r2.id, ownerId, {
        blobId: 'blb_r2',
        sha256: 'sha256:r2file',
      });
      expect(released2.status).toBe('released');
      const r1Now = reportRepo.findById(r1.id);
      expect(r1Now?.status).toBe('superseded');
    });

    it('refuses to release a report that is not ready', () => {
      const report = reportRepo.create(makeReportInput());
      expect(() =>
        reportRepo.release(report.id, ownerId, { blobId: 'blb_x', sha256: 'sha256:x' }),
      ).toThrow(ApiError);
    });
  });

  // ── ChangeRepo — preview isolation ─────────────────────────────────────────

  describe('ChangeRepo — preview isolation', () => {
    let approvedBaselineId: string;

    beforeAll(() => {
      const baseline = baselineRepo.create({
        projectId,
        items: [{ entityType: 'requirement', entityId: 'req_preview', entityVersion: 1 }],
      });
      approvedBaselineId = baselineRepo.approve({
        id: baseline.id,
        approverId: ownerId,
        expectedVersion: baseline.version,
      }).id;
    });

    it('creates a preview with candidate impacts pointing at preview_id only', () => {
      const preview = changeRepo.createPreview({
        projectId,
        baselineId: approvedBaselineId,
        createdBy: ownerId,
        scenario: {
          type: 'requirement_change',
          description: '新增视频问诊功能',
          affected_entities: [
            { entity_type: 'requirement', entity_id: 'req_video' },
            { entity_type: 'outcome', entity_id: 'out_video' },
          ],
          unknowns: [{ type: 'unknown', description: '带宽要求待调研' }],
        },
      });

      expect(preview.id).toMatch(/^cpv_/);
      expect(preview.status).toBe('ready');
      expect(preview.projectId).toBe(projectId);
      expect(preview.expiresAt).toBeTruthy();

      const impact = changeRepo.getPreviewImpact(preview.id);
      expect(impact.impacts).toHaveLength(2);
      // XOR invariant: every preview impact has preview_id set, change_id null.
      for (const i of impact.impacts) {
        expect(i.previewId).toBe(preview.id);
        expect(i.changeId).toBeNull();
        expect(i.status).toBe('candidate');
      }
      expect(impact.unresolvedItems).toEqual([
        { type: 'unknown', description: '带宽要求待调研' },
      ]);
      // suggested_stages derived from affected entity types.
      expect(impact.suggestedStages).toEqual(expect.arrayContaining(['scope', 'outcome']));
    });

    it('preview creation does not insert any formal change rows', () => {
      const before = db.db.select().from(changes).all().length;
      changeRepo.createPreview({
        projectId,
        baselineId: approvedBaselineId,
        createdBy: ownerId,
        scenario: { type: 'modification', description: '仅预演', affected_entities: [] },
      });
      const after = db.db.select().from(changes).all().length;
      expect(after).toBe(before);
    });

    it('preview does not mutate the referenced baseline', () => {
      const baselineBefore = baselineRepo.findById(approvedBaselineId)!;
      changeRepo.createPreview({
        projectId,
        baselineId: approvedBaselineId,
        createdBy: ownerId,
        scenario: { type: 'modification', description: 'x', affected_entities: [] },
      });
      const baselineAfter = baselineRepo.findById(approvedBaselineId)!;
      expect(baselineAfter.status).toBe('approved');
      expect(baselineAfter.dataHash).toBe(baselineBefore.dataHash);
      expect(baselineAfter.version).toBe(baselineBefore.version);
      expect(baselineAfter.baselineVersion).toBe(baselineBefore.baselineVersion);
    });

    it('throws when fetching impact for a missing preview', () => {
      expect(() => changeRepo.getPreviewImpact('cpv_missing')).toThrow(ApiError);
    });
  });

  // ── ChangeRepo — confirm transaction & withdraw ───────────────────────────

  describe('ChangeRepo — confirm transaction & withdraw', () => {
    let releasedProjectId: string;

    beforeAll(() => {
      // A separate project parked in `Released` so confirm can transition it.
      const p = projectRepo.create({ ownerId, name: '变化确认项目' });
      projectRepo.update(p.id, { status: 'Released', expectedVersion: 1 });
      releasedProjectId = p.id;
    });

    it('registers a real change in draft status with no impacts yet', () => {
      const change = changeRepo.create({
        projectId: releasedProjectId,
        sourceType: 'regulatory',
        description: '法规修订要求增加实名认证',
        triggerType: 'external_event',
        severity: 'high',
      });
      expect(change.id).toMatch(/^chg_/);
      expect(change.status).toBe('draft');
      expect(change.version).toBe(1);

      // No impacts exist until getImpact lazily generates them.
      const direct = db.db
        .select()
        .from(changeImpacts)
        .where(eq(changeImpacts.changeId, change.id))
        .all();
      expect(direct).toEqual([]);
    });

    it('getImpact lazily generates candidate impacts with change_id set', () => {
      const change = changeRepo.create({
        projectId: releasedProjectId,
        sourceType: 'regulatory',
        description: '高严重度变化',
        severity: 'high',
      });
      const { impacts, suggestedStages } = changeRepo.getImpact(change.id);
      expect(impacts.length).toBeGreaterThan(0);
      for (const i of impacts) {
        expect(i.changeId).toBe(change.id);
        expect(i.previewId).toBeNull();
        expect(i.status).toBe('candidate');
      }
      // High severity reopens both scope and outcome.
      expect(suggestedStages).toEqual(expect.arrayContaining(['scope', 'outcome']));
    });

    it('confirm atomically transitions project to Changing and creates reopen tasks', () => {
      const change = changeRepo.create({
        projectId: releasedProjectId,
        sourceType: 'regulatory',
        description: '确认事务测试',
        severity: 'high',
      });
      const result = changeRepo.confirm(change.id, ownerId, change.version);

      expect(result.change.status).toBe('confirmed');
      expect(result.change.confirmedBy).toBe(ownerId);
      expect(result.change.confirmedAt).toBeTruthy();
      expect(result.change.version).toBe(change.version + 1);
      expect(result.projectStatus).toBe('Changing');

      // Project row actually flipped.
      const project = db.db
        .select()
        .from(projects)
        .where(eq(projects.id, releasedProjectId))
        .get();
      expect(project?.status).toBe('Changing');

      // Impacts promoted to accepted.
      const impacts = db.db
        .select()
        .from(changeImpacts)
        .where(eq(changeImpacts.changeId, change.id))
        .all();
      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.every((i) => i.status === 'accepted')).toBe(true);

      // One reopen task per distinct required_stage.
      expect(result.reopenedStages).toEqual(expect.arrayContaining(['scope', 'outcome']));
      expect(result.reopenTasks.length).toBe(result.reopenedStages.length);
      for (const t of result.reopenTasks) {
        expect(t.task_id).toMatch(/^tsk_/);
        expect(result.reopenedStages).toContain(t.stage);
      }
    });

    it('confirm is idempotent on impacts (lazy-generates if missing) and rejects double-confirm', () => {
      const change = changeRepo.create({
        projectId: releasedProjectId,
        sourceType: 'regulatory',
        description: '幂等确认测试',
        severity: 'medium',
      });
      const r1 = changeRepo.confirm(change.id, ownerId, change.version);
      expect(r1.change.status).toBe('confirmed');

      // Second confirm with the now-stale version throws VERSION_CONFLICT.
      expect(() => changeRepo.confirm(change.id, ownerId, change.version)).toThrow(ApiError);
      try {
        changeRepo.confirm(change.id, ownerId, change.version);
      } catch (err) {
        expect((err as ApiError).code).toBe('VERSION_CONFLICT');
      }
    });

    it('confirm rejects a stale expected_version', () => {
      const change = changeRepo.create({
        projectId: releasedProjectId,
        sourceType: 'regulatory',
        description: '版本冲突测试',
        severity: 'low',
      });
      expect(() => changeRepo.confirm(change.id, ownerId, 99999)).toThrow(ApiError);
    });

    it('withdraws a draft change with reason and records withdrawer/time', () => {
      const change = changeRepo.create({
        projectId: releasedProjectId,
        sourceType: 'internal',
        description: '撤回测试',
        severity: 'low',
      });
      const withdrawn = changeRepo.withdraw(change.id, ownerId, '误登记，撤回', change.version);
      expect(withdrawn.status).toBe('withdrawn');
      expect(withdrawn.withdrawnBy).toBe(ownerId);
      expect(withdrawn.withdrawnAt).toBeTruthy();
      expect(withdrawn.withdrawalReason).toBe('误登记，撤回');
      expect(withdrawn.version).toBe(change.version + 1);
    });

    it('refuses to withdraw a baselined change (CHANGE_BASELINED)', () => {
      const change = changeRepo.create({
        projectId: releasedProjectId,
        sourceType: 'internal',
        description: '已基线变化',
        severity: 'medium',
      });
      // Force the change into `baselined` to simulate a baseline referencing it.
      db.db
        .update(changes)
        .set({ status: 'baselined' })
        .where(eq(changes.id, change.id))
        .run();

      expect(() => changeRepo.withdraw(change.id, ownerId, '尝试撤回', change.version)).toThrow(
        ApiError,
      );
      try {
        changeRepo.withdraw(change.id, ownerId, '尝试撤回', change.version);
      } catch (err) {
        expect((err as ApiError).code).toBe('CHANGE_BASELINED');
      }
    });

    it('refuses to withdraw an already-withdrawn change', () => {
      const change = changeRepo.create({
        projectId: releasedProjectId,
        sourceType: 'internal',
        description: '重复撤回',
        severity: 'low',
      });
      changeRepo.withdraw(change.id, ownerId, '第一次撤回', change.version);
      expect(() =>
        changeRepo.withdraw(change.id, ownerId, '第二次', change.version + 1),
      ).toThrow(ApiError);
    });
  });
});
