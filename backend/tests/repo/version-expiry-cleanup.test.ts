import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from '../helpers/test-db';
import { ProjectRepo } from '../../src/repo/project-repo';
import { MemberRepo } from '../../src/repo/member-repo';
import { DomainProfileRepo } from '../../src/repo/domain-repo';
import { QuickSessionRepo } from '../../src/repo/quick-session-repo';
import { BriefRepo } from '../../src/repo/brief-repo';
import { EventRepo } from '../../src/repo/event-repo';
import { UserRepo } from '../../src/repo/user-repo';
import { now, addDays } from '../../src/shared/time';

/**
 * Version-increment, 24h-expiry and 90-day-cleanup repository tests.
 *
 * Existing repo-*.test.ts files already cover:
 *   - projects.version increment (repo-project)
 *   - quick_sessions.version increment (repo-quick)
 *   - brief_versions auto-increment (repo-quick)
 *   - product_events purgeOldEvents(90) (repo-training-event)
 *
 * This file fills the remaining gaps:
 *   - project_members.version increment via MemberRepo.update
 *   - domain_profiles.profile_version auto-increment per project (v1 → v2)
 *   - brief_exports 24h expiry window (expires_at ≈ exported_at + 1 day)
 *   - product_events.expires_at ≈ created_at + 90 days on create()
 */
describe('version increment / expiry / cleanup', () => {
  let db: AppDb;

  beforeAll(() => {
    db = createTestDb();
  });

  // ----------------------------------------- project_members.version -------

  describe('project_members.version increment', () => {
    it('update bumps version and persists the new capabilities', () => {
      const projectRepo = new ProjectRepo(db.db);
      const memberRepo = new MemberRepo(db.db);
      const ownerId = 'usr_mem_owner';
      const memberId = 'usr_mem_member';

      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(ownerId, 'Owner', 'auth|mem_owner', 'active', now(), now());
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(memberId, 'Member', 'auth|mem_member', 'active', now(), now());

      const project = projectRepo.create({ ownerId, name: 'Member Version Test' });
      memberRepo.add({
        projectId: project.id,
        userId: memberId,
        capabilities: ['read'],
        grantedBy: ownerId,
      });

      const before = memberRepo.findMember(project.id, memberId)!;
      expect(before.version).toBe(1);

      const updated = memberRepo.update(project.id, memberId, {
        capabilities: ['read', 'edit', 'review'],
        expectedVersion: 1,
      });
      expect(updated.version).toBe(2);
      expect(JSON.parse(updated.capabilitiesJson)).toEqual(['read', 'edit', 'review']);

      // Persisted.
      const after = memberRepo.findMember(project.id, memberId)!;
      expect(after.version).toBe(2);
    });

    it('rejects update with stale expectedVersion', () => {
      const projectRepo = new ProjectRepo(db.db);
      const memberRepo = new MemberRepo(db.db);
      const ownerId = 'usr_mem_owner2';
      const memberId = 'usr_mem_member2';

      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(ownerId, 'Owner2', 'auth|mem_owner2', 'active', now(), now());
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(memberId, 'Member2', 'auth|mem_member2', 'active', now(), now());

      const project = projectRepo.create({ ownerId, name: 'Member Conflict Test' });
      memberRepo.add({
        projectId: project.id,
        userId: memberId,
        capabilities: ['read'],
        grantedBy: ownerId,
      });

      expect(() =>
        memberRepo.update(project.id, memberId, {
          capabilities: ['edit'],
          expectedVersion: 999,
        }),
      ).toThrow(/version|conflict/i);
    });
  });

  // ------------------------------------- domain_profiles.profile_version --

  describe('domain_profiles.profile_version auto-increment', () => {
    it('creating a second profile for the same project yields profile_version=2', () => {
      const projectRepo = new ProjectRepo(db.db);
      const domainRepo = new DomainProfileRepo(db.db);
      const ownerId = 'usr_dpm_owner';

      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(ownerId, 'Dpm Owner', 'auth|dpm_owner', 'active', now(), now());

      const project = projectRepo.create({ ownerId, name: 'Domain Profile Version Test' });

      const v1 = domainRepo.create({
        projectId: project.id,
        candidatePackIds: ['general'],
        status: 'candidate',
      });
      expect(v1.profileVersion).toBe(1);

      const v2 = domainRepo.create({
        projectId: project.id,
        candidatePackIds: ['software-delivery'],
        status: 'candidate',
      });
      expect(v2.profileVersion).toBe(2);
      // The second profile supersedes the first by id.
      expect(v2.supersedesProfileId).toBe(v1.id);

      // uq_domain_profiles_project_version rejects a duplicate (project, version).
      expect(() =>
        db.raw
          .prepare(
            `INSERT INTO domain_profiles (id, project_id, profile_version, work_type,
               domain_labels_json, risk_flags_json, terminology_map_json,
               suggested_pack_ids_json, required_human_roles_json, routing_risk,
               routing_basis_json, rationale_evidence_links_json, unknowns_json,
               status, created_at)
             VALUES ('dpm_dup', ?, 1, 'unknown', '[]', '[]', '{}', '[]', '[]',
               'unknown', '{}', '[]', '[]', 'candidate', ?)`,
          )
          .run(project.id, now()),
      ).toThrow(/UNIQUE constraint failed/i);
    });
  });

  // --------------------------------------- brief_exports 24h expiry -------

  describe('brief_exports 24h expiry window', () => {
    it('createExport stamps expires_at ~24h after exported_at', () => {
      const guestId = 'gst_exp_24h';
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(guestId, 'digest_exp_24h', now(), now(), addDays(now(), 30));

      const sessionRepo = new QuickSessionRepo(db.db);
      const briefRepo = new BriefRepo(db.db);

      const session = sessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: '24h expiry test',
      });
      const version = briefRepo.createVersion({
        quickSessionId: session.id,
        contentJson: '{}',
      });
      const exportRow = briefRepo.createExport({
        briefVersionId: version.id,
        format: 'download',
      });

      expect(exportRow.expiresAt).not.toBeNull();
      // expires_at should be ~1 day after exported_at (within a 5-minute window
      // to tolerate test latency).
      const deltaMs =
        new Date(exportRow.expiresAt!).getTime() -
        new Date(exportRow.exportedAt).getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;
      expect(deltaMs).toBeGreaterThan(oneDayMs - 5 * 60 * 1000);
      expect(deltaMs).toBeLessThan(oneDayMs + 5 * 60 * 1000);
    });

    it('findExport reports non-expired for a fresh export and expired after forcing expiry', () => {
      const guestId = 'gst_exp_flip';
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(guestId, 'digest_exp_flip', now(), now(), addDays(now(), 30));

      const sessionRepo = new QuickSessionRepo(db.db);
      const briefRepo = new BriefRepo(db.db);

      const session = sessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'expiry flip test',
      });
      const version = briefRepo.createVersion({
        quickSessionId: session.id,
        contentJson: '{}',
      });
      const exportRow = briefRepo.createExport({
        briefVersionId: version.id,
        format: 'copy',
      });

      expect(briefRepo.findExport(exportRow.id)!.expired).toBe(false);

      // Force the expiry into the past — simulating the 24h window elapsing.
      db.raw
        .prepare('UPDATE brief_exports SET expires_at = ? WHERE id = ?')
        .run('2020-01-01T00:00:00Z', exportRow.id);
      expect(briefRepo.findExport(exportRow.id)!.expired).toBe(true);
    });
  });

  // --------------------------------------- product_events 90-day cleanup --

  describe('product_events 90-day expires_at + cleanup filter', () => {
    it('create sets expires_at ~90 days after creation', async () => {
      const userRepo = new UserRepo(db.db);
      const eventRepo = new EventRepo(db.db);
      const user = await userRepo.create({
        displayName: 'Event Expiry User',
        authSubject: 'auth|evt_exp',
      });

      const row = eventRepo.create({
        sessionId: 'AS_exp_90d',
        eventName: 'quick_session_started',
        attributes: {},
        actorKind: 'user',
        userId: user.id,
        eventId: 'EVT_exp_90d',
      });

      expect(row.expiresAt).not.toBeNull();
      // expires_at should be ~90 days after created_at (within a 5-minute window).
      const deltaMs =
        new Date(row.expiresAt!).getTime() -
        new Date(row.createdAt).getTime();
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      expect(deltaMs).toBeGreaterThan(ninetyDaysMs - 5 * 60 * 1000);
      expect(deltaMs).toBeLessThan(ninetyDaysMs + 5 * 60 * 1000);
    });

    it('purgeOldEvents(90) deletes events whose retention window has elapsed', async () => {
      const userRepo = new UserRepo(db.db);
      const eventRepo = new EventRepo(db.db);
      const user = await userRepo.create({
        displayName: 'Event Purge User',
        authSubject: 'auth|evt_purge',
      });

      // An event that is already past its 90-day expires_at (occurred 100 days
      // ago, so its expires_at ≈ 10 days ago).
      const oldOccurred = addDays(now(), -100);
      db.raw
        .prepare(
          `INSERT INTO product_events (id, event_id, event_name, event_schema_version,
             occurred_at, received_at, environment, app_version, mode, source_kind,
             analytics_session_id, actor_key, stage, experiment_id, attributes_json,
             created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, '{}', ?, ?)`,
        )
        .run(
          'pe_purge_old',
          'EVT_purge_filter_old',
          'quick_session_started',
          '1.0.0',
          oldOccurred,
          oldOccurred,
          'development',
          '1.0.0',
          'quick',
          'custom',
          'AS_purge_filter',
          oldOccurred,
          addDays(oldOccurred, 90),
        );

      // A fresh event whose 90-day window has not elapsed.
      eventRepo.create({
        sessionId: 'AS_purge_fresh',
        eventName: 'quick_session_started',
        attributes: {},
        actorKind: 'user',
        userId: user.id,
        eventId: 'EVT_purge_filter_fresh',
      });

      const deleted = eventRepo.purgeOldEvents(90);
      expect(deleted).toBeGreaterThanOrEqual(1);

      const remaining = db.raw
        .prepare(
          'SELECT event_id FROM product_events WHERE event_id IN (?, ?)',
        )
        .all('EVT_purge_filter_old', 'EVT_purge_filter_fresh') as {
        event_id: string;
      }[];
      const ids = remaining.map((r) => r.event_id);
      expect(ids).not.toContain('EVT_purge_filter_old');
      expect(ids).toContain('EVT_purge_filter_fresh');
    });
  });
});
