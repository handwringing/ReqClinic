import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from './helpers/test-db';
import { ProjectRepo } from '../src/repo/project-repo';
import { MemberRepo } from '../src/repo/member-repo';
import { IntakeRepo } from '../src/repo/intake-repo';
import { now } from '../src/shared/time';
import { ApiError } from '../src/http/errors';

/**
 * Repository-level tests for the project/member/intake domain (Task 15).
 */
describe('project repos', () => {
  let db: AppDb;
  let userId: string;

  beforeAll(() => {
    db = createTestDb();
    userId = 'usr_test_1';
    db.raw
      .prepare(
        `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, 'Test User', 'auth|test1', 'active', now(), now());
  });

  // ----------------------------------------------------- ProjectRepo ---

  describe('ProjectRepo', () => {
    it('creates a project in Draft status with version 1', () => {
      const repo = new ProjectRepo(db.db);
      const project = repo.create({
        ownerId: userId,
        name: 'My Project',
        description: 'A test project',
      });

      expect(project.id).toMatch(/^prj_/);
      expect(project.status).toBe('Draft');
      expect(project.version).toBe(1);
      expect(project.ownerId).toBe(userId);

      const found = repo.findById(project.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('My Project');
    });

    it('updates fields and increments version', () => {
      const repo = new ProjectRepo(db.db);
      const project = repo.create({
        ownerId: userId,
        name: 'Version Test',
      });

      const updated = repo.update(project.id, {
        name: 'Updated Name',
        riskLevel: 'medium',
        expectedVersion: 1,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.riskLevel).toBe('medium');
      expect(updated.version).toBe(2);
    });

    it('rejects update with wrong expectedVersion', () => {
      const repo = new ProjectRepo(db.db);
      const project = repo.create({
        ownerId: userId,
        name: 'Conflict Test',
      });

      expect(() =>
        repo.update(project.id, {
          name: 'Should Fail',
          expectedVersion: 999,
        }),
      ).toThrow(ApiError);
    });

    it('creates an Owner member on project creation', () => {
      const repo = new ProjectRepo(db.db);
      const memberRepo = new MemberRepo(db.db);

      const project = repo.create({
        ownerId: userId,
        name: 'Owner Member Test',
      });

      const member = memberRepo.findMember(project.id, userId);
      expect(member).not.toBeNull();
      expect(member!.status).toBe('active');

      const caps = JSON.parse(member!.capabilitiesJson) as string[];
      expect(caps).toContain('read');
      expect(caps).toContain('edit');
      expect(caps).toContain('review');
      expect(caps).toContain('export');
      expect(caps).toContain('manage_members');
    });
  });

  // ------------------------------------------------------ MemberRepo ---

  describe('MemberRepo', () => {
    it('adds a member and checks capabilities', () => {
      const projectRepo = new ProjectRepo(db.db);
      const memberRepo = new MemberRepo(db.db);

      const project = projectRepo.create({
        ownerId: userId,
        name: 'Member Test',
      });

      // Add a second user first.
      const secondUser = 'usr_test_2';
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(secondUser, 'User Two', 'auth|test2', 'active', now(), now());

      const member = memberRepo.add({
        projectId: project.id,
        userId: secondUser,
        capabilities: ['read', 'edit'],
        grantedBy: userId,
      });

      expect(member.status).toBe('active');
      expect(member.version).toBe(1);

      // hasCapability checks
      expect(memberRepo.hasCapability(project.id, secondUser, 'read')).toBe(true);
      expect(memberRepo.hasCapability(project.id, secondUser, 'edit')).toBe(true);
      expect(memberRepo.hasCapability(project.id, secondUser, 'export')).toBe(false);

      // Owner should have manage_members
      expect(memberRepo.hasCapability(project.id, userId, 'manage_members')).toBe(true);
    });
  });

  // ------------------------------------------------------ IntakeRepo ---

  describe('IntakeRepo', () => {
    it('creates an intake with a non-null content_hash', () => {
      const projectRepo = new ProjectRepo(db.db);
      const intakeRepo = new IntakeRepo(db.db);

      const project = projectRepo.create({
        ownerId: userId,
        name: 'Intake Test',
      });

      const intake = intakeRepo.create({
        projectId: project.id,
        originalText: 'We need a system to track patient appointments.',
        decisionIntent: 'Choose between build vs buy.',
        candidateRoles: ['doctor', 'receptionist'],
        candidateConstraints: ['HIPAA compliance'],
        submittedBy: userId,
      });

      expect(intake.id).toMatch(/^int_/);
      expect(intake.intakeVersion).toBe(1);
      expect(intake.contentHash).not.toBeNull();
      expect(intake.contentHash).toHaveLength(64); // SHA-256 hex
      expect(intake.supersedesIntakeId).toBeNull();

      const latest = intakeRepo.findLatest(project.id);
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(intake.id);
    });

    it('supersedes the previous version on re-create', () => {
      const projectRepo = new ProjectRepo(db.db);
      const intakeRepo = new IntakeRepo(db.db);

      const project = projectRepo.create({
        ownerId: userId,
        name: 'Supersede Test',
      });

      const v1 = intakeRepo.create({
        projectId: project.id,
        originalText: 'First version.',
        submittedBy: userId,
      });
      const v2 = intakeRepo.create({
        projectId: project.id,
        originalText: 'Second version.',
        submittedBy: userId,
      });

      expect(v1.intakeVersion).toBe(1);
      expect(v2.intakeVersion).toBe(2);
      expect(v2.supersedesIntakeId).toBe(v1.id);
    });
  });
});
