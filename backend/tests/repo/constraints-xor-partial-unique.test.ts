import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from '../helpers/test-db';

/**
 * XOR / co-presence / conditional CHECK and partial unique-index tests.
 *
 * `schema.test.ts` covers the ai_jobs + quick_sessions + agreement_consents +
 * training_attempts XOR groups. This file fills the remaining gaps:
 *   - project_intakes source-ids / source-hashes XOR + supersede-version
 *     linkage + the two partial unique indexes (initial / successor)
 *   - upgrade_records status_target_xor
 *   - ai_runs domain_profile_xor
 *   - change_impacts source_xor
 *   - changes confirmed / withdrawn conditional checks
 *
 * FKs are disabled to keep CHECK/UNIQUE assertions isolated.
 */
describe('XOR + partial unique constraints (DB v1.2 gaps)', () => {
  let db: AppDb;

  beforeAll(() => {
    db = createTestDb();
    db.raw.pragma('foreign_keys = OFF');
  });

  function expectReject(sql: string, matcher: string | RegExp) {
    expect(() => db.raw.exec(sql)).toThrow(matcher);
  }

  const TS = "'2026-01-01T00:00:00Z'";

  // ================================================= project_intakes ======
  // §3.4 — supersede versioning + source-id XOR + partial unique indexes.

  describe('project_intakes supersede_version_check', () => {
    /** Valid initial intake (version=1, supersedes_intake_id NULL). */
    function initial(id: string, project: string, version = 1) {
      return `INSERT INTO project_intakes (id, project_id, intake_version,
        original_text, submitted_by, content_hash, created_at)
        VALUES ('${id}', '${project}', ${version}, 'text', 'u1', 'h1', ${TS})`;
    }

    it('rejects version=1 with a supersedes_intake_id set', () => {
      expectReject(
        `INSERT INTO project_intakes (id, project_id, intake_version,
           original_text, submitted_by, supersedes_intake_id, content_hash, created_at)
         VALUES ('int_sv1', 'p_sv', 1, 't', 'u1', 'int_prev', 'h1', ${TS})`,
        'project_intakes_supersede_version_check',
      );
    });

    it('rejects version>1 with supersedes_intake_id NULL', () => {
      expectReject(
        `INSERT INTO project_intakes (id, project_id, intake_version,
           original_text, submitted_by, content_hash, created_at)
         VALUES ('int_sv2', 'p_sv', 2, 't', 'u1', 'h1', ${TS})`,
        'project_intakes_supersede_version_check',
      );
    });

    it('accepts version=1 with supersedes_intake_id NULL', () => {
      db.raw.exec(initial('int_sv_ok1', 'p_sv_ok'));
      const row = db.raw
        .prepare("SELECT id FROM project_intakes WHERE id = 'int_sv_ok1'")
        .get() as { id: string };
      expect(row.id).toBe('int_sv_ok1');
    });

    it('accepts version>1 with supersedes_intake_id set', () => {
      db.raw.exec(initial('int_sv_prev', 'p_sv_ok2'));
      db.raw.exec(
        `INSERT INTO project_intakes (id, project_id, intake_version,
           original_text, submitted_by, supersedes_intake_id, content_hash, created_at)
         VALUES ('int_sv_next', 'p_sv_ok2', 2, 't', 'u1', 'int_sv_prev', 'h1', ${TS})`,
      );
      const row = db.raw
        .prepare("SELECT id FROM project_intakes WHERE id = 'int_sv_next'")
        .get() as { id: string };
      expect(row.id).toBe('int_sv_next');
    });
  });

  describe('project_intakes source_ids_xor (同存同空)', () => {
    it('rejects only source_quick_session_id set', () => {
      expectReject(
        `INSERT INTO project_intakes (id, project_id, intake_version,
           original_text, submitted_by, source_quick_session_id, content_hash, created_at)
         VALUES ('int_sx1', 'p_sx', 1, 't', 'u1', 'qs1', 'h1', ${TS})`,
        'project_intakes_source_ids_xor',
      );
    });

    it('rejects only source_brief_version_id set', () => {
      expectReject(
        `INSERT INTO project_intakes (id, project_id, intake_version,
           original_text, submitted_by, source_brief_version_id, content_hash, created_at)
         VALUES ('int_sx2', 'p_sx', 1, 't', 'u1', 'bv1', 'h1', ${TS})`,
        'project_intakes_source_ids_xor',
      );
    });

    it('accepts both source ids set (with matching hashes)', () => {
      db.raw.exec(
        `INSERT INTO project_intakes (id, project_id, intake_version,
           original_text, submitted_by, source_quick_session_id, source_brief_version_id,
           source_quick_session_hash, source_brief_snapshot_hash, content_hash, created_at)
         VALUES ('int_sx_ok', 'p_sx_ok', 1, 't', 'u1', 'qs1', 'bv1', 'qh', 'bh', 'h1', ${TS})`,
      );
      const row = db.raw
        .prepare("SELECT id FROM project_intakes WHERE id = 'int_sx_ok'")
        .get() as { id: string };
      expect(row.id).toBe('int_sx_ok');
    });
  });

  describe('project_intakes source_hashes_xor', () => {
    it('rejects only source_quick_session_hash set', () => {
      expectReject(
        `INSERT INTO project_intakes (id, project_id, intake_version,
           original_text, submitted_by, source_quick_session_hash, content_hash, created_at)
         VALUES ('int_sh1', 'p_sh', 1, 't', 'u1', 'qh', 'h1', ${TS})`,
        'project_intakes_source_hashes_xor',
      );
    });
  });

  describe('project_intakes source_id_hash_link', () => {
    it('rejects source_quick_session_id without source_quick_session_hash', () => {
      // Both ids set (source_ids_xor passes), both hashes NULL
      // (source_hashes_xor passes), but source_quick_session_id is NOT NULL
      // while source_quick_session_hash IS NULL → source_id_hash_link fires.
      expectReject(
        `INSERT INTO project_intakes (id, project_id, intake_version,
           original_text, submitted_by, source_quick_session_id, source_brief_version_id,
           content_hash, created_at)
         VALUES ('int_ihl1', 'p_ihl', 1, 't', 'u1', 'qs1', 'bv1', 'h1', ${TS})`,
        'project_intakes_source_id_hash_link',
      );
    });
  });

  describe('project_intakes partial unique indexes', () => {
    function initial(id: string, project: string) {
      return `INSERT INTO project_intakes (id, project_id, intake_version,
        original_text, submitted_by, content_hash, created_at)
        VALUES ('${id}', '${project}', 1, 'text', 'u1', 'h-${id}', ${TS})`;
    }

    it('uq_project_intake_initial: rejects a second initial intake per project', () => {
      db.raw.exec(initial('int_pu1', 'p_pu_initial'));
      expectReject(initial('int_pu2', 'p_pu_initial'), 'UNIQUE constraint failed');
    });

    it('uq_project_intake_successor: rejects two successors pointing at the same predecessor', () => {
      // Seed the initial intake, then two intakes that both supersede it.
      db.raw.exec(initial('int_pu_base', 'p_pu_succ'));
      const successor = (id: string) =>
        `INSERT INTO project_intakes (id, project_id, intake_version, original_text,
           submitted_by, supersedes_intake_id, content_hash, created_at)
         VALUES ('${id}', 'p_pu_succ', 2, 't', 'u1', 'int_pu_base', 'h-${id}', ${TS})`;
      db.raw.exec(successor('int_pu_s1'));
      expectReject(successor('int_pu_s2'), 'UNIQUE constraint failed');
    });

    it('uq_project_intakes_project_version: rejects duplicate (project, intake_version)', () => {
      // Seed initial v=1, then a v=2 successor pointing at it.
      db.raw.exec(initial('int_pv1', 'p_pv'));
      db.raw.exec(
        `INSERT INTO project_intakes (id, project_id, intake_version, original_text,
           submitted_by, supersedes_intake_id, content_hash, created_at)
         VALUES ('int_pv2', 'p_pv', 2, 't', 'u1', 'int_pv1', 'h2', ${TS})`,
      );
      // Second v=2 with a DIFFERENT supersedes_intake_id — avoids
      // uq_project_intake_successor (which keys on project_id + supersedes_intake_id)
      // but still collides on (project_id, intake_version) = ('p_pv', 2).
      // FKs are OFF so referencing a non-existent predecessor is allowed.
      expectReject(
        `INSERT INTO project_intakes (id, project_id, intake_version, original_text,
           submitted_by, supersedes_intake_id, content_hash, created_at)
         VALUES ('int_pv3', 'p_pv', 2, 't', 'u1', 'int_pv_other', 'h3', ${TS})`,
        'UNIQUE constraint failed',
      );
    });

    it('allows different projects to each have their own initial intake', () => {
      db.raw.exec(initial('int_multi_a', 'p_multi_a'));
      db.raw.exec(initial('int_multi_b', 'p_multi_b'));
      const row = db.raw
        .prepare(
          "SELECT COUNT(*) as c FROM project_intakes WHERE id IN ('int_multi_a','int_multi_b')",
        )
        .get() as { c: number };
      expect(row.c).toBe(2);
    });
  });

  // ================================================ upgrade_records ======
  // §4A.5 — status / target_project_id XOR.

  describe('upgrade_records status_target_xor', () => {
    function row(id: string, status: string, target: string | null) {
      const tgt = target === null ? 'null' : `'${target}'`;
      return `INSERT INTO upgrade_records (id, quick_session_id, brief_version_id,
        target_project_id, idempotency_key, status, started_at)
        VALUES ('${id}', 'qs_upg', 'bv1', ${tgt}, 'k-${id}', '${status}', ${TS})`;
    }

    it('rejects status=started with target_project_id set', () => {
      expectReject(row('upg_xr1', 'started', 'p1'), 'upgrade_records_status_target_xor');
    });

    it('rejects status=failed with target_project_id set', () => {
      expectReject(row('upg_xr2', 'failed', 'p1'), 'upgrade_records_status_target_xor');
    });

    it('rejects status=succeeded with target_project_id NULL', () => {
      expectReject(row('upg_xr3', 'succeeded', null), 'upgrade_records_status_target_xor');
    });

    it('accepts status=started with target_project_id NULL', () => {
      db.raw.exec(row('upg_xr_ok1', 'started', null));
      const r = db.raw
        .prepare("SELECT id FROM upgrade_records WHERE id = 'upg_xr_ok1'")
        .get() as { id: string };
      expect(r.id).toBe('upg_xr_ok1');
    });

    it('accepts status=succeeded with target_project_id set', () => {
      db.raw.exec(row('upg_xr_ok2', 'succeeded', 'p_succ'));
      const r = db.raw
        .prepare("SELECT id FROM upgrade_records WHERE id = 'upg_xr_ok2'")
        .get() as { id: string };
      expect(r.id).toBe('upg_xr_ok2');
    });
  });

  // ======================================================= ai_runs ========
  // §9 — domain_profile_id / domain_profile_version co-presence.

  describe('ai_runs domain_profile_xor', () => {
    function row(
      id: string,
      profileId: string | null,
      profileVer: number | null,
      jobId = 'job_ar',
    ) {
      const pid = profileId === null ? 'null' : `'${profileId}'`;
      const pvr = profileVer === null ? 'null' : String(profileVer);
      return `INSERT INTO ai_runs (id, ai_job_id, attempt, status, started_at,
        domain_profile_id, domain_profile_version)
        VALUES ('${id}', '${jobId}', 1, 'running', ${TS}, ${pid}, ${pvr})`;
    }

    it('rejects domain_profile_id set without domain_profile_version', () => {
      expectReject(row('ar_xr1', 'dpm1', null), 'ai_runs_domain_profile_xor');
    });

    it('rejects domain_profile_version set without domain_profile_id', () => {
      expectReject(row('ar_xr2', null, 1), 'ai_runs_domain_profile_xor');
    });

    it('accepts both NULL', () => {
      db.raw.exec(row('ar_xr_ok1', null, null));
      const r = db.raw
        .prepare("SELECT id FROM ai_runs WHERE id = 'ar_xr_ok1'")
        .get() as { id: string };
      expect(r.id).toBe('ar_xr_ok1');
    });

    it('accepts both set', () => {
      // Use a distinct job_id to avoid colliding with ar_xr_ok1 on
      // uq_ai_runs_job_attempt (ai_job_id, attempt).
      db.raw.exec(row('ar_xr_ok2', 'dpm_ar', 1, 'job_ar2'));
      const r = db.raw
        .prepare("SELECT id FROM ai_runs WHERE id = 'ar_xr_ok2'")
        .get() as { id: string };
      expect(r.id).toBe('ar_xr_ok2');
    });

    it('rejects attempt <= 0', () => {
      expectReject(
        `INSERT INTO ai_runs (id, ai_job_id, attempt, status, started_at)
         VALUES ('ar_att1', 'job_ar', 0, 'running', ${TS})`,
        'ai_runs_attempt_check',
      );
    });
  });

  // =================================================== change_impacts =====
  // §8 — change_id XOR preview_id (exactly one source).

  describe('change_impacts source_xor', () => {
    function row(
      id: string,
      changeId: string | null,
      previewId: string | null,
    ) {
      const cid = changeId === null ? 'null' : `'${changeId}'`;
      const pid = previewId === null ? 'null' : `'${previewId}'`;
      return `INSERT INTO change_impacts (id, change_id, preview_id, entity_type,
        entity_id, impact_type, severity, rationale, status)
        VALUES ('${id}', ${cid}, ${pid}, 'outcome', 'o1', 'rewrite', 'low', 'r', 'candidate')`;
    }

    it('rejects both change_id and preview_id NULL', () => {
      expectReject(row('ci_sx1', null, null), 'change_impacts_source_xor');
    });

    it('rejects both change_id and preview_id set', () => {
      expectReject(row('ci_sx2', 'chg1', 'cpv1'), 'change_impacts_source_xor');
    });

    it('accepts change_id set and preview_id NULL', () => {
      db.raw.exec(row('ci_sx_ok1', 'chg_ci', null));
      const r = db.raw
        .prepare("SELECT id FROM change_impacts WHERE id = 'ci_sx_ok1'")
        .get() as { id: string };
      expect(r.id).toBe('ci_sx_ok1');
    });

    it('accepts preview_id set and change_id NULL', () => {
      db.raw.exec(row('ci_sx_ok2', null, 'cpv_ci'));
      const r = db.raw
        .prepare("SELECT id FROM change_impacts WHERE id = 'ci_sx_ok2'")
        .get() as { id: string };
      expect(r.id).toBe('ci_sx_ok2');
    });
  });

  // ======================================================= changes =========
  // §8 — confirmed / withdrawn conditional checks.

  describe('changes confirmed_check', () => {
    function row(
      id: string,
      status: string,
      confirmedBy: string | null,
      confirmedAt: string | null,
    ) {
      const cb = confirmedBy === null ? 'null' : `'${confirmedBy}'`;
      const ca = confirmedAt === null ? 'null' : TS;
      return `INSERT INTO changes (id, project_id, source_type, description,
        severity, status, confirmed_by, confirmed_at, version, created_at, updated_at)
        VALUES ('${id}', 'p_chg', 'internal', 'd', 'low', '${status}', ${cb}, ${ca},
        1, ${TS}, ${TS})`;
    }

    it('rejects status=confirmed without confirmed_by', () => {
      expectReject(row('chg_cf1', 'confirmed', null, '2026-01-01'), 'changes_confirmed_check');
    });

    it('rejects status=confirmed without confirmed_at', () => {
      expectReject(row('chg_cf2', 'confirmed', 'u1', null), 'changes_confirmed_check');
    });

    it('accepts status=confirmed with both confirmed_by and confirmed_at', () => {
      db.raw.exec(row('chg_cf_ok', 'confirmed', 'u1', '2026-01-01'));
      const r = db.raw
        .prepare("SELECT id FROM changes WHERE id = 'chg_cf_ok'")
        .get() as { id: string };
      expect(r.id).toBe('chg_cf_ok');
    });
  });

  describe('changes withdrawn_check', () => {
    function row(
      id: string,
      status: string,
      withdrawnBy: string | null,
      withdrawnAt: string | null,
      reason: string | null,
    ) {
      const wb = withdrawnBy === null ? 'null' : `'${withdrawnBy}'`;
      const wa = withdrawnAt === null ? 'null' : TS;
      const wr = reason === null ? 'null' : `'${reason}'`;
      return `INSERT INTO changes (id, project_id, source_type, description,
        severity, status, withdrawn_by, withdrawn_at, withdrawal_reason, version,
        created_at, updated_at)
        VALUES ('${id}', 'p_chg_w', 'internal', 'd', 'low', '${status}', ${wb}, ${wa},
        ${wr}, 1, ${TS}, ${TS})`;
    }

    it('rejects status=withdrawn without withdrawn_by', () => {
      expectReject(row('chg_wd1', 'withdrawn', null, '2026-01-01', 'r'), 'changes_withdrawn_check');
    });

    it('rejects status=withdrawn without withdrawal_reason', () => {
      expectReject(row('chg_wd2', 'withdrawn', 'u1', '2026-01-01', null), 'changes_withdrawn_check');
    });

    it('accepts status=withdrawn with all three set', () => {
      db.raw.exec(row('chg_wd_ok', 'withdrawn', 'u1', '2026-01-01', 'mistake'));
      const r = db.raw
        .prepare("SELECT id FROM changes WHERE id = 'chg_wd_ok'")
        .get() as { id: string };
      expect(r.id).toBe('chg_wd_ok');
    });
  });

  // ============================================ quick_unknowns resolved ===
  // §4A.1b — resolved_by_turn_id SET NULL on delete is covered by the FK
  // suite; here we only assert the category enum CHECK.

  describe('quick_unknowns category CHECK', () => {
    it('rejects invalid category', () => {
      expectReject(
        `INSERT INTO quick_unknowns (id, quick_session_id, category, description,
           created_at)
         VALUES ('qu_ck1', 'qs1', 'misc', 'd', ${TS})`,
        'quick_unknowns_category_check',
      );
    });

    it('rejects invalid is_blocking', () => {
      expectReject(
        `INSERT INTO quick_unknowns (id, quick_session_id, category, description,
           is_blocking, created_at)
         VALUES ('qu_ck2', 'qs1', 'scope_boundary', 'd', 2, ${TS})`,
        'quick_unknowns_is_blocking_check',
      );
    });
  });
});
