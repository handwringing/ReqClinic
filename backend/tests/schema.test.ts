import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from './helpers/test-db';

/**
 * Schema-level constraint tests (DB v1.2).
 *
 * Verifies that:
 *   1. All key tables from each domain are created by the migration.
 *   2. XOR / CHECK / partial-unique-index constraints reject invalid rows.
 *
 * Foreign keys are disabled for these tests so that CHECK/XOR/UNIQUE
 * violations can be isolated without setting up full prerequisite graphs.
 * FK enforcement (RESTRICT/CASCADE/SET NULL) is covered by repository
 * integration tests instead.
 */
describe('database schema v1.2', () => {
  let db: AppDb;

  beforeAll(() => {
    db = createTestDb();
    // Isolate CHECK/XOR/UNIQUE testing from FK prerequisites.
    db.raw.pragma('foreign_keys = OFF');
  });

  /** Run a raw SQL statement that is expected to throw. */
  function expectReject(sql: string, matcher: string | RegExp) {
    expect(() => db.raw.exec(sql)).toThrow(matcher);
  }

  // ---------------------------------------------------------------- tables ---

  describe('tables exist', () => {
    it('creates all key tables from every domain module', () => {
      const rows = db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const names = new Set(rows.map((r) => r.name));

      const expected = [
        // identity (§3)
        'users', 'guest_sessions', 'agreement_versions', 'agreement_consents',
        // project (§3)
        'projects', 'project_members', 'project_intakes',
        // domain (§4)
        'domain_profiles', 'domain_packs', 'project_domain_packs',
        // quick (§4A)
        'quick_sessions', 'quick_turns', 'quick_unknowns',
        'brief_versions', 'brief_exports', 'option_preferences', 'upgrade_records',
        // source (§5)
        'blobs', 'sources', 'evidence_spans',
        // core (§6/§7)
        'outcomes', 'drivers', 'requirements', 'requirement_driver_links',
        'acceptance_criteria', 'verification_artifacts', 'operational_signals',
        'future_scenarios', 'unknowns', 'assumptions', 'conflicts',
        'conflict_sides', 'conflict_options', 'decisions', 'evidence_links',
        'trace_links', 'stakeholders', 'interview_turns', 'capabilities',
        // review (§7)
        'review_actions', 'requirement_versions', 'baselines', 'baseline_items', 'tasks',
        // change (§8)
        'changes', 'change_impacts', 'change_previews',
        // job (§9/§11)
        'ai_jobs', 'ai_runs', 'agent_runs', 'skill_runs', 'idempotency_records', 'jobs',
        // report (§10)
        'report_templates', 'report_snapshots', 'report_gate_results',
        // event (§11)
        'product_events', 'entity_change_logs',
        // training (§12A)
        'training_cases', 'training_attempts', 'training_questions',
        'training_summaries', 'training_feedback', 'training_turns',
        // lifecycle (§14)
        'delete_tasks', 'deletion_ledger',
        // system (§15)
        'schema_migrations',
      ];

      const missing = expected.filter((t) => !names.has(t));
      expect(missing, `missing tables: ${missing.join(', ')}`).toEqual([]);
    });

    it('records the applied migration in schema_migrations', () => {
      const rows = db.raw.prepare('SELECT id FROM schema_migrations').all() as { id: string }[];
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------ agent/skill run constraints ---

  describe('agent_runs + skill_runs constraints', () => {
    it('creates skill run usage audit columns', () => {
      const rows = db.raw
        .prepare('PRAGMA table_info(skill_runs)')
        .all() as { name: string }[];
      const columns = new Set(rows.map((row) => row.name));
      expect(columns.has('provider')).toBe(true);
      expect(columns.has('thinking_mode')).toBe(true);
      expect(columns.has('input_tokens')).toBe(true);
      expect(columns.has('output_tokens')).toBe(true);
      expect(columns.has('usage_estimated')).toBe(true);
    });

    it('rejects an unknown agent mode', () => {
      expectReject(
        `INSERT INTO agent_runs (id, ai_job_id, agent_id, plan_id, plan_version, mode,
           status, input_hash, started_at)
         VALUES ('arn_bad_mode', 'job_missing', 'reqclinic.orchestrator', 'quick_consult',
           '1.0.0', 'unknown', 'running', 'h', '2026-01-01T00:00:00Z')`,
        'agent_runs_mode_check',
      );
    });

    it('rejects an unknown skill category', () => {
      expectReject(
        `INSERT INTO skill_runs (id, agent_run_id, step_index, skill_id, skill_version,
           category, status, input_hash, input_schema_version, output_schema_version,
           prompt_version, started_at)
         VALUES ('srn_bad_cat', 'arn_missing', 0, 'skill', '1.0.0', 'freeform',
           'running', 'h', 'in.v1', 'out.v1', 'p-v1', '2026-01-01T00:00:00Z')`,
        'skill_runs_category_check',
      );
    });

    it('rejects duplicate skill step indexes for one agent run', () => {
      db.raw.exec(
        `INSERT INTO agent_runs (id, ai_job_id, agent_id, plan_id, plan_version, mode,
           status, input_hash, started_at)
         VALUES ('arn_unique', 'job_missing', 'reqclinic.orchestrator', 'quick_consult',
           '1.0.0', 'quick', 'running', 'h', '2026-01-01T00:00:00Z');
         INSERT INTO skill_runs (id, agent_run_id, step_index, skill_id, skill_version,
           category, status, input_hash, input_schema_version, output_schema_version,
           prompt_version, started_at)
         VALUES ('srn_unique_1', 'arn_unique', 0, 'skill.a', '1.0.0', 'routing',
           'running', 'h', 'in.v1', 'out.v1', 'p-v1', '2026-01-01T00:00:00Z')`,
      );
      expectReject(
        `INSERT INTO skill_runs (id, agent_run_id, step_index, skill_id, skill_version,
           category, status, input_hash, input_schema_version, output_schema_version,
           prompt_version, started_at)
         VALUES ('srn_unique_2', 'arn_unique', 0, 'skill.b', '1.0.0', 'validation',
           'running', 'h', 'in.v1', 'out.v1', 'p-v1', '2026-01-01T00:00:00Z')`,
        /UNIQUE|uq_skill_runs_agent_step/,
      );
    });
  });

  // ---------------------------------------------------- ai_jobs scope XOR ---

  describe('ai_jobs scope XOR', () => {
    it('rejects formal_project without project_id', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, task_type, payload_json, input_hash,
           status, max_attempts, dedupe_key, created_by_kind, created_by_user_id,
           created_at, updated_at)
         VALUES ('j1', 'formal_project', 't', '{}', 'h', 'queued', 1, 'd1',
           'user', 'u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_scope_xor',
      );
    });

    it('rejects quick_session scope without quick_session_id', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, task_type, payload_json, input_hash,
           status, max_attempts, dedupe_key, created_by_kind, created_by_guest_session_id,
           created_at, updated_at)
         VALUES ('j2', 'quick_session', 't', '{}', 'h', 'queued', 1, 'd2',
           'guest', 'gs1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_scope_xor',
      );
    });

    it('rejects training_attempt scope without training_attempt_id', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, task_type, payload_json, input_hash,
           status, max_attempts, dedupe_key, created_by_kind, created_by_user_id,
           created_at, updated_at)
         VALUES ('j3', 'training_attempt', 't', '{}', 'h', 'queued', 1, 'd3',
           'user', 'u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_scope_xor',
      );
    });

    it('rejects formal_project with quick_session_id also set', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, quick_session_id, task_type,
           payload_json, input_hash, status, max_attempts, dedupe_key,
           created_by_kind, created_by_user_id, created_at, updated_at)
         VALUES ('j4', 'formal_project', 'p1', 'qs1', 't', '{}', 'h', 'queued', 1,
           'd4', 'user', 'u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_scope_xor',
      );
    });
  });

  // ----------------------------------------------- ai_jobs created_by XOR ---

  describe('ai_jobs created_by XOR', () => {
    it('rejects created_by_kind=user with no user_id', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_at, updated_at)
         VALUES ('j5', 'formal_project', 'p1', 't', '{}', 'h', 'queued', 1, 'd5',
           'user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_created_by_xor',
      );
    });

    it('rejects created_by_kind=guest with no guest_session_id', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, quick_session_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_at, updated_at)
         VALUES ('j6', 'quick_session', 'qs1', 't', '{}', 'h', 'queued', 1, 'd6',
           'guest', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_created_by_xor',
      );
    });

    it('rejects created_by_kind=user with both user_id and guest_session_id set', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, created_by_guest_session_id, created_at, updated_at)
         VALUES ('j7', 'formal_project', 'p1', 't', '{}', 'h', 'queued', 1, 'd7',
           'user', 'u1', 'gs1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_created_by_xor',
      );
    });
  });

  // ----------------------------------------- ai_jobs formal_user_creator ---

  describe('ai_jobs formal_user_creator', () => {
    it('rejects formal_project job created by a guest', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_guest_session_id, created_at, updated_at)
         VALUES ('j8', 'formal_project', 'p1', 't', '{}', 'h', 'queued', 1, 'd8',
           'guest', 'gs1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_formal_user_creator',
      );
    });
  });

  // --------------------------------------------- ai_jobs cancelled_by XOR --

  describe('ai_jobs cancelled_by XOR', () => {
    it('rejects cancelled_by_kind=user without cancelled_by_user_id', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, cancelled_by_kind, cancelled_at, created_at, updated_at)
         VALUES ('j9', 'formal_project', 'p1', 't', '{}', 'h', 'queued', 1, 'd9',
           'user', 'u1', 'user', '2026-01-01T00:00:00Z',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_cancelled_by_xor',
      );
    });

    it('rejects cancelled_by_kind=user with cancelled_at NULL', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, cancelled_by_kind, cancelled_by_user_id, created_at, updated_at)
         VALUES ('j10', 'formal_project', 'p1', 't', '{}', 'h', 'queued', 1, 'd10',
           'user', 'u1', 'user', 'u2',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_cancelled_by_xor',
      );
    });
  });

  // --------------------------------------------- ai_jobs CHECK constraints --

  describe('ai_jobs CHECK constraints', () => {
    it('rejects invalid scope_kind enum', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, created_at, updated_at)
         VALUES ('j11', 'invalid_scope', 'p1', 't', '{}', 'h', 'queued', 1, 'd11',
           'user', 'u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_scope_kind_check',
      );
    });

    it('rejects invalid status enum', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, created_at, updated_at)
         VALUES ('j12', 'formal_project', 'p1', 't', '{}', 'h', 'bogus', 1, 'd12',
           'user', 'u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_status_check',
      );
    });

    it('rejects max_attempts <= 0', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, created_at, updated_at)
         VALUES ('j13', 'formal_project', 'p1', 't', '{}', 'h', 'queued', 0, 'd13',
           'user', 'u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_max_attempts_check',
      );
    });

    it('rejects invalid JSON payload', () => {
      expectReject(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, created_at, updated_at)
         VALUES ('j14', 'formal_project', 'p1', 't', 'not-json', 'h', 'queued', 1,
           'd14', 'user', 'u1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'ai_jobs_payload_json_check',
      );
    });
  });

  // --------------------------- ai_jobs dedupe partial unique indexes (§9) ---

  describe('ai_jobs dedupe partial unique indexes', () => {
    it('rejects duplicate formal_project job with same dedupe key', () => {
      const base = (id: string) =>
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, created_at, updated_at)
         VALUES ('${id}', 'formal_project', 'proj_dup', 'analyze', '{}', 'h',
           'queued', 1, 'formal_dupe', 'user', 'u1',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`;
      // First insert succeeds.
      db.raw.exec(base('jd1'));
      // Second insert with same (project_id, task_type, dedupe_key) fails.
      expectReject(base('jd2'), 'UNIQUE constraint failed');
    });

    it('rejects duplicate quick_session job with same dedupe key', () => {
      const base = (id: string) =>
        `INSERT INTO ai_jobs (id, scope_kind, quick_session_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_guest_session_id, created_at, updated_at)
         VALUES ('${id}', 'quick_session', 'qs_dup', 'analyze', '{}', 'h',
           'queued', 1, 'quick_dupe', 'guest', 'gs1',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`;
      db.raw.exec(base('jd3'));
      expectReject(base('jd4'), 'UNIQUE constraint failed');
    });

    it('rejects duplicate training_attempt job with same dedupe key', () => {
      const base = (id: string) =>
        `INSERT INTO ai_jobs (id, scope_kind, training_attempt_id, task_type,
           payload_json, input_hash, status, max_attempts, dedupe_key,
           created_by_kind, created_by_user_id, created_at, updated_at)
         VALUES ('${id}', 'training_attempt', 'ta_dup', 'analyze', '{}', 'h',
           'queued', 1, 'training_dupe', 'user', 'u1',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`;
      db.raw.exec(base('jd5'));
      expectReject(base('jd6'), 'UNIQUE constraint failed');
    });

    it('allows the same dedupe_key across different scopes', () => {
      // formal_project and quick_session hit different partial indexes, so the
      // same dedupe_key string must not conflict.
      db.raw.exec(
        `INSERT INTO ai_jobs (id, scope_kind, project_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_user_id, created_at, updated_at)
         VALUES ('jd7', 'formal_project', 'proj_shared', 'analyze', '{}', 'h',
           'queued', 1, 'shared_key', 'user', 'u1',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      );
      db.raw.exec(
        `INSERT INTO ai_jobs (id, scope_kind, quick_session_id, task_type, payload_json,
           input_hash, status, max_attempts, dedupe_key, created_by_kind,
           created_by_guest_session_id, created_at, updated_at)
         VALUES ('jd8', 'quick_session', 'qs_shared', 'analyze', '{}', 'h',
           'queued', 1, 'shared_key', 'guest', 'gs1',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      );
      const row = db.raw
        .prepare("SELECT COUNT(*) as c FROM ai_jobs WHERE dedupe_key = 'shared_key'")
        .get() as { c: number };
      expect(row.c).toBe(2);
    });
  });

  // --------------------------------------- agreement_consents actor XOR ---

  describe('agreement_consents actor XOR', () => {
    it('rejects actor_kind=user without user_id', () => {
      expectReject(
        `INSERT INTO agreement_consents (id, agreement_version_id, actor_kind,
           action, scope, occurred_at)
         VALUES ('ac1', 'av1', 'user', 'accepted', 'all', '2026-01-01T00:00:00Z')`,
        'agreement_consents_actor_xor',
      );
    });

    it('rejects actor_kind=guest without guest_session_id', () => {
      expectReject(
        `INSERT INTO agreement_consents (id, agreement_version_id, actor_kind,
           action, scope, occurred_at)
         VALUES ('ac2', 'av1', 'guest', 'accepted', 'all', '2026-01-01T00:00:00Z')`,
        'agreement_consents_actor_xor',
      );
    });

    it('rejects actor_kind=user with guest_session_id set', () => {
      expectReject(
        `INSERT INTO agreement_consents (id, agreement_version_id, actor_kind,
           user_id, guest_session_id, action, scope, occurred_at)
         VALUES ('ac3', 'av1', 'user', 'u1', 'gs1', 'accepted', 'all',
           '2026-01-01T00:00:00Z')`,
        'agreement_consents_actor_xor',
      );
    });
  });

  // -------------------------------------------- quick_sessions owner XOR ---

  describe('quick_sessions owner XOR', () => {
    it('rejects both guest_session_id and user_id NULL', () => {
      expectReject(
        `INSERT INTO quick_sessions (id, status, source_kind, original_input,
           last_active_at, created_at)
         VALUES ('qs1', 'draft', 'custom', 'hello',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'quick_sessions_owner_xor',
      );
    });

    it('rejects both guest_session_id and user_id set', () => {
      expectReject(
        `INSERT INTO quick_sessions (id, guest_session_id, user_id, status,
           source_kind, original_input, last_active_at, created_at)
         VALUES ('qs2', 'gs1', 'u1', 'draft', 'custom', 'hello',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'quick_sessions_owner_xor',
      );
    });

    it('accepts a guest-owned quick session', () => {
      db.raw.exec(
        `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
           original_input, last_active_at, created_at)
         VALUES ('qs3', 'gs1', 'draft', 'custom', 'hello',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      );
      const row = db.raw
        .prepare("SELECT id FROM quick_sessions WHERE id = 'qs3'")
        .get() as { id: string };
      expect(row.id).toBe('qs3');
    });
  });

  // ---------------------------------------- training_attempts owner XOR ---

  describe('training_attempts owner XOR', () => {
    it('rejects both user_id and guest_session_id NULL', () => {
      expectReject(
        `INSERT INTO training_attempts (id, case_id, case_version, status,
           started_at, attempt_number, created_at)
         VALUES ('ta1', 'case1', 'v1', 'not_started',
           '2026-01-01T00:00:00Z', 1, '2026-01-01T00:00:00Z')`,
        'training_attempts_owner_xor',
      );
    });

    it('rejects both user_id and guest_session_id set', () => {
      expectReject(
        `INSERT INTO training_attempts (id, case_id, case_version, user_id,
           guest_session_id, status, started_at, attempt_number, created_at)
         VALUES ('ta2', 'case1', 'v1', 'u1', 'gs1', 'not_started',
           '2026-01-01T00:00:00Z', 1, '2026-01-01T00:00:00Z')`,
        'training_attempts_owner_xor',
      );
    });
  });

  // ------------------------- training_feedback coverage_score_bp CHECK ---

  describe('training_feedback coverage_score_bp CHECK', () => {
    it('rejects coverage_score_bp > 10000', () => {
      expectReject(
        `INSERT INTO training_feedback (id, attempt_id, coverage_score_bp,
           missing_dimension_count, feedback_json, generated_at)
         VALUES ('tf1', 'ta1', 10001, 0, '{}', '2026-01-01T00:00:00Z')`,
        'training_feedback_coverage_score_bp_check',
      );
    });

    it('rejects coverage_score_bp < 0', () => {
      expectReject(
        `INSERT INTO training_feedback (id, attempt_id, coverage_score_bp,
           missing_dimension_count, feedback_json, generated_at)
         VALUES ('tf2', 'ta1', -1, 0, '{}', '2026-01-01T00:00:00Z')`,
        'training_feedback_coverage_score_bp_check',
      );
    });
  });

  // --------------------------------------------- version > 0 CHECK ---

  describe('version > 0 CHECK', () => {
    it('rejects brief_versions version = 0', () => {
      expectReject(
        `INSERT INTO brief_versions (id, quick_session_id, version, snapshot_json,
           generated_at, generated_by)
         VALUES ('bv1', 'qs1', 0, '{}', '2026-01-01T00:00:00Z', 'u1')`,
        'brief_versions_version_check',
      );
    });

    it('rejects projects version = 0', () => {
      expectReject(
        `INSERT INTO projects (id, owner_id, created_by, status, version,
           created_at, updated_at)
         VALUES ('p1', 'u1', 'u1', 'Draft', 0,
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'projects_version_check',
      );
    });
  });

  // --------------------------------------------- projects status CHECK ---

  describe('projects status CHECK', () => {
    it('rejects invalid status enum', () => {
      expectReject(
        `INSERT INTO projects (id, owner_id, created_by, status, version,
           created_at, updated_at)
         VALUES ('p2', 'u1', 'u1', 'Bogus', 1,
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        'projects_status_check',
      );
    });
  });
});
