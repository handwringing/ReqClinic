import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from './helpers/test-db';
import { TrainingRepo } from '../src/repo/training-repo';
import { EventRepo } from '../src/repo/event-repo';
import { UserRepo } from '../src/repo/user-repo';
import { trainingCases } from '../src/db/schema/training';
import { productEvents } from '../src/db/schema/event';
import { generateId } from '../src/shared/id';
import { now, addDays } from '../src/shared/time';
import { ApiError } from '../src/http/errors';

/**
 * Repository tests for TrainingRepo + EventRepo (Task 29).
 *
 * Coverage focus: 案例版本 (case versioning), 反馈就绪 (feedback readiness),
 * 90 天清理 (event retention purge), plus attempt/question/summary flows and
 * event dedup / pseudonymization / completion-rate metric.
 */
describe('TrainingRepo + EventRepo (Task 29)', () => {
  let db: AppDb;
  let trainingRepo: TrainingRepo;
  let eventRepo: EventRepo;
  let userRepo: UserRepo;

  const caseId = 'TC_repo_001';
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    db = createTestDb();
    trainingRepo = new TrainingRepo(db.db);
    eventRepo = new EventRepo(db.db);
    userRepo = new UserRepo(db.db);

    // ── Seed two users (owner + non-owner). No guest sessions are needed
    //    here because the repo-level suite only exercises user-attributed
    //    attempts; guest flows are covered by the route tests. ────────────
    const user = await userRepo.create({
      displayName: 'Trainer',
      authSubject: 'auth|trainer',
    });
    userId = user.id;
    const other = await userRepo.create({
      displayName: 'Other',
      authSubject: 'auth|other',
    });
    otherUserId = other.id;

    // ── Seed a training case with two versions ─────────────────────────────
    const ts = now();
    db.db
      .insert(trainingCases)
      .values({
        id: generateId('tcase'),
        caseId,
        version: '1.0.0',
        title: '软件项目需求澄清',
        difficulty: 'medium',
        scenarioJson: JSON.stringify({ category: 'software', scene: 'scene-1' }),
        disclosureRulesJson: JSON.stringify([{ id: 'r1', disclose: 'goal' }]),
        rubricJson: JSON.stringify({
          answer_key: null,
          evaluation_dimensions: ['target_clarification', 'user_scenario'],
        }),
        status: 'active',
        createdAt: ts,
      })
      .run();
    db.db
      .insert(trainingCases)
      .values({
        id: generateId('tcase'),
        caseId,
        version: '1.1.0',
        title: '软件项目需求澄清 v1.1',
        difficulty: 'hard',
        scenarioJson: JSON.stringify({ category: 'software', scene: 'scene-2' }),
        disclosureRulesJson: JSON.stringify([]),
        rubricJson: JSON.stringify({
          answer_key: { dim: 1 },
          evaluation_dimensions: ['target_clarification'],
        }),
        status: 'active',
        createdAt: addDays(ts, 1),
      })
      .run();
  });

  // ── 案例版本 ───────────────────────────────────────────────────────────────

  describe('case versioning', () => {
    it('getCaseVersion returns the exact version row', () => {
      const v1 = trainingRepo.getCaseVersion(caseId, '1.0.0');
      expect(v1).not.toBeNull();
      expect(v1!.title).toBe('软件项目需求澄清');
      expect(v1!.difficulty).toBe('medium');

      const v11 = trainingRepo.getCaseVersion(caseId, '1.1.0');
      expect(v11).not.toBeNull();
      expect(v11!.difficulty).toBe('hard');
    });

    it('getCaseVersion returns null for unknown version', () => {
      expect(trainingRepo.getCaseVersion(caseId, '9.9.9')).toBeNull();
      expect(trainingRepo.getCaseVersion('TC_missing', '1.0.0')).toBeNull();
    });

    it('listCases returns the latest version per case id', () => {
      const { items, nextCursor } = trainingRepo.listCases({ limit: 10 });
      const found = items.find((c) => c.caseId === caseId);
      expect(found).toBeDefined();
      expect(found!.version).toBe('1.1.0'); // newest createdAt wins
      expect(found!.difficulty).toBe('hard');
      expect(nextCursor).toBeNull(); // only one case → no next page
    });
  });

  // ── 训练尝试 / 问题 / 总结 ───────────────────────────────────────────────

  describe('attempt / question / summary', () => {
    let attemptId: string;

    it('createAttempt starts an attempt in interviewing status', () => {
      const attempt = trainingRepo.createAttempt({
        caseId,
        caseVersion: '1.0.0',
        actorKind: 'user',
        userId,
      });
      attemptId = attempt.id;
      expect(attempt.status).toBe('interviewing');
      expect(attempt.attemptNumber).toBe(1);
      expect(attempt.caseId).toBe(caseId);
      expect(attempt.caseVersion).toBe('1.0.0');
      expect(attempt.userId).toBe(userId);
    });

    it('createAttempt throws TRAINING_CASE_NOT_FOUND for missing case', () => {
      expect(() =>
        trainingRepo.createAttempt({
          caseId: 'TC_missing',
          caseVersion: '1.0.0',
          actorKind: 'user',
          userId,
        }),
      ).toThrow(expect.objectContaining({ code: 'TRAINING_CASE_NOT_FOUND' }));
    });

    it('attempt_number increments per actor+case', () => {
      const a2 = trainingRepo.createAttempt({
        caseId,
        caseVersion: '1.0.0',
        actorKind: 'user',
        userId,
      });
      expect(a2.attemptNumber).toBe(2);
    });

    it('postQuestion increments question_index and stores a training-only turn for recovery', () => {
      const q0 = trainingRepo.postQuestion({
        attemptId,
        question: '目标用户是谁？',
        boundRefs: [{ id: 'case', title: '案例简介' }],
      });
      expect(q0.questionIndex).toBe(0);
      const q1 = trainingRepo.postQuestion({
        attemptId,
        question: '时间约束是什么？',
        messageType: 'clarification',
      });
      expect(q1.questionIndex).toBe(1);
      expect(q1.disclosureRuleHit).toBeNull();
      const turns = trainingRepo.listTurns(attemptId);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe('user');
      expect(turns[0].content).toBe('目标用户是谁？');
      expect(JSON.parse(turns[0].boundRefsJson)).toEqual([
        { id: 'case', title: '案例简介' },
      ]);
    });

    it('postSummary stores only a hash and transitions to summarizing', () => {
      const summary = trainingRepo.postSummary({
        attemptId,
        summary: '本系统面向中小设计团队……',
      });
      expect(summary.summaryHash).toMatch(/^[0-9a-f]{64}$/);
      expect(summary.version).toBe(1);
      // The plaintext must not appear anywhere in the stored hash.
      expect(summary.summaryHash).not.toContain('中小设计团队');

      const attempt = trainingRepo.findById(attemptId);
      expect(attempt!.status).toBe('summarizing');
    });

    it('findByIdForActor returns the attempt for the owner', () => {
      const attempt = trainingRepo.findByIdForActor(attemptId, {
        kind: 'user',
        id: userId,
      });
      expect(attempt.id).toBe(attemptId);
    });

    it('findByIdForActor throws NOT_FOUND for a non-owner', () => {
      expect(() =>
        trainingRepo.findByIdForActor(attemptId, {
          kind: 'user',
          id: otherUserId,
        }),
      ).toThrow(ApiError);
    });

    it('findByIdForActor throws NOT_FOUND for unknown attempt', () => {
      expect(() =>
        trainingRepo.findByIdForActor('ta_unknown', {
          kind: 'user',
          id: userId,
        }),
      ).toThrow(ApiError);
    });
  });

  // ── 反馈就绪 ───────────────────────────────────────────────────────────────

  describe('feedback readiness', () => {
    let attemptId: string;

    beforeAll(() => {
      const attempt = trainingRepo.createAttempt({
        caseId,
        caseVersion: '1.0.0',
        actorKind: 'user',
        userId,
      });
      attemptId = attempt.id;
    });

    it('getFeedback reports not ready before feedback exists', () => {
      const status = trainingRepo.getFeedback(attemptId);
      expect(status.ready).toBe(false);
      expect(status.feedback).toBeNull();
    });

    it('recordFeedback marks the attempt feedback_ready', () => {
      const fb = trainingRepo.recordFeedback({
        attemptId,
        coverageScoreBp: 7200,
        missingDimensionCount: 2,
        feedbackJson: JSON.stringify({ note: 'deterministic coverage' }),
        dimensionBreakdownJson: JSON.stringify([
          { dimension: '目标与用户', status: 'covered', evidence: '', comment: '' },
        ]),
        improvementExamplesJson: JSON.stringify([
          { before: 'a', after: 'b', reason: 'c' },
        ]),
      });
      expect(fb.coverageScoreBp).toBe(7200);
      expect(fb.missingDimensionCount).toBe(2);

      const attempt = trainingRepo.findById(attemptId);
      expect(attempt!.status).toBe('feedback_ready');
    });

    it('getFeedback reports ready after feedback is recorded', () => {
      const status = trainingRepo.getFeedback(attemptId);
      expect(status.ready).toBe(true);
      expect(status.feedback).not.toBeNull();
      expect(status.feedback!.coverageScoreBp).toBe(7200);
    });
  });

  // ── 产品埋点事件 ───────────────────────────────────────────────────────────

  describe('EventRepo', () => {
    it('create stores attributes as versioned JSON and pseudonymizes actor_key', () => {
      const row = eventRepo.create({
        sessionId: 'AS_repo_001',
        eventName: 'question_interaction',
        attributes: { question_template_id: 'QT_target_user', action: 'answered' },
        actorKind: 'user',
        userId: 'usr_secret_123',
      });
      // attributes round-trip as JSON
      const attrs = JSON.parse(row.attributesJson);
      expect(attrs.question_template_id).toBe('QT_target_user');
      // actor_key must NOT be the raw userId
      expect(row.actorKey).not.toBe('usr_secret_123');
      expect(row.actorKey).toMatch(/^[0-9a-f]{32}$/);
      // expires_at is ~90 days out (ISO string comparison works for UTC dates)
      expect(row.expiresAt > now()).toBe(true);
    });

    it('batchCreate deduplicates by event_id', () => {
      const dupId = 'EVT_repo_dup_001';
      const r1 = eventRepo.batchCreate([
        {
          sessionId: 'AS_dup',
          eventName: 'quick_session_started',
          attributes: {},
          actorKind: 'user',
          userId,
          eventId: dupId,
        },
        {
          sessionId: 'AS_dup',
          eventName: 'quick_session_started',
          attributes: {},
          actorKind: 'user',
          userId,
          eventId: dupId, // duplicate
        },
        {
          sessionId: 'AS_dup2',
          eventName: 'brief_generated',
          attributes: {},
          actorKind: 'user',
          userId,
          eventId: 'EVT_repo_dup_002',
        },
      ]);
      expect(r1.accepted).toBe(2);
      expect(r1.duplicates).toBe(1);
      expect(r1.rejected).toBe(0);
    });

    // ── 90 天清理 ──────────────────────────────────────────────────────────

    it('purgeOldEvents(90) deletes only events older than 90 days', () => {
      const oldTs = addDays(now(), -100);
      const recentTs = now();

      // Insert an old event directly (create() stamps createdAt=now).
      db.db
        .insert(productEvents)
        .values({
          id: generateId('pe'),
          eventId: 'EVT_purge_old',
          eventName: 'quick_session_started',
          eventSchemaVersion: '1.0.0',
          occurredAt: oldTs,
          receivedAt: oldTs,
          environment: 'development',
          appVersion: '1.0.0',
          mode: 'quick',
          sourceKind: 'custom',
          analyticsSessionId: 'AS_purge_old',
          actorKey: null,
          stage: null,
          experimentId: null,
          attributesJson: '{}',
          createdAt: oldTs,
          expiresAt: addDays(oldTs, 90),
        })
        .run();
      // Insert a recent event via the repo.
      eventRepo.create({
        sessionId: 'AS_purge_recent',
        eventName: 'quick_session_started',
        attributes: {},
        actorKind: 'user',
        userId,
        eventId: 'EVT_purge_recent',
        occurredAt: recentTs,
      });

      const deleted = eventRepo.purgeOldEvents(90);
      expect(deleted).toBeGreaterThanOrEqual(1);

      // The old event is gone; the recent one survives.
      const remaining = db.raw
        .prepare(
          'SELECT event_id FROM product_events WHERE event_id IN (?, ?)',
        )
        .all('EVT_purge_old', 'EVT_purge_recent') as { event_id: string }[];
      const ids = remaining.map((r) => r.event_id);
      expect(ids).not.toContain('EVT_purge_old');
      expect(ids).toContain('EVT_purge_recent');
    });

    it('getQuickCompletionRate counts distinct custom sessions', () => {
      // Two custom sessions started; one generated a brief.
      const t = now();
      const start = addDays(t, -7);
      eventRepo.create({
        sessionId: 'AS_complete_1',
        eventName: 'quick_session_started',
        attributes: {},
        actorKind: 'user',
        userId,
        eventId: 'EVT_qcr_s1',
        sourceKind: 'custom',
        occurredAt: t,
      });
      eventRepo.create({
        sessionId: 'AS_complete_2',
        eventName: 'quick_session_started',
        attributes: {},
        actorKind: 'user',
        userId,
        eventId: 'EVT_qcr_s2',
        sourceKind: 'custom',
        occurredAt: t,
      });
      eventRepo.create({
        sessionId: 'AS_complete_1',
        eventName: 'brief_generated',
        attributes: {},
        actorKind: 'user',
        userId,
        eventId: 'EVT_qcr_b1',
        sourceKind: 'custom',
        occurredAt: t,
      });
      // internal_test must be excluded.
      eventRepo.create({
        sessionId: 'AS_internal',
        eventName: 'quick_session_started',
        attributes: {},
        actorKind: 'user',
        userId,
        eventId: 'EVT_qcr_int',
        sourceKind: 'internal_test',
        occurredAt: t,
      });

      const result = eventRepo.getQuickCompletionRate({
        startDate: start,
        endDate: t,
        sourceKind: 'custom',
      });
      expect(result.denominator).toBeGreaterThanOrEqual(2);
      expect(result.numerator).toBeGreaterThanOrEqual(1);
      expect(result.numerator).toBeLessThanOrEqual(result.denominator);
    });
  });
});
