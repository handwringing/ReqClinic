import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from './helpers/test-db';
import { ProjectRepo } from '../src/repo/project-repo';
import { DriverRepo } from '../src/repo/driver-repo';
import { OutcomeRepo, buildOutcomeRow } from '../src/repo/outcome-repo';
import { RequirementRepo, buildRequirementRow } from '../src/repo/requirement-repo';
import { AcceptanceRepo } from '../src/repo/acceptance-repo';
import { VerificationRepo } from '../src/repo/verification-repo';
import { ScenarioRepo } from '../src/repo/scenario-repo';
import {
  ConflictRepo,
  loadConflictDetail,
} from '../src/repo/conflict-repo';
import { ReviewRepo, type ReviewGateType } from '../src/repo/review-repo';
import { StakeholderRepo } from '../src/repo/stakeholder-repo';
import { EvidenceLinkRepo } from '../src/repo/evidence-link-repo';
import { ApiError } from '../src/http/errors';
import { generateId } from '../src/shared/id';
import { now } from '../src/shared/time';
import { outcomes, requirements, conflicts, stakeholders, conflictOptions } from '../src/db/schema/core';

/**
 * Repository-level tests for the core requirements-engineering domain
 * (Task 23 — 11 repos excluding BaselineRepo, which is covered by
 * `repo-baseline-report-change.test.ts`).
 *
 * Focuses on the three load-bearing invariants:
 *   1. optimistic concurrency — `expectedVersion` mismatch throws VERSION_CONFLICT;
 *   2. version increment — every successful update bumps `version` by 1;
 *   3. domain-specific constraints — provenance, conflict resolution, gate reviews.
 */
describe('core requirement repos (Task 23)', () => {
  let db: AppDb;
  let projectRepo: ProjectRepo;
  let driverRepo: DriverRepo;
  let outcomeRepo: OutcomeRepo;
  let requirementRepo: RequirementRepo;
  let acceptanceRepo: AcceptanceRepo;
  let verificationRepo: VerificationRepo;
  let scenarioRepo: ScenarioRepo;
  let conflictRepo: ConflictRepo;
  let reviewRepo: ReviewRepo;
  let stakeholderRepo: StakeholderRepo;
  let evidenceLinkRepo: EvidenceLinkRepo;

  let ownerId: string;
  let projectId: string;

  beforeAll(() => {
    db = createTestDb();
    projectRepo = new ProjectRepo(db.db);
    driverRepo = new DriverRepo(db.db);
    outcomeRepo = new OutcomeRepo(db.db);
    requirementRepo = new RequirementRepo(db.db);
    acceptanceRepo = new AcceptanceRepo(db.db);
    verificationRepo = new VerificationRepo(db.db);
    scenarioRepo = new ScenarioRepo(db.db);
    conflictRepo = new ConflictRepo(db.db);
    reviewRepo = new ReviewRepo(db.db);
    stakeholderRepo = new StakeholderRepo(db.db);
    evidenceLinkRepo = new EvidenceLinkRepo(db.db);

    ownerId = 'usr_core_owner';
    db.raw
      .prepare(
        `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(ownerId, 'Core Owner', 'auth|coreowner', 'active', now(), now());

    const project = projectRepo.create({ ownerId, name: '核心需求测试项目' });
    projectId = project.id;
  });

  // ------------------------------------------------------- DriverRepo ---
  describe('DriverRepo', () => {
    it('creates a driver in candidate status with version 1', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'goal',
        statement: '提升用户留存率',
      });
      expect(driver.id).toMatch(/^drv_/);
      expect(driver.driverType).toBe('goal');
      expect(driver.status).toBe('candidate');
      expect(driver.version).toBe(1);
    });

    it('findById returns the driver', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'risk',
        statement: '市场竞争加剧',
      });
      const found = driverRepo.findById(driver.id);
      expect(found).not.toBeNull();
      expect(found!.statement).toBe('市场竞争加剧');
    });

    it('updates fields and increments version', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'problem',
        statement: '原始陈述',
      });
      const updated = driverRepo.update(driver.id, {
        statement: '更新后的陈述',
        status: 'supported',
        expectedVersion: 1,
      });
      expect(updated.statement).toBe('更新后的陈述');
      expect(updated.status).toBe('supported');
      expect(updated.version).toBe(2);
    });

    it('rejects update with wrong expectedVersion', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'obligation',
        statement: '合规义务',
      });
      expect(() =>
        driverRepo.update(driver.id, {
          statement: 'should fail',
          expectedVersion: 999,
        }),
      ).toThrow(ApiError);
    });

    it('listByProject filters by driverType', () => {
      driverRepo.create({ projectId, driverType: 'opportunity', statement: '机会 A' });
      const { items } = driverRepo.listByProject(projectId, { driverType: 'opportunity' });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((d) => d.driverType === 'opportunity')).toBe(true);
    });
  });

  // ------------------------------------------------------- OutcomeRepo ---
  describe('OutcomeRepo', () => {
    it('findById returns the outcome', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'outcome',
        statement: '成果驱动',
      });
      const row = buildOutcomeRow({
        projectId,
        driverId: driver.id,
        description: '用户留存率提升至 60%',
        epistemicType: 'Fact',
        successMetric: '留存率',
        targetValue: '60%',
        horizon: 'now',
      });
      db.db.insert(outcomes).values(row).run();

      const found = outcomeRepo.findById(row.id!);
      expect(found).not.toBeNull();
      expect(found!.description).toBe('用户留存率提升至 60%');
      expect(found!.epistemicType).toBe('Fact');
    });

    it('updates fields and increments version', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'outcome',
        statement: '成果驱动 2',
      });
      const row = buildOutcomeRow({
        projectId,
        driverId: driver.id,
        description: '原始描述',
        epistemicType: 'Inference',
      });
      db.db.insert(outcomes).values(row).run();

      const updated = outcomeRepo.update(row.id!, {
        description: '更新后的描述',
        targetValue: '75%',
        expectedVersion: 1,
      });
      expect(updated.description).toBe('更新后的描述');
      expect(updated.targetValue).toBe('75%');
      expect(updated.version).toBe(2);
    });

    it('rejects update with wrong expectedVersion', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'outcome',
        statement: '成果驱动 3',
      });
      const row = buildOutcomeRow({
        projectId,
        driverId: driver.id,
        description: '并发测试',
        epistemicType: 'Assumption',
      });
      db.db.insert(outcomes).values(row).run();

      expect(() =>
        outcomeRepo.update(row.id!, {
          description: 'should fail',
          expectedVersion: 999,
        }),
      ).toThrow(ApiError);
    });
  });

  // --------------------------------------------------- RequirementRepo ---
  describe('RequirementRepo', () => {
    it('findById returns the requirement with provenance', () => {
      const row = buildRequirementRow({
        projectId,
        requirementKey: 'REQ-001',
        statement: '系统 SHALL 支持用户登录',
        requirementType: 'functional',
        provenance: 'explicitly_stated',
        commitment: 'committed',
        stability: 'stable',
      });
      db.db.insert(requirements).values(row).run();

      const found = requirementRepo.findById(row.id!);
      expect(found).not.toBeNull();
      expect(found!.provenance).toBe('explicitly_stated');
      expect(found!.requirementKey).toBe('REQ-001');
    });

    it('updates provenance and increments version', () => {
      const row = buildRequirementRow({
        projectId,
        requirementKey: 'REQ-002',
        statement: '原始需求',
        requirementType: 'functional',
        provenance: 'assumed',
        commitment: 'conditional',
        stability: 'stable',
      });
      db.db.insert(requirements).values(row).run();

      const updated = requirementRepo.update(row.id!, {
        provenance: 'derived',
        statement: '派生需求',
        expectedVersion: 1,
      });
      expect(updated.provenance).toBe('derived');
      expect(updated.statement).toBe('派生需求');
      expect(updated.version).toBe(2);
    });

    it('rejects update with wrong expectedVersion', () => {
      const row = buildRequirementRow({
        projectId,
        requirementKey: 'REQ-003',
        statement: '并发测试',
        requirementType: 'functional',
        provenance: 'proposed',
        commitment: 'speculation',
        stability: 'experimental',
      });
      db.db.insert(requirements).values(row).run();

      expect(() =>
        requirementRepo.update(row.id!, {
          statement: 'should fail',
          expectedVersion: 999,
        }),
      ).toThrow(ApiError);
    });

    it('listByProject filters by provenance', () => {
      const row = buildRequirementRow({
        projectId,
        requirementKey: 'REQ-004',
        statement: '过滤测试',
        requirementType: 'functional',
        provenance: 'derived',
        commitment: 'committed',
        stability: 'stable',
      });
      db.db.insert(requirements).values(row).run();

      const { items } = requirementRepo.listByProject(projectId, { provenance: 'derived' });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((r) => r.provenance === 'derived')).toBe(true);
    });
  });

  // ---------------------------------------------------- AcceptanceRepo ---
  describe('AcceptanceRepo', () => {
    it('creates an acceptance criterion linked to a requirement', () => {
      const reqRow = buildRequirementRow({
        projectId,
        requirementKey: 'REQ-AC-001',
        statement: '验收测试需求',
        requirementType: 'functional',
        provenance: 'explicitly_stated',
        commitment: 'committed',
        stability: 'stable',
      });
      db.db.insert(requirements).values(reqRow).run();

      const ac = acceptanceRepo.create({
        requirementId: reqRow.id!,
        actionOrCondition: '当用户点击登录按钮',
        expectedResult: '系统在 2 秒内响应',
      });
      expect(ac.id).toMatch(/^ac_/);
      expect(ac.requirementId).toBe(reqRow.id);
      expect(ac.actionOrCondition).toBe('当用户点击登录按钮');
    });

    it('listByRequirement returns criteria for a requirement', () => {
      const reqRow = buildRequirementRow({
        projectId,
        requirementKey: 'REQ-AC-002',
        statement: '验收列表测试',
        requirementType: 'functional',
        provenance: 'explicitly_stated',
        commitment: 'committed',
        stability: 'stable',
      });
      db.db.insert(requirements).values(reqRow).run();
      acceptanceRepo.create({
        requirementId: reqRow.id!,
        actionOrCondition: '条件 A',
        expectedResult: '结果 A',
      });

      const { items } = acceptanceRepo.listByRequirement(reqRow.id!);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((a) => a.requirementId === reqRow.id)).toBe(true);
    });
  });

  // ------------------------------------------------- VerificationRepo ---
  describe('VerificationRepo', () => {
    it('creates a verification artifact for a requirement', () => {
      const reqRow = buildRequirementRow({
        projectId,
        requirementKey: 'REQ-VA-001',
        statement: '验证工件测试',
        requirementType: 'functional',
        provenance: 'explicitly_stated',
        commitment: 'committed',
        stability: 'stable',
      });
      db.db.insert(requirements).values(reqRow).run();

      const va = verificationRepo.create({
        requirementId: reqRow.id!,
        artifactType: 'test',
        description: '单元测试验证',
        result: 'passed',
        verifiedBy: ownerId,
      });
      expect(va.id).toMatch(/^va_/);
      expect(va.requirementId).toBe(reqRow.id);
      expect(va.artifactType).toBe('test');
    });
  });

  // ----------------------------------------------------- ScenarioRepo ---
  describe('ScenarioRepo', () => {
    it('creates a future Scenario with horizon', () => {
      const scenario = scenarioRepo.create({
        projectId,
        name: '市场扩张场景',
        description: '进入新市场后的系统演进',
        activationTrigger: '新市场签约',
        leadingIndicators: ['签约量', '用户增长'],
        horizon: 'next',
      });
      expect(scenario.id).toMatch(/^fsc_/);
      expect(scenario.horizon).toBe('next');
      expect(JSON.parse(scenario.leadingIndicatorsJson)).toEqual(['签约量', '用户增长']);
    });

    it('listByProject returns scenarios', () => {
      scenarioRepo.create({
        projectId,
        name: '技术债场景',
        description: '技术债积累导致重构',
        activationTrigger: '代码质量下降',
        leadingIndicators: [],
        horizon: 'later',
      });
      const { items } = scenarioRepo.listByProject(projectId);
      expect(items.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------ ConflictRepo ---
  describe('ConflictRepo', () => {
    function seedConflict(status = 'open', version = 1) {
      const id = generateId('cfl');
      const ts = now();
      db.db
        .insert(conflicts)
        .values({
          id,
          projectId,
          statement: '需求 A 与需求 B 存在冲突',
          severity: 'high',
          blocking: 1,
          ownerId: null,
          status,
          version,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return id;
    }

    function seedOption(conflictId: string) {
      const id = generateId('opt');
      const ts = now();
      db.db
        .insert(conflictOptions)
        .values({
          id,
          conflictId,
          description: '候选方案 A',
          benefits: '成本低',
          costs: '周期长',
          risks: '低风险',
          reversibility: 'medium',
          status: 'candidate',
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      return id;
    }

    it('findById returns the conflict', () => {
      const id = seedConflict();
      const found = conflictRepo.findById(id);
      expect(found).not.toBeNull();
      expect(found!.severity).toBe('high');
      expect(found!.blocking).toBe(1);
    });

    it('listByProject returns conflicts', () => {
      seedConflict();
      const { items } = conflictRepo.listByProject(projectId);
      expect(items.length).toBeGreaterThan(0);
    });

    it('resolves a conflict and increments version', () => {
      const id = seedConflict();
      const optId = seedOption(id);
      const { conflict, decision } = conflictRepo.resolve(id, {
        resolution: {
          decision: {
            question: '选择哪个方案?',
            selectedOptionId: optId,
            rationale: '方案 A 成本更低',
          },
          ownerId,
        },
        resolverId: ownerId,
        expectedVersion: 1,
      });
      expect(conflict.status).toBe('resolved');
      expect(conflict.version).toBe(2);
      expect(decision.selectedOptionId).toBe(optId);
      expect(decision.rationale).toBe('方案 A 成本更低');
    });

    it('rejects resolve with wrong expectedVersion', () => {
      const id = seedConflict();
      const optId = seedOption(id);
      expect(() =>
        conflictRepo.resolve(id, {
          resolution: {
            decision: {
              question: 'q',
              selectedOptionId: optId,
              rationale: 'r',
            },
            ownerId,
          },
          resolverId: ownerId,
          expectedVersion: 999,
        }),
      ).toThrow(ApiError);
    });

    it('rejects resolving an already-resolved conflict', () => {
      const id = seedConflict('resolved', 2);
      const optId = seedOption(id);
      expect(() =>
        conflictRepo.resolve(id, {
          resolution: {
            decision: {
              question: 'q',
              selectedOptionId: optId,
              rationale: 'r',
            },
            ownerId,
          },
          resolverId: ownerId,
          expectedVersion: 2,
        }),
      ).toThrow(ApiError);
    });

    it('loadConflictDetail assembles sides/options/decision', () => {
      const id = seedConflict();
      const conflict = conflictRepo.findById(id)!;
      const detail = loadConflictDetail(db.db, conflict);
      expect(detail.conflict.id).toBe(id);
      expect(Array.isArray(detail.sides)).toBe(true);
      expect(Array.isArray(detail.options)).toBe(true);
      expect(detail.currentDecision).toBeNull();
    });
  });

  // -------------------------------------------------------- ReviewRepo ---
  describe('ReviewRepo', () => {
    it('creates a typed review action for an outcome', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'outcome',
        statement: '评审测试成果',
      });
      const row = buildOutcomeRow({
        projectId,
        driverId: driver.id,
        description: '待评审成果',
        epistemicType: 'Proposal',
      });
      db.db.insert(outcomes).values(row).run();

      const review = reviewRepo.create({
        projectId,
        entityType: 'outcome',
        entityId: row.id!,
        entityVersion: 1,
        action: 'accept',
        reviewerId: ownerId,
        reason: '成果定义清晰、可度量',
      });
      expect(review.id).toMatch(/^rv_/);
      expect(review.entityType).toBe('outcome');
      expect(review.action).toBe('accept');
      expect(review.gate).toBeNull();
    });

    it('reviewGate records a gate review with gate column set', () => {
      const review = reviewRepo.reviewGate({
        projectId,
        gateType: 'scope',
        action: 'accept',
        reviewerId: ownerId,
        entityVersion: 1,
        reason: '范围已确认',
      });
      expect(review.gate).toBe('scope');
      expect(review.entityType).toBe('project');
      expect(review.action).toBe('accept');
    });

    it('listByEntity returns reviews for an entity', () => {
      const driver = driverRepo.create({
        projectId,
        driverType: 'goal',
        statement: '列表评审测试',
      });
      reviewRepo.create({
        projectId,
        entityType: 'driver',
        entityId: driver.id,
        entityVersion: 1,
        action: 'modify',
        reviewerId: ownerId,
        reason: '建议修改',
      });

      const reviews = reviewRepo.listByEntity('driver', driver.id);
      expect(reviews.length).toBeGreaterThan(0);
      expect(reviews[0].entityId).toBe(driver.id);
    });

    it('listGateReviews returns gate reviews for a project+gate', () => {
      const gateType: ReviewGateType = 'outcome';
      reviewRepo.reviewGate({
        projectId,
        gateType,
        action: 'uncertain',
        reviewerId: ownerId,
        entityVersion: 1,
        reason: '需要更多信息',
      });

      const reviews = reviewRepo.listGateReviews(projectId, gateType);
      expect(reviews.length).toBeGreaterThan(0);
      expect(reviews.every((r) => r.gate === gateType)).toBe(true);
    });
  });

  // --------------------------------------------------- StakeholderRepo ---
  describe('StakeholderRepo', () => {
    it('listByProject returns stakeholders', () => {
      const id = generateId('stk');
      const ts = now();
      db.db
        .insert(stakeholders)
        .values({
          id,
          projectId,
          name: '产品经理',
          role: '决策者',
          epistemicType: 'Fact',
          status: 'candidate',
          version: 1,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();

      const { items } = stakeholderRepo.listByProject(projectId);
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((s) => s.name === '产品经理')).toBe(true);
    });
  });

  // ------------------------------------------------- EvidenceLinkRepo ---
  describe('EvidenceLinkRepo', () => {
    it('listByProject returns empty array for a fresh project', () => {
      const items = evidenceLinkRepo.listByProject(projectId);
      expect(Array.isArray(items)).toBe(true);
    });

    it('listTraceLinks returns empty array for a fresh project', () => {
      const items = evidenceLinkRepo.listTraceLinks(projectId);
      expect(Array.isArray(items)).toBe(true);
    });
  });
});
