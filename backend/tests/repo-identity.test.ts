import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from './helpers/test-db';
import { GuestSessionRepo } from '../src/repo/guest-session-repo';
import {
  AgreementRepo,
} from '../src/repo/agreement-repo';
import { agreementVersions } from '../src/db/schema/identity';
import { generateId } from '../src/shared/id';
import { now } from '../src/shared/time';

const PEPPER = 'test-pepper';

/**
 * Identity & agreement repository tests (Task 10).
 *
 * Uses a fresh in-memory SQLite database per test file. Each `describe` block
 * gets its own DB instance so guest-session and agreement tests never share
 * state.
 */
describe('GuestSessionRepo', () => {
  let db: AppDb;
  let repo: GuestSessionRepo;

  beforeAll(() => {
    db = createTestDb();
    repo = new GuestSessionRepo(db.db, PEPPER);
  });

  it('create() returns a non-empty sessionKey and an id', async () => {
    const session = await repo.create();
    expect(session.id).toMatch(/^gst_/);
    expect(session.sessionKey).toBeTruthy();
    expect(session.sessionKey.length).toBeGreaterThan(20);
    expect(session.expiresAt).toBeTruthy();
  });

  it('findBySessionKey() finds the session created by create()', async () => {
    const session = await repo.create();
    const found = await repo.findBySessionKey(session.sessionKey);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(session.id);
  });

  it('the stored digest is not equal to the raw session key', async () => {
    const session = await repo.create();
    const found = await repo.findBySessionKey(session.sessionKey);
    expect(found).not.toBeNull();
    expect(found!.sessionKeyDigest).not.toBe(session.sessionKey);
    // The digest should be a 64-char hex string (SHA-256).
    expect(found!.sessionKeyDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('findBySessionKey() returns null for an unknown key', async () => {
    const found = await repo.findBySessionKey('nonexistent-key');
    expect(found).toBeNull();
  });

  it('touch() updates last_active_at and extends expires_at', async () => {
    const session = await repo.create();
    const before = await repo.findBySessionKey(session.sessionKey);
    expect(before).not.toBeNull();
    const originalExpiry = before!.expiresAt;

    // Wait a tick so the timestamp actually moves.
    await new Promise((r) => setTimeout(r, 10));
    await repo.touch(session.id);

    const after = await repo.findBySessionKey(session.sessionKey);
    expect(after).not.toBeNull();
    expect(after!.lastActiveAt).not.toBe(before!.lastActiveAt);
    expect(new Date(after!.expiresAt).getTime()).toBeGreaterThanOrEqual(
      new Date(originalExpiry).getTime(),
    );
  });

  it('exists() returns true for a valid session and false for unknown', async () => {
    const session = await repo.create();
    expect(await repo.exists(session.id)).toBe(true);
    expect(await repo.exists('gst_nonexistent')).toBe(false);
  });
});

describe('AgreementRepo', () => {
  let db: AppDb;
  let repo: AgreementRepo;
  let guestSessionRepo: GuestSessionRepo;
  let activeVersionId: string;

  beforeAll(async () => {
    db = createTestDb();
    repo = new AgreementRepo(db.db);
    guestSessionRepo = new GuestSessionRepo(db.db, PEPPER);

    // Seed an active agreement version.
    activeVersionId = generateId('agrv');
    await db.db.insert(agreementVersions).values({
      id: activeVersionId,
      version: '1.0.0',
      status: 'active',
      changeType: 'major',
      effectiveAt: now(),
      contentRef: 'agreement-v1.md',
      createdAt: now(),
    });
  });

  it('getActiveVersion() returns the seeded active version', async () => {
    const v = await repo.getActiveVersion();
    expect(v).not.toBeNull();
    expect(v!.id).toBe(activeVersionId);
    expect(v!.status).toBe('active');
  });

  it('hasValidConsent() returns false when no consent exists', async () => {
    const gs = await guestSessionRepo.create();
    expect(await repo.hasValidConsent({ guestSessionId: gs.id })).toBe(false);
  });

  it('hasValidConsent() returns true after createConsent()', async () => {
    const gs = await guestSessionRepo.create();
    const consent = await repo.createConsent({
      agreementVersionId: activeVersionId,
      actorKind: 'guest',
      guestSessionId: gs.id,
    });
    expect(consent.action).toBe('accepted');
    expect(await repo.hasValidConsent({ guestSessionId: gs.id })).toBe(true);
  });

  it('hasValidConsent() returns false after withdrawConsent()', async () => {
    const gs = await guestSessionRepo.create();
    const consent = await repo.createConsent({
      agreementVersionId: activeVersionId,
      actorKind: 'guest',
      guestSessionId: gs.id,
    });
    expect(await repo.hasValidConsent({ guestSessionId: gs.id })).toBe(true);

    const withdrawn = await repo.withdrawConsent(consent.id);
    expect(withdrawn.action).toBe('withdrawn');
    expect(await repo.hasValidConsent({ guestSessionId: gs.id })).toBe(false);
  });

  it('listConsents() returns history newest-first', async () => {
    const gs = await guestSessionRepo.create();
    await repo.createConsent({
      agreementVersionId: activeVersionId,
      actorKind: 'guest',
      guestSessionId: gs.id,
    });
    const list = await repo.listConsents({ guestSessionId: gs.id });
    expect(list.length).toBeGreaterThanOrEqual(1);
    // Newest first: occurred_at should be descending.
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].occurredAt >= list[i].occurredAt).toBe(true);
    }
  });

  it('works for user actors as well as guest actors', async () => {
    const userId = generateId('usr');
    // Insert the user row to satisfy the FK on agreement_consents.user_id.
    db.raw
      .prepare(
        `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, 'Test User', `auth|${userId}`, 'active', now(), now());
    expect(await repo.hasValidConsent({ userId })).toBe(false);
    await repo.createConsent({
      agreementVersionId: activeVersionId,
      actorKind: 'user',
      userId,
    });
    expect(await repo.hasValidConsent({ userId })).toBe(true);
  });
});
