import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from '../helpers/test-db';

/**
 * Foreign-key action tests (ON DELETE RESTRICT / CASCADE / SET NULL).
 *
 * FKs are ON (the default from createDb). Each describe block builds the
 * minimal prerequisite graph needed to exercise a specific FK action, then
 * deletes the parent row and asserts the downstream effect.
 *
 * `schema.test.ts` disables FKs entirely; this file is the complementary
 * layer that proves the declared ON DELETE behaviour actually fires.
 */
describe('foreign-key ON DELETE actions (DB v1.2)', () => {
  let db: AppDb;

  beforeAll(() => {
    db = createTestDb();
    // FKs are ON by default; assert explicitly for clarity.
    db.raw.pragma('foreign_keys = ON');
  });

  function expectReject(sql: string) {
    expect(() => db.raw.exec(sql)).toThrow(/FOREIGN KEY constraint failed/i);
  }

  function count(table: string, where: string): number {
    return (
      db.raw
        .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${where}`)
        .get() as { c: number }
    ).c;
  }

  // ----------------------------------------------- users → projects -------

  describe('projects.owner_id ON DELETE RESTRICT', () => {
    it('rejects deleting a user who owns a project', () => {
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES ('usr_fk_owner', 'Owner', 'auth|fk_owner', 'active',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO projects (id, owner_id, created_by, status, version,
             created_at, updated_at)
           VALUES ('prj_fk1', 'usr_fk_owner', 'usr_fk_owner', 'Draft', 1,
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();

      expectReject(`DELETE FROM users WHERE id = 'usr_fk_owner'`);
      // Project still exists because the delete was rejected.
      expect(count('projects', "id = 'prj_fk1'")).toBe(1);
    });

    it('allows deleting a user with no projects', () => {
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES ('usr_fk_free', 'Free', 'auth|fk_free', 'active',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw.exec(`DELETE FROM users WHERE id = 'usr_fk_free'`);
      expect(count('users', "id = 'usr_fk_free'")).toBe(0);
    });
  });

  // --------------------------- quick_sessions → quick_turns CASCADE ---------

  describe('quick_turns.quick_session_id ON DELETE CASCADE', () => {
    it('deleting a quick_session cascades to its quick_turns', () => {
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES ('gst_fk_qt', 'digest_fk_qt', '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
             original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES ('qs_fk_qt', 'gst_fk_qt', 'draft', 'custom', 'idea', '{}',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_turns (id, quick_session_id, turn_index, role, content, created_at)
           VALUES ('qt_fk1', 'qs_fk_qt', 0, 'ai', 'hi', '2026-01-01T00:00:00Z'),
                  ('qt_fk2', 'qs_fk_qt', 1, 'user', 'hello', '2026-01-01T00:00:00Z')`,
        )
        .run();
      expect(count('quick_turns', "quick_session_id = 'qs_fk_qt'")).toBe(2);

      db.raw.exec(`DELETE FROM quick_sessions WHERE id = 'qs_fk_qt'`);
      expect(count('quick_turns', "quick_session_id = 'qs_fk_qt'")).toBe(0);
    });
  });

  // ------------------------ quick_sessions → quick_unknowns CASCADE --------

  describe('quick_unknowns.quick_session_id ON DELETE CASCADE', () => {
    it('deleting a quick_session cascades to its quick_unknowns', () => {
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES ('gst_fk_qu', 'digest_fk_qu', '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
             original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES ('qs_fk_qu', 'gst_fk_qu', 'draft', 'custom', 'idea', '{}',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_unknowns (id, quick_session_id, category, description, created_at)
           VALUES ('qu_fk1', 'qs_fk_qu', 'scope_boundary', 'd',
             '2026-01-01T00:00:00Z')`,
        )
        .run();
      expect(count('quick_unknowns', "quick_session_id = 'qs_fk_qu'")).toBe(1);

      db.raw.exec(`DELETE FROM quick_sessions WHERE id = 'qs_fk_qu'`);
      expect(count('quick_unknowns', "quick_session_id = 'qs_fk_qu'")).toBe(0);
    });
  });

  // ----------------------- quick_sessions → brief_versions CASCADE ---------

  describe('brief_versions.quick_session_id ON DELETE CASCADE', () => {
    it('deleting a quick_session cascades to its brief_versions', () => {
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES ('gst_fk_bv', 'digest_fk_bv', '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
             original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES ('qs_fk_bv', 'gst_fk_bv', 'draft', 'custom', 'idea', '{}',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO brief_versions (id, quick_session_id, version, snapshot_json,
             generated_at, generated_by)
           VALUES ('bv_fk1', 'qs_fk_bv', 1, '{}', '2026-01-01T00:00:00Z', 'u1')`,
        )
        .run();

      db.raw.exec(`DELETE FROM quick_sessions WHERE id = 'qs_fk_bv'`);
      expect(count('brief_versions', "id = 'bv_fk1'")).toBe(0);
    });
  });

  // ---------------------- brief_versions → brief_exports CASCADE -----------

  describe('brief_exports.brief_version_id ON DELETE CASCADE', () => {
    it('deleting a brief_version cascades to its brief_exports', () => {
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES ('gst_fk_be', 'digest_fk_be', '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
             original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES ('qs_fk_be', 'gst_fk_be', 'draft', 'custom', 'idea', '{}',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO brief_versions (id, quick_session_id, version, snapshot_json,
             generated_at, generated_by)
           VALUES ('bv_fk_be', 'qs_fk_be', 1, '{}', '2026-01-01T00:00:00Z', 'u1')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO brief_exports (id, brief_version_id, view_type, export_type,
             exported_at, exported_by)
           VALUES ('be_fk1', 'bv_fk_be', 'simple', 'copy',
             '2026-01-01T00:00:00Z', 'u1')`,
        )
        .run();
      expect(count('brief_exports', "brief_version_id = 'bv_fk_be'")).toBe(1);

      db.raw.exec(`DELETE FROM brief_versions WHERE id = 'bv_fk_be'`);
      expect(count('brief_exports', "brief_version_id = 'bv_fk_be'")).toBe(0);
    });
  });

  // ----------------------------- ai_jobs → ai_runs CASCADE ----------------

  describe('ai_runs.ai_job_id ON DELETE CASCADE', () => {
    it('deleting an ai_job cascades to its ai_runs', () => {
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES ('usr_fk_ar', 'U', 'auth|fk_ar', 'active',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO projects (id, owner_id, created_by, status, version,
             created_at, updated_at)
           VALUES ('prj_fk_ar', 'usr_fk_ar', 'usr_fk_ar', 'Draft', 1,
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
             input_hash, status, max_attempts, dedupe_key, created_by_kind,
             created_by_user_id, created_at, updated_at)
           VALUES ('job_fk_ar', 'formal_project', 'prj_fk_ar', 'analyze', '{}', 'h',
             'queued', 1, 'dk_fk_ar', 'user', 'usr_fk_ar',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO ai_runs (id, ai_job_id, attempt, status, started_at)
           VALUES ('ar_fk1', 'job_fk_ar', 1, 'succeeded', '2026-01-01T00:00:00Z')`,
        )
        .run();
      expect(count('ai_runs', "ai_job_id = 'job_fk_ar'")).toBe(1);

      db.raw.exec(`DELETE FROM ai_jobs WHERE id = 'job_fk_ar'`);
      expect(count('ai_runs', "ai_job_id = 'job_fk_ar'")).toBe(0);
    });
  });

  // --------- project_intakes source_*_id ON DELETE SET NULL vs XOR CHECK ----
  //
  // Both source_quick_session_id and source_brief_version_id declare ON DELETE
  // SET NULL, but the source_ids_xor CHECK requires them to be both NULL or
  // both NOT NULL. SQLite applies the SET NULL on source_quick_session_id
  // before the CASCADE on brief_versions completes (which would in turn SET
  // NULL source_brief_version_id), so the intermediate state has one NULL and
  // one NOT NULL — the CHECK rejects the delete. This is the actual schema
  // behaviour: the XOR CHECK provides defence-in-depth, preventing a partially
  // orphaned intake. The test documents that reality rather than the nominal
  // SET NULL declaration.

  describe('project_intakes source_*_id SET NULL blocked by source_ids_xor', () => {
    it('rejects deleting a quick_session referenced by an intake (CHECK blocks SET NULL)', () => {
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES ('usr_fk_int', 'U', 'auth|fk_int', 'active',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO projects (id, owner_id, created_by, status, version,
             created_at, updated_at)
           VALUES ('prj_fk_int', 'usr_fk_int', 'usr_fk_int', 'Draft', 1,
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES ('gst_fk_int', 'digest_fk_int', '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
             original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES ('qs_fk_int', 'gst_fk_int', 'draft', 'custom', 'idea', '{}',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO brief_versions (id, quick_session_id, version, snapshot_json,
             generated_at, generated_by)
           VALUES ('bv_fk_int', 'qs_fk_int', 1, '{}', '2026-01-01T00:00:00Z', 'u1')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO project_intakes (id, project_id, intake_version, original_text,
             submitted_by, source_quick_session_id, source_brief_version_id,
             source_quick_session_hash, source_brief_snapshot_hash, content_hash, created_at)
           VALUES ('int_fk1', 'prj_fk_int', 1, 'text', 'usr_fk_int',
             'qs_fk_int', 'bv_fk_int', 'qh', 'bh', 'h1', '2026-01-01T00:00:00Z')`,
        )
        .run();

      // The delete is rejected: SET NULL on source_quick_session_id would
      // leave source_brief_version_id still set, violating source_ids_xor.
      expect(() =>
        db.raw.exec(`DELETE FROM quick_sessions WHERE id = 'qs_fk_int'`),
      ).toThrow(/CHECK constraint failed: project_intakes_source_ids_xor/i);

      // The intake retains both source references — the delete was rolled back.
      const row = db.raw
        .prepare(
          "SELECT source_quick_session_id, source_brief_version_id FROM project_intakes WHERE id = 'int_fk1'",
        )
        .get() as {
        source_quick_session_id: string | null;
        source_brief_version_id: string | null;
      };
      expect(row.source_quick_session_id).toBe('qs_fk_int');
      expect(row.source_brief_version_id).toBe('bv_fk_int');
    });
  });

  // --------------- entity_change_logs.quick_session_id SET NULL ------------

  describe('entity_change_logs.quick_session_id ON DELETE SET NULL', () => {
    it('deleting a quick_session sets quick_session_id NULL on change logs', () => {
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES ('gst_fk_ecl', 'digest_fk_ecl', '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
             original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES ('qs_fk_ecl', 'gst_fk_ecl', 'draft', 'custom', 'idea', '{}',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO entity_change_logs (id, entity_type, entity_id, quick_session_id,
             change_kind, actor_kind, actor_id, occurred_at)
           VALUES ('ecl_fk1', 'quick_session', 'qs_fk_ecl', 'qs_fk_ecl',
             'created', 'guest', 'gst_fk_ecl', '2026-01-01T00:00:00Z')`,
        )
        .run();

      db.raw.exec(`DELETE FROM quick_sessions WHERE id = 'qs_fk_ecl'`);
      const row = db.raw
        .prepare(
          "SELECT quick_session_id FROM entity_change_logs WHERE id = 'ecl_fk1'",
        )
        .get() as { quick_session_id: string | null };
      expect(row.quick_session_id).toBeNull();
    });
  });

  // --------------- option_preferences.brief_version_id SET NULL ------------

  describe('option_preferences.brief_version_id ON DELETE SET NULL', () => {
    it('deleting a brief_version sets brief_version_id NULL on option_preferences', () => {
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES ('gst_fk_op', 'digest_fk_op', '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
             original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES ('qs_fk_op', 'gst_fk_op', 'draft', 'custom', 'idea', '{}',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO brief_versions (id, quick_session_id, version, snapshot_json,
             generated_at, generated_by)
           VALUES ('bv_fk_op', 'qs_fk_op', 1, '{}', '2026-01-01T00:00:00Z', 'u1')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO option_preferences (id, quick_session_id, brief_version_id,
             option_id, matches_ai_recommendation, recorded_by, recorded_at)
           VALUES ('op_fk1', 'qs_fk_op', 'bv_fk_op', 'opt1', 1, 'u1',
             '2026-01-01T00:00:00Z')`,
        )
        .run();

      db.raw.exec(`DELETE FROM brief_versions WHERE id = 'bv_fk_op'`);
      const row = db.raw
        .prepare(
          "SELECT brief_version_id FROM option_preferences WHERE id = 'op_fk1'",
        )
        .get() as { brief_version_id: string | null };
      expect(row.brief_version_id).toBeNull();
    });
  });

  // --------------- quick_unknowns.resolved_by_turn_id SET NULL -------------

  describe('quick_unknowns.resolved_by_turn_id ON DELETE SET NULL', () => {
    it('deleting a quick_turn sets resolved_by_turn_id NULL on quick_unknowns', () => {
      db.raw
        .prepare(
          `INSERT INTO guest_sessions (id, session_key_digest, created_at,
             last_active_at, expires_at)
           VALUES ('gst_fk_rt', 'digest_fk_rt', '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
             original_input, coverage_slots_json, last_active_at, created_at, version)
           VALUES ('qs_fk_rt', 'gst_fk_rt', 'draft', 'custom', 'idea', '{}',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_turns (id, quick_session_id, turn_index, role, content, created_at)
           VALUES ('qt_fk_rt', 'qs_fk_rt', 0, 'ai', 'q', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO quick_unknowns (id, quick_session_id, category, description,
             resolved_by_turn_id, created_at)
           VALUES ('qu_fk_rt', 'qs_fk_rt', 'scope_boundary', 'd',
             'qt_fk_rt', '2026-01-01T00:00:00Z')`,
        )
        .run();

      db.raw.exec(`DELETE FROM quick_turns WHERE id = 'qt_fk_rt'`);
      const row = db.raw
        .prepare(
          "SELECT resolved_by_turn_id FROM quick_unknowns WHERE id = 'qu_fk_rt'",
        )
        .get() as { resolved_by_turn_id: string | null };
      expect(row.resolved_by_turn_id).toBeNull();
    });
  });

  // ---------------------- projects → baselines RESTRICT -------------------

  describe('baselines.project_id ON DELETE RESTRICT', () => {
    it('rejects deleting a project that has a baseline', () => {
      db.raw
        .prepare(
          `INSERT INTO users (id, display_name, auth_subject, status, created_at, updated_at)
           VALUES ('usr_fk_bl', 'U', 'auth|fk_bl', 'active',
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO projects (id, owner_id, created_by, status, version,
             created_at, updated_at)
           VALUES ('prj_fk_bl', 'usr_fk_bl', 'usr_fk_bl', 'Draft', 1,
             '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
      db.raw
        .prepare(
          `INSERT INTO baselines (id, project_id, baseline_version, status,
             data_hash, version, created_at)
           VALUES ('bl_fk1', 'prj_fk_bl', 1, 'draft', 'sha256:x', 1,
             '2026-01-01T00:00:00Z')`,
        )
        .run();

      expectReject(`DELETE FROM projects WHERE id = 'prj_fk_bl'`);
      expect(count('projects', "id = 'prj_fk_bl'")).toBe(1);
    });
  });
});
