import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from './helpers/test-db';
import { QuickSessionRepo } from '../src/repo/quick-session-repo';
import { QuickTurnRepo } from '../src/repo/quick-turn-repo';
import { BriefRepo } from '../src/repo/brief-repo';
import { now, addDays } from '../src/shared/time';
import { ApiError } from '../src/http/errors';

/**
 * Repository-level tests for the quick-consult domain (Task 13).
 *
 * Each test file gets a fresh in-memory database via the `forks` pool, so there
 * is no cross-test contamination. Prerequisite rows (guest sessions) are
 * inserted with raw SQL to keep the setup minimal.
 */
describe('quick-consult repos', () => {
  let db: AppDb;
  let guestId: string;

  beforeAll(() => {
    db = createTestDb();
    guestId = 'gst_test_1';
    db.raw
      .prepare(
        `INSERT INTO guest_sessions (id, session_key_digest, created_at, last_active_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(guestId, 'digest_1', now(), now(), addDays(now(), 30));
  });

  // --------------------------------------------------- QuickSessionRepo ---

  describe('QuickSessionRepo', () => {
    it('creates a session, finds it by id, and starts at version 1', () => {
      const repo = new QuickSessionRepo(db.db);
      const session = repo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'I want to build a booking app',
        targetUseCase: 'decide MVP scope',
        candidateTitles: ['BookingApp', 'SchedulePro'],
      });

      expect(session.id).toMatch(/^qs_/);
      expect(session.status).toBe('draft');
      expect(session.version).toBe(1);
      expect(session.originalInput).toBe('I want to build a booking app');
      expect(session.guestSessionId).toBe(guestId);

      const found = repo.findById(session.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(session.id);
    });

    it('transitions status with version increment', () => {
      const repo = new QuickSessionRepo(db.db);
      const session = repo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'Another idea',
      });

      const updated = repo.updateStatus(session.id, 'clarifying');
      expect(updated.status).toBe('clarifying');
      expect(updated.version).toBe(2);

      const again = repo.updateStatus(session.id, 'understanding_review', 2);
      expect(again.status).toBe('understanding_review');
      expect(again.version).toBe(3);
    });

    it('rejects version-conflicted updateStatus', () => {
      const repo = new QuickSessionRepo(db.db);
      const session = repo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'Version conflict test',
      });

      expect(() =>
        repo.updateStatus(session.id, 'clarifying', 999),
      ).toThrow(ApiError);
    });

    it('rejects invalid state transition', () => {
      const repo = new QuickSessionRepo(db.db);
      const session = repo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'Invalid transition test',
      });

      // draft → brief_ready is not a valid single-step transition
      expect(() => repo.updateStatus(session.id, 'brief_ready')).toThrow(ApiError);
    });

    it('verifies actor ownership via findByIdForActor', () => {
      const repo = new QuickSessionRepo(db.db);
      const session = repo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'Owner check',
      });

      // Correct actor
      const owned = repo.findByIdForActor(session.id, { kind: 'guest', id: guestId });
      expect(owned.id).toBe(session.id);

      // Wrong actor — should throw NOT_FOUND
      expect(() =>
        repo.findByIdForActor(session.id, { kind: 'guest', id: 'gst_other' }),
      ).toThrow(ApiError);
    });
  });

  // ----------------------------------------------------- QuickTurnRepo ---

  describe('QuickTurnRepo', () => {
    it('creates turns with auto-incrementing index and lists them', () => {
      const sessionRepo = new QuickSessionRepo(db.db);
      const turnRepo = new QuickTurnRepo(db.db);

      const session = sessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'Turn test',
      });

      const t0 = turnRepo.create({
        quickSessionId: session.id,
        role: 'ai',
        content: 'What problem are you solving?',
        messageType: 'question',
      });
      const t1 = turnRepo.create({
        quickSessionId: session.id,
        role: 'user',
        content: 'I need to manage appointments.',
      });

      expect(t0.turnIndex).toBe(0);
      expect(t1.turnIndex).toBe(1);

      const { items } = turnRepo.listBySession(session.id);
      expect(items).toHaveLength(2);
      // listBySession returns ascending order
      expect(items[0].id).toBe(t0.id);
      expect(items[1].id).toBe(t1.id);
    });
  });

  // -------------------------------------------------------- BriefRepo ---

  describe('BriefRepo', () => {
    it('creates versions, finds by version number, and auto-increments', () => {
      const sessionRepo = new QuickSessionRepo(db.db);
      const briefRepo = new BriefRepo(db.db);

      const session = sessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'Brief version test',
      });

      const v1 = briefRepo.createVersion({
        quickSessionId: session.id,
        viewType: 'simple',
        contentJson: JSON.stringify({ title: 'v1' }),
      });
      const v2 = briefRepo.createVersion({
        quickSessionId: session.id,
        viewType: 'simple',
        contentJson: JSON.stringify({ title: 'v2' }),
      });

      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);

      const found = briefRepo.findVersion(session.id, 1);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(v1.id);

      const latest = briefRepo.findLatestVersion(session.id);
      expect(latest).not.toBeNull();
      expect(latest!.version).toBe(2);
    });

    it('creates an export and reports non-expired status', () => {
      const sessionRepo = new QuickSessionRepo(db.db);
      const briefRepo = new BriefRepo(db.db);

      const session = sessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'Export test',
      });

      const version = briefRepo.createVersion({
        quickSessionId: session.id,
        contentJson: '{}',
      });

      const exportRow = briefRepo.createExport({
        briefVersionId: version.id,
        format: 'copy',
      });

      expect(exportRow.id).toMatch(/^be_/);
      expect(exportRow.expiresAt).not.toBeNull();

      const result = briefRepo.findExport(exportRow.id);
      expect(result).not.toBeNull();
      expect(result!.expired).toBe(false);
    });

    it('reports expired status when expires_at is in the past', () => {
      const sessionRepo = new QuickSessionRepo(db.db);
      const briefRepo = new BriefRepo(db.db);

      const session = sessionRepo.create({
        actorKind: 'guest',
        guestSessionId: guestId,
        sourceKind: 'custom',
        originalIdea: 'Expiry test',
      });

      const version = briefRepo.createVersion({
        quickSessionId: session.id,
        contentJson: '{}',
      });

      const exportRow = briefRepo.createExport({
        briefVersionId: version.id,
        format: 'download',
      });

      // Force the expiry into the past.
      db.raw
        .prepare('UPDATE brief_exports SET expires_at = ? WHERE id = ?')
        .run('2020-01-01T00:00:00Z', exportRow.id);

      const result = briefRepo.findExport(exportRow.id);
      expect(result).not.toBeNull();
      expect(result!.expired).toBe(true);
    });
  });
});
