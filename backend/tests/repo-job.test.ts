import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from './helpers/test-db';
import { ProjectRepo } from '../src/repo/project-repo';
import { JobRepo } from '../src/repo/job-repo';
import { AiRunRepo } from '../src/repo/ai-run-repo';
import { AgentRunRepo } from '../src/repo/agent-run-repo';
import { DomainProfileRepo } from '../src/repo/domain-repo';
import { StubProvider } from '../src/ai/stub-provider';
import { JobWorker } from '../src/queue/worker';
import { now } from '../src/shared/time';

/**
 * Repository-level tests for the AI job / ai_run domain (Task 18, 20).
 *
 * Covers JobRepo create/claim/cancel/progress, the dedupe partial unique
 * index, scope-based actor access, and the JobWorker state machine
 * (create → claim → succeed).
 */
describe('job repos + worker (Task 18, 20)', () => {
  let db: AppDb;
  let userId: string;
  let otherUserId: string;
  let projectId: string;
  let jobRepo: JobRepo;
  let aiRunRepo: AiRunRepo;
  let agentRunRepo: AgentRunRepo;

  beforeAll(() => {
    db = createTestDb();
    userId = 'usr_job_owner';
    otherUserId = 'usr_job_outsider';

    for (const id of [userId, otherUserId]) {
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, id, `auth|${id}`, 'active', now(), now());
    }

    const projectRepo = new ProjectRepo(db.db);
    const project = projectRepo.create({ ownerId: userId, name: 'Job Test Project' });
    projectId = project.id;

    jobRepo = new JobRepo(db.db);
    aiRunRepo = new AiRunRepo(db.db);
    agentRunRepo = new AgentRunRepo(db.db);
  });

  function makeFormalJob(overrides: Partial<Parameters<JobRepo['create']>[0]> = {}) {
    return jobRepo.create({
      scopeKind: 'formal_project',
      projectId,
      taskType: 'domain_profile',
      payloadJson: JSON.stringify({ project_id: projectId, source_ids: [] }),
      inputHash: 'hash-' + Math.random().toString(36).slice(2),
      dedupeKey: 'dk-' + Math.random().toString(36).slice(2),
      createdByKind: 'user',
      createdByUserId: userId,
      ...overrides,
    });
  }

  // ── JobRepo.create / claimNext ─────────────────────────────────────────────

  describe('JobRepo.create + claimNext', () => {
    it('creates a job in queued status with attempts=0', () => {
      const job = makeFormalJob();
      expect(job.id).toMatch(/^job_/);
      expect(job.status).toBe('queued');
      expect(job.attempts).toBe(0);
      expect(job.maxAttempts).toBe(3);
      expect(job.scopeKind).toBe('formal_project');
      expect(job.projectId).toBe(projectId);
    });

    it('claimNext atomically transitions the oldest queued job to running', () => {
      // Drain leftover queued jobs from earlier tests so claimNext picks up
      // exactly the job created below.
      while (jobRepo.claimNext('drainer')) {}
      const job = makeFormalJob();
      const claimed = jobRepo.claimNext('worker-1');
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(job.id);
      expect(claimed!.status).toBe('running');
      expect(claimed!.lockedBy).toBe('worker-1');
      expect(claimed!.lockedAt).not.toBeNull();
    });

    it('claimNext returns null when the queue is empty', () => {
      // Drain any leftover queued jobs.
      while (jobRepo.claimNext('drainer')) {}
      expect(jobRepo.claimNext('worker-1')).toBeNull();
    });
  });

  // ── dedupe partial unique index ────────────────────────────────────────────

  describe('dedupe unique index', () => {
    it('rejects a second job with the same (project, taskType, dedupeKey)', () => {
      const dedupeKey = 'dk-dedupe-1';
      const first = jobRepo.create({
        scopeKind: 'formal_project',
        projectId,
        taskType: 'domain_profile',
        payloadJson: '{}',
        inputHash: 'h1',
        dedupeKey,
        createdByKind: 'user',
        createdByUserId: userId,
      });
      expect(first.id).toMatch(/^job_/);

      expect(() =>
        jobRepo.create({
          scopeKind: 'formal_project',
          projectId,
          taskType: 'domain_profile',
          payloadJson: '{}',
          inputHash: 'h2',
          dedupeKey,
          createdByKind: 'user',
          createdByUserId: userId,
        }),
      ).toThrow(/UNIQUE|constraint/i);
    });

    it('allows the same dedupeKey under a different scope (quick_session)', () => {
      // Insert a guest session + quick session so both FKs are satisfied.
      // ai_jobs.quick_session_id → quick_sessions(id), and
      // ai_jobs.created_by_guest_session_id → guest_sessions(id).
      const guestId = 'gst_dedupe_1';
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at, last_active_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(guestId, 'digest-1', now(), now(), now());

      const quickSessionId = 'qs_dedupe_1';
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind, original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(quickSessionId, guestId, 'draft', 'custom', 'test input', '{}', now(), now(), 1);

      const dedupeKey = 'dk-cross-scope';
      const formal = jobRepo.create({
        scopeKind: 'formal_project',
        projectId,
        taskType: 'brief_generation',
        payloadJson: '{}',
        inputHash: 'h1',
        dedupeKey,
        createdByKind: 'user',
        createdByUserId: userId,
      });
      // Different scope target → different partial index → allowed.
      const quick = jobRepo.create({
        scopeKind: 'quick_session',
        quickSessionId,
        taskType: 'brief_generation',
        payloadJson: '{}',
        inputHash: 'h2',
        dedupeKey,
        createdByKind: 'guest',
        createdByGuestSessionId: guestId,
      });
      expect(formal.id).not.toBe(quick.id);
    });
  });

  // ── findByIdForActor (scope access) ─────────────────────────────────────────

  describe('findByIdForActor', () => {
    it('returns the job for an active project member', () => {
      const job = makeFormalJob();
      const found = jobRepo.findByIdForActor(job.id, {
        kind: 'user',
        userId,
      });
      expect(found?.id).toBe(job.id);
    });

    it('returns null for a non-member (uniform 404, no leak)', () => {
      const job = makeFormalJob();
      const found = jobRepo.findByIdForActor(job.id, {
        kind: 'user',
        userId: otherUserId,
      });
      expect(found).toBeNull();
    });

    it('returns null for an unauthenticated actor', () => {
      const job = makeFormalJob();
      const found = jobRepo.findByIdForActor(job.id, { kind: 'unauthenticated' });
      expect(found).toBeNull();
    });
  });

  // ── cancel ──────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('cancels a queued job and stamps cancelled_* columns', () => {
      const job = makeFormalJob();
      const cancelled = jobRepo.cancel(
        job.id,
        'user',
        userId,
        undefined,
        '不再需要',
      );
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelledByKind).toBe('user');
      expect(cancelled.cancelledByUserId).toBe(userId);
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(cancelled.cancellationReason).toBe('不再需要');
    });

    it('throws 409 when cancelling an already-terminal job', () => {
      const job = makeFormalJob();
      jobRepo.cancel(job.id, 'user', userId);
      expect(() => jobRepo.cancel(job.id, 'user', userId)).toThrow(/terminal/i);
    });

    it('throws not-found for an unknown job id', () => {
      expect(() => jobRepo.cancel('job_missing', 'user', userId)).toThrow(/not found/i);
    });
  });

  // ── getProgress ──────────────────────────────────────────────────────────────

  describe('getProgress', () => {
    it('projects a progress view for a queued job', () => {
      const job = makeFormalJob();
      const p = jobRepo.getProgress(job.id);
      expect(p).not.toBeNull();
      expect(p!.progress).toBe(0);
      expect(p!.current_step).toBe('排队中');
      expect(p!.duration_ms).toBeGreaterThanOrEqual(0);
      expect(p!.completed_at).toBeNull();
    });

    it('projects progress=100 for a succeeded job', async () => {
      const job = makeFormalJob({ taskType: 'analysis_extraction' });
      const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo);
      await worker.processJob(job);
      const p = jobRepo.getProgress(job.id);
      expect(p!.progress).toBe(100);
      expect(p!.completed_at).not.toBeNull();
    });
  });

  // ── JobWorker lifecycle ─────────────────────────────────────────────────────

  describe('JobWorker', () => {
    it('drives create → claim → invoke → validate → succeeded', async () => {
      // Drain leftover queued jobs so tick() picks up exactly this job.
      while (jobRepo.claimNext('drainer')) {}
      const job = makeFormalJob({ taskType: 'domain_profile' });
      const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo);

      await worker.tick();

      const final = jobRepo.findById(job.id);
      expect(final!.status).toBe('succeeded');
      expect(final!.attempts).toBe(1);

      const run = aiRunRepo.findLatestByJob(job.id);
      expect(run).not.toBeNull();
      expect(run!.status).toBe('succeeded');
      expect(run!.provider).toBe('stub');
      expect(run!.model).toBe('stub-v1');
      expect(run!.parsedOutputJson).not.toBeNull();
      const parsed = JSON.parse(run!.parsedOutputJson!);
      expect(parsed.work_type).toBe('software-delivery');
    });

    it('records the controlled Orchestrator and Skill audit chain', async () => {
      while (jobRepo.claimNext('drainer')) {}
      const job = makeFormalJob({ taskType: 'domain_profile' });
      const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo, {
        agentRunRepo,
      });

      await worker.tick();

      const agentRuns = agentRunRepo.findAgentRunsByJob(job.id);
      expect(agentRuns).toHaveLength(1);
      expect(agentRuns[0].agentId).toBe('reqclinic.orchestrator');
      expect(agentRuns[0].status).toBe('succeeded');
      expect(agentRuns[0].planId).toBe('formal_reserved');

      const skillRuns = agentRunRepo.findSkillRunsByAgent(agentRuns[0].id);
      expect(skillRuns).toHaveLength(1);
      expect(skillRuns[0].skillId).toBe('formal.routing.reserved');
      expect(skillRuns[0].category).toBe('routing');
      expect(skillRuns.every((run) => run.status === 'succeeded')).toBe(true);
    });

    it('tick() returns null when the queue is empty', async () => {
      while (jobRepo.claimNext('drainer')) {}
      const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo);
      const result = await worker.tick();
      expect(result).toBeNull();
    });

    it('start()/stop() manages the polling interval without throwing', () => {
      const worker = new JobWorker(db, new StubProvider(), aiRunRepo, jobRepo);
      expect(worker.isRunning()).toBe(false);
      worker.start();
      expect(worker.isRunning()).toBe(true);
      // idempotent
      worker.start();
      worker.stop();
      expect(worker.isRunning()).toBe(false);
    });
  });

  // ── DomainProfileRepo (light) ───────────────────────────────────────────────

  describe('DomainProfileRepo', () => {
    it('creates a candidate profile and finds it as current', () => {
      const repo = new DomainProfileRepo(db.db);
      const profile = repo.create({
        projectId,
        candidatePackIds: ['software-delivery', 'general'],
        status: 'candidate',
        workType: 'software-delivery',
      });
      expect(profile.id).toMatch(/^dpm_/);
      expect(profile.profileVersion).toBe(1);
      expect(profile.status).toBe('candidate');

      const current = repo.findCurrentByProject(projectId);
      expect(current?.id).toBe(profile.id);
    });

    it('updateStatus to approved supersedes the previous approved version', () => {
      const repo = new DomainProfileRepo(db.db);
      const first = repo.create({
        projectId,
        candidatePackIds: ['general'],
        status: 'candidate',
      });
      repo.updateStatus(first.id, 'approved', first.profileVersion, userId);
      expect(repo.findApprovedVersion(projectId)?.id).toBe(first.id);

      const second = repo.create({
        projectId,
        candidatePackIds: ['general'],
        status: 'candidate',
      });
      repo.updateStatus(second.id, 'approved', second.profileVersion, userId);

      const approved = repo.findApprovedVersion(projectId);
      expect(approved?.id).toBe(second.id);
      // The previously-approved profile is now superseded.
      const firstRow = repo.findById(first.id);
      expect(firstRow?.status).toBe('superseded');
    });
  });
});
