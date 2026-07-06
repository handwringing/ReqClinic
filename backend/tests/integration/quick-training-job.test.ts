import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ContractFixtures } from '../contract/helpers/full-app';
import { buildContractApp } from '../contract/helpers/full-app';
import { QuickSessionRepo } from '../../src/repo/quick-session-repo';
import { BriefRepo } from '../../src/repo/brief-repo';
import { JobRepo } from '../../src/repo/job-repo';
import { TrainingRepo } from '../../src/repo/training-repo';
import { ReportRepo } from '../../src/repo/report-repo';
import { ProjectRepo } from '../../src/repo/project-repo';
import { ChangeRepo } from '../../src/repo/change-repo';
import { JobWorker } from '../../src/queue/worker';
import { TrainingJobExecutor } from '../../src/queue/training-job-executor';
import { AiRunRepo } from '../../src/repo/ai-run-repo';
import { AgentRunRepo } from '../../src/repo/agent-run-repo';
import { StubProvider } from '../../src/ai/stub-provider';
import type { AiInvokeResult } from '../../src/ai/provider';
import { domainProfiles } from '../../src/db/schema/domain';

/**
 * Task 33.3 — Quick-session/training state machines, Job lifecycle, report
 * compilation, and change preview/confirm isolation.
 *
 * End-to-end flows that span multiple repos and HTTP routes. Uses
 * buildContractApp for the full route wiring. Non-route state transitions
 * (e.g. quick-session draft→clarifying) are driven via the repo directly
 * because no HTTP route owns those transitions; the route-owned transitions
 * (upgrade, training complete, job cancel, report compile/release, change
 * confirm) are exercised via HTTP.
 *
 * Note: the RouteRegistry wraps every handler result in `{ data, meta }`, so
 * all response fields are accessed via `res.body.data.*`.
 */
describe('Task 33.3 — quick/training/job/report/change integration', () => {
  let fx: ContractFixtures;
  let quickSessionRepo: QuickSessionRepo;
  let briefRepo: BriefRepo;
  let jobRepo: JobRepo;
  let trainingRepo: TrainingRepo;
  let reportRepo: ReportRepo;
  let projectRepo: ProjectRepo;
  let changeRepo: ChangeRepo;

  beforeAll(async () => {
    fx = await buildContractApp();
    quickSessionRepo = new QuickSessionRepo(fx.db.db);
    briefRepo = new BriefRepo(fx.db.db);
    jobRepo = new JobRepo(fx.db.db);
    trainingRepo = new TrainingRepo(fx.db.db);
    reportRepo = new ReportRepo(fx.db.db);
    projectRepo = new ProjectRepo(fx.db.db);
    changeRepo = new ChangeRepo(fx.db.db);
  });

  afterAll(async () => {
    await fx.app.close();
  });

  // ── Quick-session state machine ────────────────────────────────────────────

  describe('quick session state machine (draft → upgraded)', () => {
    it('walks draft → clarifying → understanding_review → option_review → brief_ready → upgraded', async () => {
      // HTTP createQuickSession → draft.
      const createRes = await fx.inject('POST', '/api/v1/quick-sessions', {
        ...fx.asOwner(),
        body: {
          original_input: '快速问诊状态机走查：在线教育平台的用户留存分析',
          source_kind: 'custom',
          decision_intent: '识别流失原因并制定挽留策略',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const sessionId = (createRes.body as any).data.id;
      expect(sessionId).toBeDefined();

      // Verify draft status.
      let session = quickSessionRepo.findById(sessionId)!;
      expect(session.status).toBe('draft');

      // draft → clarifying (via repo; no HTTP route owns this transition).
      session = quickSessionRepo.updateStatus(sessionId, 'clarifying');
      expect(session.status).toBe('clarifying');

      // clarifying → understanding_review.
      session = quickSessionRepo.updateStatus(sessionId, 'understanding_review');
      expect(session.status).toBe('understanding_review');

      // understanding_review → option_review.
      session = quickSessionRepo.updateStatus(sessionId, 'option_review');
      expect(session.status).toBe('option_review');

      // option_review → brief_ready.
      session = quickSessionRepo.updateStatus(sessionId, 'brief_ready');
      expect(session.status).toBe('brief_ready');

      // Create a brief version (required for upgrade).
      const brief = briefRepo.createVersion({
        quickSessionId: sessionId,
        contentJson: JSON.stringify({ title: '留存分析简报', summary: '用户流失主因与挽留方案' }),
      });
      expect(brief.version).toBe(1);

      // HTTP upgradeQuickSession → upgraded (atomic transaction).
      // expected_quick_session_version is the session's version (incremented
      // by each updateStatus call), NOT the brief version number.
      const currentSession = quickSessionRepo.findById(sessionId)!;
      const upgradeRes = await fx.inject('POST', `/api/v1/quick-sessions/${sessionId}/upgrade`, {
        ...fx.asOwner(),
        body: {
          brief_version: brief.version,
          expected_quick_session_version: currentSession.version,
        },
      });
      expect(upgradeRes.statusCode).toBe(201);
      expect((upgradeRes.body as any).data.project_id).toBeDefined();

      // Verify session is now upgraded.
      session = quickSessionRepo.findById(sessionId)!;
      expect(session.status).toBe('upgraded');
    });

    it('rejects non-adjacent quick-session transition (409 INVALID_TRANSITION)', () => {
      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: fx.ownerId,
        sourceKind: 'custom',
        originalIdea: '非法跳转测试问诊',
      });

      // draft → brief_ready is not a valid transition.
      expect(() => quickSessionRepo.updateStatus(session.id, 'brief_ready')).toThrow();

      const after = quickSessionRepo.findById(session.id)!;
      expect(after.status).toBe('draft');
    });
  });

  // ── Training state machine ─────────────────────────────────────────────────

  describe('training state machine (interviewing → completed)', () => {
    it('walks interviewing → summarizing → feedback_ready → completed', async () => {
      // HTTP createTrainingAttempt → interviewing.
      const createRes = await fx.inject('POST', '/api/v1/training-attempts', {
        ...fx.asOwner(),
        body: { case_id: fx.trainingCaseId, case_version: '1.0.0' },
      });
      expect(createRes.statusCode).toBe(201);
      const attemptId = (createRes.body as any).data.attempt_id;

      let attempt = trainingRepo.findById(attemptId)!;
      expect(attempt.status).toBe('interviewing');

      // HTTP postTrainingQuestion → 202 (persists question index only).
      const qRes = await fx.inject('POST', `/api/v1/training-attempts/${attemptId}/questions`, {
        ...fx.asOwner(),
        body: { question: '这个场景下的核心目标是什么？' },
      });
      expect(qRes.statusCode).toBe(202);
      expect((qRes.body as any).data.job_id).toBeDefined();

      // HTTP postTrainingSummary → 202 + job_id (async accepted, stores hash only).
      const sRes = await fx.inject('POST', `/api/v1/training-attempts/${attemptId}/summary`, {
        ...fx.asOwner(),
        body: { summary: '本次访谈覆盖了目标澄清与范围界定，遗漏了约束分析。' },
      });
      expect(sRes.statusCode).toBe(202);
      expect((sRes.body as any).data.job_id).toBeDefined();
      attempt = trainingRepo.findById(attemptId)!;
      expect(attempt.status).toBe('summarizing');

      // repo recordFeedback → feedback_ready (stands in for async AI feedback).
      trainingRepo.recordFeedback({
        attemptId,
        coverageScoreBp: 7200,
        missingDimensionCount: 1,
        feedbackJson: JSON.stringify({
          missing_dimensions: ['constraint_analysis'],
          improvement_suggestions: ['补充约束条件的系统化梳理'],
        }),
      });
      attempt = trainingRepo.findById(attemptId)!;
      expect(attempt.status).toBe('feedback_ready');

      // HTTP getTrainingFeedback → verify feedback is retrievable.
      const fbRes = await fx.inject('GET', `/api/v1/training-attempts/${attemptId}/feedback`, {
        ...fx.asOwner(),
      });
      expect(fbRes.statusCode).toBe(200);
      expect((fbRes.body as any).data.coverage_score).toBe(0.72);

      // HTTP completeTrainingAttempt → completed (terminal).
      const cRes = await fx.inject('POST', `/api/v1/training-attempts/${attemptId}/complete`, {
        ...fx.asOwner(),
      });
      expect(cRes.statusCode).toBe(200);
      attempt = trainingRepo.findById(attemptId)!;
      expect(attempt.status).toBe('completed');
      expect(attempt.completedAt).not.toBeNull();
    });

    it('retry creates a fresh attempt preserving prior feedback', async () => {
      // Create + walk to feedback_ready.
      const attempt = trainingRepo.createAttempt({
        caseId: fx.trainingCaseId,
        caseVersion: '1.0.0',
        actorKind: 'user',
        userId: fx.ownerId,
      });
      trainingRepo.recordFeedback({
        attemptId: attempt.id,
        coverageScoreBp: 5000,
        missingDimensionCount: 2,
        feedbackJson: JSON.stringify({
          missing_dimensions: ['scope', 'constraint'],
          improvement_suggestions: ['加强范围与约束分析'],
        }),
      });

      // HTTP retryTrainingAttempt → new attempt in interviewing.
      const res = await fx.inject('POST', `/api/v1/training-attempts/${attempt.id}/retry`, {
        ...fx.asOwner(),
      });
      expect(res.statusCode).toBe(200);
      const newAttemptId = (res.body as any).data.new_attempt_id;
      expect(newAttemptId).not.toBe(attempt.id);

      const newAttempt = trainingRepo.findById(newAttemptId)!;
      expect(newAttempt.status).toBe('interviewing');
      // Attempt number increments (exact value depends on prior attempts
      // seeded by the fixture and earlier tests).
      expect(newAttempt.attemptNumber).toBeGreaterThan(attempt.attemptNumber);

      // Prior feedback is preserved on the old attempt.
      const oldFeedback = trainingRepo.getFeedback(attempt.id);
      expect(oldFeedback.ready).toBe(true);
    });
  });

  // ── Job lifecycle ──────────────────────────────────────────────────────────

  describe('Job lifecycle (queued → succeeded/failed/cancelled)', () => {
    it('transitions queued → running → validating → succeeded via worker + HTTP poll', async () => {
      while (jobRepo.claimNext('drainer-before-success-job')) {}
      // HTTP createAnalysisRun → queued.
      const createRes = await fx.inject('POST', `/api/v1/projects/${fx.projectId}/analysis-runs`, {
        ...fx.asOwner(),
        body: { task: 'domain_profile', source_ids: ['src_job_succ'] },
      });
      expect(createRes.statusCode).toBe(202);
      const jobId = (createRes.body as any).data.job_id;

      // Worker claims the job → running.
      const claimed = jobRepo.claimNext('worker-1');
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(jobId);
      expect(claimed!.status).toBe('running');
      expect(claimed!.lockedBy).toBe('worker-1');

      // Worker advances to validating.
      jobRepo.updateStatus(jobId, 'validating');
      expect(jobRepo.findById(jobId)!.status).toBe('validating');

      // Worker succeeds.
      jobRepo.updateStatus(jobId, 'succeeded');
      expect(jobRepo.findById(jobId)!.status).toBe('succeeded');

      // HTTP getJobStatus → verify succeeded + progress 100.
      const pollRes = await fx.inject('GET', `/api/v1/ai-jobs/${jobId}`, { ...fx.asOwner() });
      expect(pollRes.statusCode).toBe(200);
      expect((pollRes.body as any).data.status).toBe('succeeded');
      expect((pollRes.body as any).data.progress).toBe(100);
    });

    it('cancels a queued job via HTTP cancelJob', async () => {
      const createRes = await fx.inject('POST', `/api/v1/projects/${fx.projectId}/analysis-runs`, {
        ...fx.asOwner(),
        body: { task: 'domain_profile', source_ids: ['src_job_cancel'] },
      });
      const jobId = (createRes.body as any).data.job_id;
      expect(jobRepo.findById(jobId)!.status).toBe('queued');

      // HTTP cancelJob → cancelled.
      const cancelRes = await fx.inject('POST', `/api/v1/ai-jobs/${jobId}/cancel`, {
        ...fx.asOwner(),
        body: { reason: '用户主动取消' },
      });
      expect(cancelRes.statusCode).toBe(200);
      expect((cancelRes.body as any).data.status).toBe('cancelled');
      expect((cancelRes.body as any).data.cancellation_reason).toBe('用户主动取消');

      // Verify via HTTP getJobStatus.
      const pollRes = await fx.inject('GET', `/api/v1/ai-jobs/${jobId}`, { ...fx.asOwner() });
      expect((pollRes.body as any).data.status).toBe('cancelled');
    });

    it('rejects cancellation of a terminal job (409 JOB_NOT_CANCELLABLE)', async () => {
      const createRes = await fx.inject('POST', `/api/v1/projects/${fx.projectId}/analysis-runs`, {
        ...fx.asOwner(),
        body: { task: 'domain_profile', source_ids: ['src_job_terminal'] },
      });
      const jobId = (createRes.body as any).data.job_id;

      // Drive to succeeded (terminal) via repo.
      jobRepo.claimNext('worker-2');
      jobRepo.updateStatus(jobId, 'succeeded');

      // HTTP cancelJob → 409.
      const cancelRes = await fx.inject('POST', `/api/v1/ai-jobs/${jobId}/cancel`, {
        ...fx.asOwner(),
        body: { reason: '尝试取消已完成任务' },
      });
      expect(cancelRes.statusCode).toBe(409);
      expect((cancelRes.body as any).error.code).toBe('JOB_NOT_CANCELLABLE');
    });

    it('supports retry_wait with exponential backoff and manual_review escalation', async () => {
      // Create a job directly via repo for the retry path.
      const job = jobRepo.create({
        scopeKind: 'formal_project',
        projectId: fx.projectId,
        taskType: 'analysis_extraction',
        payloadJson: JSON.stringify({ task: 'structured_extraction' }),
        inputHash: 'retry_test_hash_0001',
        dedupeKey: 'retry_dedupe_0001',
        createdByKind: 'user',
        createdByUserId: fx.ownerId,
      });
      expect(job.status).toBe('queued');

      // Simulate worker failure → retry_wait.
      jobRepo.incrementAttempts(job.id);
      const retryJob = jobRepo.updateStatus(job.id, 'retry_wait', 'MODEL_TIMEOUT');
      expect(retryJob.status).toBe('retry_wait');
      expect(retryJob.nextRunAt).not.toBeNull();
      expect(retryJob.lastErrorCode).toBe('MODEL_TIMEOUT');

      // Escalate to manual_review after repeated failure.
      const manualJob = jobRepo.updateStatus(job.id, 'manual_review', 'RETRY_EXHAUSTED');
      expect(manualJob.status).toBe('manual_review');

      // HTTP getJobStatus → verify manual_review + progress 100.
      const pollRes = await fx.inject('GET', `/api/v1/ai-jobs/${job.id}`, { ...fx.asOwner() });
      expect((pollRes.body as any).data.status).toBe('manual_review');
      expect((pollRes.body as any).data.progress).toBe(100);
      expect((pollRes.body as any).data.current_step).toBe('待人工审核');
    });

    it('transitions to failed with error code', async () => {
      const createRes = await fx.inject('POST', `/api/v1/projects/${fx.projectId}/analysis-runs`, {
        ...fx.asOwner(),
        body: { task: 'domain_profile', source_ids: ['src_job_failed'] },
      });
      const jobId = (createRes.body as any).data.job_id;

      jobRepo.claimNext('worker-3');
      const failed = jobRepo.updateStatus(jobId, 'failed', 'INFERENCE_ERROR');
      expect(failed.status).toBe('failed');
      expect(failed.lastErrorCode).toBe('INFERENCE_ERROR');

      const pollRes = await fx.inject('GET', `/api/v1/ai-jobs/${jobId}`, { ...fx.asOwner() });
      expect((pollRes.body as any).data.status).toBe('failed');
      expect((pollRes.body as any).data.progress).toBe(100);
    });
  });

  // ── Report compilation (baseline → ready → released) ───────────────────────

  describe('report compilation (compile → ready → released)', () => {
    it('compiles a report from an approved baseline (stalls at gate_failed when chapters missing)', async () => {
      // HTTP compileReport → 202. The seeded baseline only freezes outcome +
      // requirement items, so several required chapters (stakeholders,
      // acceptance_criteria, drivers, decisions, conflicts, evidence) are
      // missing → blocking gate defects → the report stalls at `gate_failed`.
      const compileRes = await fx.inject('POST', `/api/v1/projects/${fx.projectId}/reports`, {
        ...fx.asOwner(),
        body: {
          baseline_id: fx.baselineId,
          audience: 'executive',
          language: 'zh-CN',
          template_id: fx.reportTemplateId,
          template_version: '1.0.0',
        },
      });
      expect(compileRes.statusCode).toBe(202);
      expect((compileRes.body as any).data.status).toBe('queued');

      // Fetch the compiled report (compileReport returns a job_id, not the
      // report_id; query the repo to find the latest report for the project).
      const { items: reports } = reportRepo.listByProject(fx.projectId);
      expect(reports.length).toBeGreaterThan(0);
      const report = reports[0]; // newest version first.
      expect(report.status).toBe('gate_failed');

      // HTTP getReport → verify gate_failed + gate defects are retrievable.
      const getRes = await fx.inject('GET', `/api/v1/reports/${report.id}`, { ...fx.asOwner() });
      expect(getRes.statusCode).toBe(200);
      expect((getRes.body as any).data.status).toBe('gate_failed');
      const gateDefects = (getRes.body as any).data.gate_defects;
      expect(Array.isArray(gateDefects)).toBe(true);
      expect(gateDefects.length).toBeGreaterThan(0);
      expect(gateDefects.some((d: any) => d.gate_code === 'chapter_coverage')).toBe(true);
    });

    it('releases a ready report via HTTP (registers file blob + sha)', async () => {
      // Create a report directly via repo and drive it to `ready`, simulating
      // a compile that passed all gates (baseline with full chapter coverage).
      const profile = fx.db.db
        .select()
        .from(domainProfiles)
        .where(eq(domainProfiles.projectId, fx.projectId))
        .get()!;
      const report = reportRepo.create({
        projectId: fx.projectId,
        baselineId: fx.baselineId,
        dataHash: 'sha256:ready-release-test',
        templateId: fx.reportTemplateId,
        templateVersion: '1.0.0',
        coreSchemaVersion: '1.0.0',
        reportInputSchemaHash: 'sha256:input-ready',
        compilerVersion: 'v1.0.0',
        domainProfileId: profile.id,
        domainProfileVersion: profile.profileVersion,
        domainPackVersions: [],
        audience: 'executive',
        language: 'zh-CN',
      });
      // draft → rendering → staged → ready.
      reportRepo.updateStatus(report.id, 'rendering');
      reportRepo.updateStatus(report.id, 'staged');
      reportRepo.updateStatus(report.id, 'ready');
      expect(reportRepo.findById(report.id)!.status).toBe('ready');

      // HTTP releaseReport → released (registers file blob + sha).
      const releaseRes = await fx.inject('POST', `/api/v1/reports/${report.id}/releases`, {
        ...fx.asOwner(),
        body: { expected_version: report.reportVersion },
      });
      expect(releaseRes.statusCode).toBe(200);
      expect((releaseRes.body as any).data.status).toBe('released');
      expect((releaseRes.body as any).data.file_sha256).toBeDefined();
      expect((releaseRes.body as any).data.released_by).toBe(fx.ownerId);

      // HTTP getReport → verify released state.
      const getRes = await fx.inject('GET', `/api/v1/reports/${report.id}`, { ...fx.asOwner() });
      expect(getRes.statusCode).toBe(200);
      expect((getRes.body as any).data.status).toBe('released');
      expect((getRes.body as any).data.file_size).toBeGreaterThan(0);
    });

    it('rejects release of a non-ready report (409 BLOCKING_CONFLICT)', async () => {
      // Look up the approved domain profile (FK constraint requires a real row).
      const profile = fx.db.db
        .select()
        .from(domainProfiles)
        .where(eq(domainProfiles.projectId, fx.projectId))
        .get()!;
      expect(profile).toBeDefined();

      // Create a draft report directly (not driven to ready).
      const draft = reportRepo.create({
        projectId: fx.projectId,
        baselineId: fx.baselineId,
        dataHash: 'sha256:draft-test',
        templateId: fx.reportTemplateId,
        templateVersion: '1.0.0',
        coreSchemaVersion: '1.0.0',
        reportInputSchemaHash: 'sha256:input-draft',
        compilerVersion: 'v1.0.0',
        domainProfileId: profile.id,
        domainProfileVersion: profile.profileVersion,
        domainPackVersions: [],
        audience: 'technical',
        language: 'zh-CN',
      });
      expect(draft.status).toBe('draft');

      const res = await fx.inject('POST', `/api/v1/reports/${draft.id}/releases`, {
        ...fx.asOwner(),
        body: { expected_version: draft.reportVersion },
      });
      expect(res.statusCode).toBe(409);
      expect((res.body as any).error.code).toBe('BLOCKING_CONFLICT');
    });
  });

  // ── Change preview/confirm isolation ───────────────────────────────────────

  describe('change preview/confirm isolation', () => {
    it('createChangePreview does not create formal changes', async () => {
      // HTTP createChangePreview → isolated preview with impacts.
      const previewRes = await fx.inject('POST', `/api/v1/projects/${fx.projectId}/change-previews`, {
        ...fx.asOwner(),
        body: {
          baseline_id: fx.baselineId,
          scenario: {
            type: 'modification',
            description: '预演：调整核心需求范围',
            affected_entities: [
              { entity_type: 'requirement', entity_id: fx.requirementId },
              { entity_type: 'outcome', entity_id: fx.outcomeId },
            ],
            unknowns: [{ type: 'scope', description: '是否影响下游模块' }],
          },
        },
      });
      expect(previewRes.statusCode).toBe(201);
      const previewId = (previewRes.body as any).data.id;
      expect(previewId).toBeDefined();

      // Verify preview impacts exist.
      const impact = changeRepo.getPreviewImpact(previewId);
      expect(impact.impacts.length).toBe(2);
      expect(impact.suggestedStages).toContain('scope');

      // Critical isolation check: no formal change records should exist.
      const listRes = await fx.inject('GET', `/api/v1/projects/${fx.projectId}/changes`, {
        ...fx.asOwner(),
      });
      expect(listRes.statusCode).toBe(200);
      const changes = (listRes.body as any).data;
      expect(Array.isArray(changes)).toBe(true);
      // The list should be empty — preview must not insert formal changes.
      expect(changes.length).toBe(0);
    });

    it('confirmChange transitions project to Changing (from Released)', async () => {
      // Create a fresh project and drive it to Released via repo.
      const project = projectRepo.create({ ownerId: fx.ownerId, name: '变化确认测试项目' });
      projectRepo.updateStatus(project.id, 'Ingesting');
      projectRepo.updateStatus(project.id, 'Eliciting');
      projectRepo.updateStatus(project.id, 'Reviewing');
      projectRepo.updateStatus(project.id, 'Baselined');
      projectRepo.updateStatus(project.id, 'Reporting');
      projectRepo.updateStatus(project.id, 'Released');
      expect(projectRepo.findById(project.id)!.status).toBe('Released');

      // HTTP createChange → draft change.
      const createRes = await fx.inject('POST', `/api/v1/projects/${project.id}/changes`, {
        ...fx.asOwner(),
        body: {
          source_type: 'stakeholder_feedback',
          description: '客户反馈需要新增数据导出功能',
          severity: 'high',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const changeId = (createRes.body as any).data.id;
      const changeVersion = (createRes.body as any).data.version;
      expect(changeVersion).toBe(1);

      // HTTP confirmChange → project transitions to Changing.
      const confirmRes = await fx.inject('POST', `/api/v1/changes/${changeId}/confirm`, {
        ...fx.asOwner(),
        body: { expected_version: changeVersion },
      });
      expect(confirmRes.statusCode).toBe(200);
      expect((confirmRes.body as any).data.status).toBe('confirmed');
      expect((confirmRes.body as any).data.project_status).toBe('Changing');
      // High severity → scope + outcome reopen tasks.
      expect((confirmRes.body as any).data.reopened_stages).toEqual(
        expect.arrayContaining(['scope', 'outcome']),
      );
      expect((confirmRes.body as any).data.reopen_tasks.length).toBeGreaterThanOrEqual(2);

      // Verify project is now in Changing.
      expect(projectRepo.findById(project.id)!.status).toBe('Changing');
    });

    it('rejects confirmChange with stale version (409 VERSION_CONFLICT)', async () => {
      const project = projectRepo.create({ ownerId: fx.ownerId, name: '版本冲突变化测试' });
      projectRepo.updateStatus(project.id, 'Ingesting');
      projectRepo.updateStatus(project.id, 'Eliciting');
      projectRepo.updateStatus(project.id, 'Reviewing');
      projectRepo.updateStatus(project.id, 'Baselined');
      projectRepo.updateStatus(project.id, 'Reporting');
      projectRepo.updateStatus(project.id, 'Released');

      const createRes = await fx.inject('POST', `/api/v1/projects/${project.id}/changes`, {
        ...fx.asOwner(),
        body: {
          source_type: 'regulatory_change',
          description: '法规变更导致合规需求调整',
          severity: 'medium',
        },
      });
      const changeId = (createRes.body as any).data.id;

      // Stale version (999 instead of 1).
      const confirmRes = await fx.inject('POST', `/api/v1/changes/${changeId}/confirm`, {
        ...fx.asOwner(),
        body: { expected_version: 999 },
      });
      expect(confirmRes.statusCode).toBe(409);
      expect((confirmRes.body as any).error.code).toBe('VERSION_CONFLICT');
    });
  });

  // ── Training_attempt worker dispatch (Task 1.3) ─────────────────────────────

  describe('training_attempt worker dispatch (Task 1.3)', () => {
    it('dispatches a training_response job through the executor and writes the audit chain', async () => {
      // Post a question on the seeded attempt so there is a training_questions
      // row for the executor to update.
      trainingRepo.postQuestion({
        attemptId: fx.trainingAttemptId,
        question: '你们这次重做官网，主要想达到什么目标？',
      });

      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: fx.trainingAttemptId,
        taskType: 'training_response',
        payloadJson: JSON.stringify({
          question: '你们这次重做官网，主要想达到什么目标？',
          question_index: 0,
        }),
        inputHash: 'integration-training-response-input',
        dedupeKey: 'integration-training-response-golden',
        createdByKind: 'user',
        createdByUserId: fx.ownerId,
        maxAttempts: 1,
      });

      const aiRunRepo = new AiRunRepo(fx.db.db);
      const agentRunRepo = new AgentRunRepo(fx.db.db);
      const worker = new JobWorker(fx.db, new StubProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
      });
      await worker.processJob(job);

      // Job → succeeded (deterministic fallback is a valid output).
      expect(jobRepo.findById(job.id)?.status).toBe('succeeded');

      // ai_run → succeeded.
      const aiRun = aiRunRepo.findLatestByJob(job.id);
      expect(aiRun?.status).toBe('succeeded');

      // agent_run → training_practice plan.
      const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
      expect(agentRuns).toHaveLength(1);
      expect(agentRuns[0].planId).toBe('training_practice');

      // skill_runs → 6 training skills, all succeeded.
      const skillRuns = agentRunRepo.findSkillRunsByAgent(agentRuns[0].id);
      expect(skillRuns).toHaveLength(6);
      expect(skillRuns.every((r) => r.status === 'succeeded')).toBe(true);
    });
  });

  // ── Training async end-to-end (Task 1.5 + Task 2.1) ────────────────────────

  describe('training async end-to-end (postTrainingQuestion + postTrainingSummary real enqueue)', () => {
    it('walks HTTP question → worker → succeeded; HTTP summary → worker → feedback_ready', async () => {
      // Drain any pre-existing queued jobs so the worker only sees the ones
      // this test enqueues.
      while (jobRepo.claimNext('drainer-training-e2e')) {}

      const aiRunRepo = new AiRunRepo(fx.db.db);
      const agentRunRepo = new AgentRunRepo(fx.db.db);
      const worker = new JobWorker(fx.db, new StubProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
      });

      // 1. Create attempt via HTTP.
      const createRes = await fx.inject('POST', '/api/v1/training-attempts', {
        ...fx.asOwner(),
        body: { case_id: fx.trainingCaseId, case_version: '1.0.0' },
      });
      expect(createRes.statusCode).toBe(201);
      const attemptId = (createRes.body as any).data.attempt_id;

      // 2. postTrainingQuestion → 202 + real job_id.
      const qRes = await fx.inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/questions`,
        {
          ...fx.asOwner(),
          body: { question: '你们这次重做官网，主要想达到什么业务目标？' },
        },
      );
      expect(qRes.statusCode).toBe(202);
      const questionJobId = (qRes.body as any).data.job_id;
      expect(questionJobId).toMatch(/^job_/);

      // Verify the enqueued job carries training_response scope + task.
      const questionJob = jobRepo.findById(questionJobId)!;
      expect(questionJob.scopeKind).toBe('training_attempt');
      expect(questionJob.trainingAttemptId).toBe(attemptId);
      expect(questionJob.taskType).toBe('training_response');
      expect(questionJob.dedupeKey).toBe(
        `training_response:${attemptId}:0`,
      );

      // 3. Worker processes the question job → succeeded.
      await worker.processJob(questionJob);
      expect(jobRepo.findById(questionJobId)?.status).toBe('succeeded');

      // 4. GET /api/v1/ai-jobs/:jobId polls succeeded.
      const qPoll = await fx.inject('GET', `/api/v1/ai-jobs/${questionJobId}`, {
        ...fx.asOwner(),
      });
      expect(qPoll.statusCode).toBe(200);
      expect((qPoll.body as any).data.status).toBe('succeeded');
      expect((qPoll.body as any).data.task).toBe('training_response');
      expect((qPoll.body as any).data.progress).toBe(100);

      // 5. postTrainingSummary → 202 + real job_id.
      const sRes = await fx.inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/summary`,
        {
          ...fx.asOwner(),
          body: { summary: '本次访谈聚焦官网重做的业务目标与目标用户澄清。' },
        },
      );
      expect(sRes.statusCode).toBe(202);
      const summaryJobId = (sRes.body as any).data.job_id;
      expect(summaryJobId).toMatch(/^job_/);

      const summaryJob = jobRepo.findById(summaryJobId)!;
      expect(summaryJob.scopeKind).toBe('training_attempt');
      expect(summaryJob.trainingAttemptId).toBe(attemptId);
      expect(summaryJob.taskType).toBe('training_feedback');
      expect(summaryJob.dedupeKey).toBe(`training_feedback:${attemptId}`);

      // 6. Worker processes the feedback job → succeeded.
      await worker.processJob(summaryJob);
      expect(jobRepo.findById(summaryJobId)?.status).toBe('succeeded');

      // 7. GET /api/v1/ai-jobs/:jobId polls succeeded.
      const sPoll = await fx.inject('GET', `/api/v1/ai-jobs/${summaryJobId}`, {
        ...fx.asOwner(),
      });
      expect(sPoll.statusCode).toBe(200);
      expect((sPoll.body as any).data.status).toBe('succeeded');
      expect((sPoll.body as any).data.task).toBe('training_feedback');

      // 8. getTrainingAttempt → status='feedback_ready'.
      const attemptRes = await fx.inject(
        'GET',
        `/api/v1/training-attempts/${attemptId}`,
        { ...fx.asOwner() },
      );
      expect(attemptRes.statusCode).toBe(200);
      expect((attemptRes.body as any).data.status).toBe('feedback_ready');

      // 9. getTrainingFeedback → feedback content retrievable.
      const fbRes = await fx.inject(
        'GET',
        `/api/v1/training-attempts/${attemptId}/feedback`,
        { ...fx.asOwner() },
      );
      expect(fbRes.statusCode).toBe(200);
      const feedback = (fbRes.body as any).data;
      expect(typeof feedback.coverage_score).toBe('number');
      expect(Array.isArray(feedback.missing_dimensions)).toBe(true);
      expect(Array.isArray(feedback.improvement_suggestions)).toBe(true);

      // 10. Three-layer audit chain.

      // ai_runs: latest run for the feedback job succeeded with tokens.
      const fbAiRun = aiRunRepo.findLatestByJob(summaryJobId);
      expect(fbAiRun?.status).toBe('succeeded');
      expect(fbAiRun?.provider).toBeTruthy();
      expect(fbAiRun?.model).toBeTruthy();

      // agent_runs: plan_id='training_practice' for both jobs.
      const qAgentRuns = agentRunRepo.findAgentRunsByJob(questionJobId);
      expect(qAgentRuns).toHaveLength(1);
      expect(qAgentRuns[0].planId).toBe('training_practice');

      const sAgentRuns = agentRunRepo.findAgentRunsByJob(summaryJobId);
      expect(sAgentRuns).toHaveLength(1);
      expect(sAgentRuns[0].planId).toBe('training_practice');

      // skill_runs: 6 training skills each, including the two key skills
      // (training.roleplay.answer for response, training.coaching.next_hint
      // for feedback). All succeeded.
      const qSkillRuns = agentRunRepo.findSkillRunsByAgent(qAgentRuns[0].id);
      expect(qSkillRuns).toHaveLength(6);
      expect(qSkillRuns.every((r) => r.status === 'succeeded')).toBe(true);
      const qSkillIds = qSkillRuns.map((r) => r.skillId);
      expect(qSkillIds).toContain('training.roleplay.answer');

      const sSkillRuns = agentRunRepo.findSkillRunsByAgent(sAgentRuns[0].id);
      expect(sSkillRuns).toHaveLength(6);
      expect(sSkillRuns.every((r) => r.status === 'succeeded')).toBe(true);
      const sSkillIds = sSkillRuns.map((r) => r.skillId);
      expect(sSkillIds).toContain('training.coaching.next_hint');

      // The question job wrote a disclosure_rule_hit on its training_questions
      // row (the executor's persistResponse side-effect).
      const questionRows = fx.db.raw
        .prepare('SELECT disclosure_rule_hit FROM training_questions WHERE attempt_id = ?')
        .all(attemptId) as { disclosure_rule_hit: string | null }[];
      expect(questionRows.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 409 when postTrainingSummary is repeated for the same attempt', async () => {
      // Dedupe: each attempt only gets one training_feedback job.
      const createRes = await fx.inject('POST', '/api/v1/training-attempts', {
        ...fx.asOwner(),
        body: { case_id: fx.trainingCaseId, case_version: '1.0.0' },
      });
      const attemptId = (createRes.body as any).data.attempt_id;

      const first = await fx.inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/summary`,
        { ...fx.asOwner(), body: { summary: '第一次总结' } },
      );
      expect(first.statusCode).toBe(202);

      const second = await fx.inject(
        'POST',
        `/api/v1/training-attempts/${attemptId}/summary`,
        { ...fx.asOwner(), body: { summary: '第二次总结' } },
      );
      expect(second.statusCode).toBe(409);
      expect((second.body as any).error.code).toBe('JOB_DEDUPE_CONFLICT');
    });
  });

  // ── Training feedback retry → failed (Task 2.2.2) ───────────────────────────

  describe('training feedback retry → failed (Task 2.2.2)', () => {
    it('retries a training_feedback job 3 times then marks failed when executor keeps throwing', async () => {
      // Drain any pre-existing queued jobs so the worker only sees this one.
      while (jobRepo.claimNext('drainer-training-retry')) {}

      // Create attempt + question + summary so the job has context.
      const createRes = await fx.inject('POST', '/api/v1/training-attempts', {
        ...fx.asOwner(),
        body: { case_id: fx.trainingCaseId, case_version: '1.0.0' },
      });
      expect(createRes.statusCode).toBe(201);
      const attemptId = (createRes.body as any).data.attempt_id;

      trainingRepo.postQuestion({
        attemptId,
        question: '你们这次重做官网，主要想达到什么目标？',
      });
      trainingRepo.postSummary({
        attemptId,
        summary: '本次访谈聚焦官网重做的业务目标与目标用户澄清。',
      });

      // Create a training_feedback job with maxAttempts=3.
      const job = jobRepo.create({
        scopeKind: 'training_attempt',
        trainingAttemptId: attemptId,
        taskType: 'training_feedback',
        payloadJson: JSON.stringify({
          summary: '本次访谈聚焦官网重做的业务目标与目标用户澄清。',
        }),
        inputHash: 'integration-training-retry-input',
        dedupeKey: 'integration-training-retry-golden',
        createdByKind: 'user',
        createdByUserId: fx.ownerId,
        maxAttempts: 3,
      });

      // Inject a custom TrainingJobExecutor that always throws — simulates
      // an executor-level failure (e.g., manifest not found, DB error). The
      // throwingProvider at the provider level would be caught by the runtime's
      // deterministic fallback, so we inject at the executor level to exercise
      // the worker's retry→failed state machine for training taskTypes.
      const throwingExecutor = {
        async process(): Promise<AiInvokeResult> {
          throw new Error('simulated executor failure');
        },
      } as unknown as TrainingJobExecutor;

      const aiRunRepo = new AiRunRepo(fx.db.db);
      const agentRunRepo = new AgentRunRepo(fx.db.db);
      const worker = new JobWorker(fx.db, new StubProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
        trainingJobExecutor: throwingExecutor,
      });

      // Attempt 1 → retry_wait (attempts=1 < maxAttempts=3).
      await worker.processJob(job);
      let fresh = jobRepo.findById(job.id);
      expect(fresh?.status).toBe('retry_wait');
      expect(fresh?.lastErrorCode).toBe('INVOKE_FAILED');
      expect(fresh?.attempts).toBe(1);

      // Attempt 2 → retry_wait (attempts=2 < maxAttempts=3).
      await worker.processJob(job);
      fresh = jobRepo.findById(job.id);
      expect(fresh?.status).toBe('retry_wait');
      expect(fresh?.lastErrorCode).toBe('INVOKE_FAILED');
      expect(fresh?.attempts).toBe(2);

      // Attempt 3 → failed (attempts=3, NOT < maxAttempts=3).
      await worker.processJob(job);
      fresh = jobRepo.findById(job.id);
      expect(fresh?.status).toBe('failed');
      expect(fresh?.lastErrorCode).toBe('INVOKE_FAILED');
      expect(fresh?.attempts).toBe(3);

      // ai_run for the final attempt → failed.
      const aiRun = aiRunRepo.findLatestByJob(job.id);
      expect(aiRun?.status).toBe('failed');

      // HTTP getJobStatus → verify failed + progress 100.
      const pollRes = await fx.inject('GET', `/api/v1/ai-jobs/${job.id}`, {
        ...fx.asOwner(),
      });
      expect(pollRes.statusCode).toBe(200);
      expect((pollRes.body as any).data.status).toBe('failed');
      expect((pollRes.body as any).data.progress).toBe(100);
    });
  });
});
