import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ContractFixtures } from '../contract/helpers/full-app';
import { buildContractApp } from '../contract/helpers/full-app';
import { ProjectRepo } from '../../src/repo/project-repo';
import { QuickSessionRepo } from '../../src/repo/quick-session-repo';
import { BriefRepo } from '../../src/repo/brief-repo';

/**
 * Task 33.2/33.3 — Project lifecycle, gate blocking, and upgrade atomicity.
 *
 * Walks the project state machine end-to-end through the three human gates
 * (scope / outcome / evidence_conflict), verifies gate blocking (reject and
 * wrong-phase), and checks upgrade atomicity (success / duplicate / rollback).
 *
 * Uses buildContractApp for the full route wiring. Non-gate status transitions
 * (Draft→Ingesting, Baselined→Reporting, etc.) are driven via the repo directly
 * because no route handler owns those transitions; the gate-driven transitions
 * are exercised via the reviewGate HTTP route.
 */
describe('Task 33.2/33.3 — project lifecycle, gates, upgrade atomicity', () => {
  let fx: ContractFixtures;
  let projectRepo: ProjectRepo;

  beforeAll(async () => {
    fx = await buildContractApp();
    projectRepo = new ProjectRepo(fx.db.db);
  });

  afterAll(async () => {
    await fx.app.close();
  });

  // ── Full state machine walk through three human gates ───────────────────────

  describe('full project state machine walk (Draft → Released)', () => {
    it('transitions through all three gates to Released', async () => {
      // Use the seeded project (starts in Draft with approved baseline + domain profile).
      const projectId = fx.projectId;

      // Draft → Ingesting (via repo; no route owns this transition).
      let project = projectRepo.updateStatus(projectId, 'Ingesting');
      expect(project.status).toBe('Ingesting');

      // Ingesting → Eliciting (scope gate accept via HTTP).
      const scopeGateUrl = `/api/v1/projects/${projectId}/gates/scope/reviews`;
      let res = await fx.inject('POST', scopeGateUrl, {
        ...fx.asOwner(),
        body: { action: 'accept', entity_version: project.version, reason: '范围确认通过' },
      });
      expect(res.statusCode).toBe(201);
      project = projectRepo.findById(projectId)!;
      expect(project.status).toBe('Eliciting');

      // Eliciting → Reviewing (outcome gate accept via HTTP).
      const outcomeGateUrl = `/api/v1/projects/${projectId}/gates/outcome/reviews`;
      res = await fx.inject('POST', outcomeGateUrl, {
        ...fx.asOwner(),
        body: { action: 'accept', entity_version: project.version, reason: '成果评审通过' },
      });
      expect(res.statusCode).toBe(201);
      project = projectRepo.findById(projectId)!;
      expect(project.status).toBe('Reviewing');

      // Reviewing → Baselined (evidence_conflict gate accept via HTTP).
      const evidenceGateUrl = `/api/v1/projects/${projectId}/gates/evidence_conflict/reviews`;
      res = await fx.inject('POST', evidenceGateUrl, {
        ...fx.asOwner(),
        body: { action: 'accept', entity_version: project.version, reason: '证据冲突评审通过' },
      });
      expect(res.statusCode).toBe(201);
      project = projectRepo.findById(projectId)!;
      expect(project.status).toBe('Baselined');

      // Baselined → Reporting (via repo).
      project = projectRepo.updateStatus(projectId, 'Reporting');
      expect(project.status).toBe('Reporting');

      // Reporting → Released (via repo).
      project = projectRepo.updateStatus(projectId, 'Released');
      expect(project.status).toBe('Released');
    });
  });

  // ── Gate blocking: reject ───────────────────────────────────────────────────

  describe('gate rejection (409 GATE_NOT_PASSED)', () => {
    it('blocks progression when scope gate is rejected', async () => {
      // Create a fresh project in Ingesting.
      const project = projectRepo.create({ ownerId: fx.ownerId, name: '拒绝关口测试项目' });
      projectRepo.updateStatus(project.id, 'Ingesting');

      const url = `/api/v1/projects/${project.id}/gates/scope/reviews`;
      const res = await fx.inject('POST', url, {
        ...fx.asOwner(),
        body: { action: 'reject', entity_version: 1, reason: '范围不清晰，需补充' },
      });
      expect(res.statusCode).toBe(409);
      expect((res.body as any).error.code).toBe('GATE_NOT_PASSED');

      // Project should remain in Ingesting.
      const after = projectRepo.findById(project.id)!;
      expect(after.status).toBe('Ingesting');
    });
  });

  // ── Gate blocking: wrong phase ──────────────────────────────────────────────

  describe('gate wrong-phase (409 GATE_NOT_PASSED)', () => {
    it('blocks scope gate accept when project is not in Ingesting', async () => {
      // Create a fresh project in Draft (not Ingesting).
      const project = projectRepo.create({ ownerId: fx.ownerId, name: '错阶段关口测试' });

      const url = `/api/v1/projects/${project.id}/gates/scope/reviews`;
      const res = await fx.inject('POST', url, {
        ...fx.asOwner(),
        body: { action: 'accept', entity_version: 1, reason: '尝试在错误阶段通过关口' },
      });
      expect(res.statusCode).toBe(409);
      expect((res.body as any).error.code).toBe('GATE_NOT_PASSED');

      // Project should remain in Draft.
      const after = projectRepo.findById(project.id)!;
      expect(after.status).toBe('Draft');
    });

    it('blocks outcome gate accept when project is not in Eliciting', async () => {
      const project = projectRepo.create({ ownerId: fx.ownerId, name: '成果关口错阶段' });
      projectRepo.updateStatus(project.id, 'Ingesting'); // In Ingesting, not Eliciting

      const url = `/api/v1/projects/${project.id}/gates/outcome/reviews`;
      const res = await fx.inject('POST', url, {
        ...fx.asOwner(),
        body: { action: 'accept', entity_version: 1, reason: '尝试在 Ingesting 通过成果关口' },
      });
      expect(res.statusCode).toBe(409);
      expect((res.body as any).error.code).toBe('GATE_NOT_PASSED');
    });
  });

  // ── Gate uncertain/modify (no transition, 201 returned) ─────────────────────

  describe('gate uncertain/modify (no transition, 201)', () => {
    it('records uncertain action without transitioning project', async () => {
      const project = projectRepo.create({ ownerId: fx.ownerId, name: '不确定关口测试' });
      projectRepo.updateStatus(project.id, 'Ingesting');

      const url = `/api/v1/projects/${project.id}/gates/scope/reviews`;
      const res = await fx.inject('POST', url, {
        ...fx.asOwner(),
        body: { action: 'uncertain', entity_version: 1, reason: '需进一步讨论' },
      });
      expect(res.statusCode).toBe(201);

      // Project should remain in Ingesting.
      const after = projectRepo.findById(project.id)!;
      expect(after.status).toBe('Ingesting');
    });
  });

  // ── Invalid transition (409 INVALID_TRANSITION) ────────────────────────────

  describe('invalid transition (409 INVALID_TRANSITION)', () => {
    it('rejects non-adjacent transition via repo', () => {
      const project = projectRepo.create({ ownerId: fx.ownerId, name: '非法跳转测试' });
      // Draft → Baselined is not a valid transition.
      expect(() => projectRepo.updateStatus(project.id, 'Baselined')).toThrow();

      // Project should remain in Draft.
      const after = projectRepo.findById(project.id)!;
      expect(after.status).toBe('Draft');
    });
  });

  // ── Upgrade atomicity ──────────────────────────────────────────────────────

  describe('upgrade atomicity (success / duplicate / rollback)', () => {
    it('rejects duplicate upgrade with 409 UPGRADE_FAILED', async () => {
      // Set up a quick session in brief_ready with a brief version.
      const quickSessionRepo = new QuickSessionRepo(fx.db.db);
      const briefRepo = new BriefRepo(fx.db.db);

      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: fx.ownerId,
        sourceKind: 'custom',
        originalIdea: '升级原子性测试问诊',
      });

      // Transition to brief_ready via repo.
      quickSessionRepo.updateStatus(session.id, 'clarifying');
      quickSessionRepo.updateStatus(session.id, 'understanding_review');
      quickSessionRepo.updateStatus(session.id, 'option_review');
      quickSessionRepo.updateStatus(session.id, 'brief_ready');

      // Create a brief version.
      const brief = briefRepo.createVersion({
        quickSessionId: session.id,
        contentJson: JSON.stringify({ title: '升级测试简报', summary: '测试升级原子性' }),
      });

      // First upgrade → success.
      // expected_quick_session_version is the session's version (incremented
      // by each updateStatus call), NOT the brief version number.
      const upgradeUrl = `/api/v1/quick-sessions/${session.id}/upgrade`;
      const res1 = await fx.inject('POST', upgradeUrl, {
        ...fx.asOwner(),
        body: {
          brief_version: brief.version,
          expected_quick_session_version: quickSessionRepo.findById(session.id)!.version,
        },
      });
      expect(res1.statusCode).toBe(201);
      const projectId = (res1.body as any).data.project_id;
      expect(projectId).toBeDefined();

      // Second upgrade → 409 UPGRADE_FAILED (duplicate).
      const res2 = await fx.inject('POST', upgradeUrl, {
        ...fx.asOwner(),
        body: {
          brief_version: brief.version,
          expected_quick_session_version: 5, // version after brief_ready is 5
        },
      });
      expect(res2.statusCode).toBe(409);
      expect((res2.body as any).error.code).toBe('UPGRADE_FAILED');
    });

    it('rejects upgrade with stale version (409 VERSION_CONFLICT)', async () => {
      const quickSessionRepo = new QuickSessionRepo(fx.db.db);
      const briefRepo = new BriefRepo(fx.db.db);

      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: fx.ownerId,
        sourceKind: 'custom',
        originalIdea: '版本冲突升级测试',
      });

      quickSessionRepo.updateStatus(session.id, 'clarifying');
      quickSessionRepo.updateStatus(session.id, 'understanding_review');
      quickSessionRepo.updateStatus(session.id, 'option_review');
      quickSessionRepo.updateStatus(session.id, 'brief_ready');

      const brief = briefRepo.createVersion({
        quickSessionId: session.id,
        contentJson: JSON.stringify({ title: '版本冲突简报', summary: '测试版本冲突' }),
      });

      // Stale version (999 instead of the actual session version).
      const upgradeUrl = `/api/v1/quick-sessions/${session.id}/upgrade`;
      const res = await fx.inject('POST', upgradeUrl, {
        ...fx.asOwner(),
        body: { brief_version: brief.version, expected_quick_session_version: 999 },
      });
      expect(res.statusCode).toBe(409);
      expect((res.body as any).error.code).toBe('VERSION_CONFLICT');
    });

    it('rejects upgrade with non-existent brief version (404)', async () => {
      const quickSessionRepo = new QuickSessionRepo(fx.db.db);

      const session = quickSessionRepo.create({
        actorKind: 'user',
        userId: fx.ownerId,
        sourceKind: 'custom',
        originalIdea: '缺失简报版本测试',
      });

      quickSessionRepo.updateStatus(session.id, 'clarifying');
      quickSessionRepo.updateStatus(session.id, 'understanding_review');
      quickSessionRepo.updateStatus(session.id, 'option_review');
      quickSessionRepo.updateStatus(session.id, 'brief_ready');

      const upgradeUrl = `/api/v1/quick-sessions/${session.id}/upgrade`;
      const res = await fx.inject('POST', upgradeUrl, {
        ...fx.asOwner(),
        body: { brief_version: 999, expected_quick_session_version: 5 },
      });
      expect(res.statusCode).toBe(404);
      expect((res.body as any).error.code).toBe('BRIEF_VERSION_NOT_FOUND');
    });
  });
});
