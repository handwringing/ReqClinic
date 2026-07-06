import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, type AppDb } from '../helpers/test-db';

/**
 * CHECK constraint tests for DB v1.2 enum columns.
 *
 * `schema.test.ts` already covers the ai_jobs / quick_sessions / projects /
 * agreement_consents actor / training enums exhaustively. This file fills the
 * remaining enum CHECK gaps so every status/action/kind column in the spec is
 * guarded against arbitrary string input.
 *
 * Foreign keys are disabled (mirroring schema.test.ts) so CHECK violations can
 * be exercised without building prerequisite FK graphs.
 */
describe('CHECK enum constraints (DB v1.2 gaps)', () => {
  let db: AppDb;

  beforeAll(() => {
    db = createTestDb();
    db.raw.pragma('foreign_keys = OFF');
  });

  function expectReject(sql: string, matcher: string | RegExp) {
    expect(() => db.raw.exec(sql)).toThrow(matcher);
  }

  const TS = "'2026-01-01T00:00:00Z'";

  // -------------------------------------------------- agreement_consents ---

  describe('agreement_consents', () => {
    it('rejects invalid actor_kind', () => {
      expectReject(
        `INSERT INTO agreement_consents (id, agreement_version_id, actor_kind,
           user_id, action, scope, occurred_at)
         VALUES ('ac_ck1', 'av1', 'admin', 'u1', 'accepted', 'all', ${TS})`,
        'agreement_consents_actor_kind_check',
      );
    });

    it('rejects invalid action', () => {
      expectReject(
        `INSERT INTO agreement_consents (id, agreement_version_id, actor_kind,
           user_id, action, scope, occurred_at)
         VALUES ('ac_ck2', 'av1', 'user', 'u1', 'maybe', 'all', ${TS})`,
        'agreement_consents_action_check',
      );
    });

    it('rejects invalid scope', () => {
      expectReject(
        `INSERT INTO agreement_consents (id, agreement_version_id, actor_kind,
           user_id, action, scope, occurred_at)
         VALUES ('ac_ck3', 'av1', 'user', 'u1', 'accepted', 'everywhere', ${TS})`,
        'agreement_consents_scope_check',
      );
    });

    it('rejects invalid channel', () => {
      expectReject(
        `INSERT INTO agreement_consents (id, agreement_version_id, actor_kind,
           user_id, action, scope, channel, occurred_at)
         VALUES ('ac_ck4', 'av1', 'user', 'u1', 'accepted', 'all', 'fax', ${TS})`,
        'agreement_consents_channel_check',
      );
    });
  });

  // ---------------------------------------------- agreement_versions -------

  describe('agreement_versions', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO agreement_versions (id, version, status, change_type,
           effective_at, content_ref, created_at)
         VALUES ('av_ck1', '9.9.9', 'live', 'major', ${TS}, 'ref', ${TS})`,
        'agreement_versions_status_check',
      );
    });

    it('rejects invalid change_type', () => {
      expectReject(
        `INSERT INTO agreement_versions (id, version, status, change_type,
           effective_at, content_ref, created_at)
         VALUES ('av_ck2', '9.9.10', 'draft', 'patch', ${TS}, 'ref', ${TS})`,
        'agreement_versions_change_type_check',
      );
    });
  });

  // ---------------------------------------------------------- users --------

  describe('users', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO users (id, display_name, auth_subject, status,
           created_at, updated_at)
         VALUES ('usr_ck1', 'U', 'auth|ck1', 'pending', ${TS}, ${TS})`,
        'users_status_check',
      );
    });
  });

  // ---------------------------------------------------- quick_sessions ----

  describe('quick_sessions', () => {
    it('rejects invalid source_kind', () => {
      expectReject(
        `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
           original_input, coverage_slots_json, last_active_at, created_at, version)
         VALUES ('qs_ck1', 'gs1', 'draft', 'imported', 'idea', '{}', ${TS}, ${TS}, 1)`,
        'quick_sessions_source_kind_check',
      );
    });

    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
           original_input, coverage_slots_json, last_active_at, created_at, version)
         VALUES ('qs_ck2', 'gs1', 'frozen', 'custom', 'idea', '{}', ${TS}, ${TS}, 1)`,
        'quick_sessions_status_check',
      );
    });

    it('rejects blank original_input', () => {
      expectReject(
        `INSERT INTO quick_sessions (id, guest_session_id, status, source_kind,
           original_input, coverage_slots_json, last_active_at, created_at, version)
         VALUES ('qs_ck3', 'gs1', 'draft', 'custom', '   ', '{}', ${TS}, ${TS}, 1)`,
        'quick_sessions_original_input_check',
      );
    });
  });

  // ---------------------------------------------------- review_actions ----

  describe('review_actions', () => {
    const base = (action: string) =>
      `INSERT INTO review_actions (id, project_id, gate, entity_type, entity_id,
         entity_version, action, reviewer_id, reason, created_at)
       VALUES ('rv_ck1', 'p1', null, 'outcome', 'o1', 1, '${action}', 'u1',
         'ok', ${TS})`;

    it('rejects invalid action', () => {
      expectReject(base('approve'), 'review_actions_action_check');
    });

    it('rejects invalid gate', () => {
      expectReject(
        `INSERT INTO review_actions (id, project_id, gate, entity_type, entity_id,
           entity_version, action, reviewer_id, reason, created_at)
         VALUES ('rv_ck2', 'p1', 'deploy', 'outcome', 'o1', 1, 'accept', 'u1',
           'ok', ${TS})`,
        'review_actions_gate_check',
      );
    });
  });

  // --------------------------------------------------------- tasks --------

  describe('tasks', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO tasks (id, project_id, entity_type, entity_id, assignee_id,
           status, priority, created_by, created_at, updated_at, version)
         VALUES ('tsk_ck1', 'p1', 'outcome', 'o1', 'u1', 'done', 'normal', 'u1',
           ${TS}, ${TS}, 1)`,
        'tasks_status_check',
      );
    });

    it('rejects invalid priority', () => {
      expectReject(
        `INSERT INTO tasks (id, project_id, entity_type, entity_id, assignee_id,
           status, priority, created_by, created_at, updated_at, version)
         VALUES ('tsk_ck2', 'p1', 'outcome', 'o1', 'u1', 'pending', 'urgent', 'u1',
           ${TS}, ${TS}, 1)`,
        'tasks_priority_check',
      );
    });
  });

  // ------------------------------------------------------ baselines -------

  describe('baselines', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO baselines (id, project_id, baseline_version, status,
           data_hash, version, created_at)
         VALUES ('bl_ck1', 'p1', 1, 'frozen', 'sha256:x', 1, ${TS})`,
        'baselines_status_check',
      );
    });

    it('rejects baseline_version <= 0', () => {
      expectReject(
        `INSERT INTO baselines (id, project_id, baseline_version, status,
           data_hash, version, created_at)
         VALUES ('bl_ck2', 'p1', 0, 'draft', 'sha256:x', 1, ${TS})`,
        'baselines_baseline_version_check',
      );
    });
  });

  // ------------------------------------------------- domain_profiles ------

  describe('domain_profiles', () => {
    it('rejects invalid routing_risk', () => {
      expectReject(
        `INSERT INTO domain_profiles (id, project_id, profile_version, work_type,
           domain_labels_json, risk_flags_json, terminology_map_json,
           suggested_pack_ids_json, required_human_roles_json, routing_risk,
           routing_basis_json, rationale_evidence_links_json, unknowns_json,
           status, created_at)
         VALUES ('dpm_ck1', 'p1', 1, 'software_delivery', '[]', '[]', '{}',
           '[]', '[]', 'extreme', '{}', '[]', '[]', 'candidate', ${TS})`,
        'domain_profiles_routing_risk_check',
      );
    });

    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO domain_profiles (id, project_id, profile_version, work_type,
           domain_labels_json, risk_flags_json, terminology_map_json,
           suggested_pack_ids_json, required_human_roles_json, routing_risk,
           routing_basis_json, rationale_evidence_links_json, unknowns_json,
           status, created_at)
         VALUES ('dpm_ck2', 'p1', 1, 'software_delivery', '[]', '[]', '{}',
           '[]', '[]', 'low', '{}', '[]', '[]', 'finalized', ${TS})`,
        'domain_profiles_status_check',
      );
    });
  });

  // ---------------------------------------------------- brief_exports -----

  describe('brief_exports', () => {
    it('rejects invalid view_type', () => {
      expectReject(
        `INSERT INTO brief_exports (id, brief_version_id, view_type, export_type,
           exported_at, exported_by)
         VALUES ('be_ck1', 'bv1', 'premium', 'copy', ${TS}, 'u1')`,
        'brief_exports_view_type_check',
      );
    });

    it('rejects invalid export_type', () => {
      expectReject(
        `INSERT INTO brief_exports (id, brief_version_id, view_type, export_type,
           exported_at, exported_by)
         VALUES ('be_ck2', 'bv1', 'simple', 'email', ${TS}, 'u1')`,
        'brief_exports_export_type_check',
      );
    });
  });

  // ------------------------------------------------- upgrade_records ------

  describe('upgrade_records', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO upgrade_records (id, quick_session_id, brief_version_id,
           idempotency_key, status, started_at)
         VALUES ('upg_ck1', 'qs1', 'bv1', 'k1', 'cancelled', ${TS})`,
        'upgrade_records_status_check',
      );
    });
  });

  // ------------------------------------------------ training_cases ---------

  describe('training_cases', () => {
    it('rejects invalid difficulty', () => {
      expectReject(
        `INSERT INTO training_cases (id, case_id, version, title, difficulty,
           scenario_json, disclosure_rules_json, rubric_json, status, created_at)
         VALUES ('tcase_ck1', 'C1', '1.0.0', 'T', 'brutal', '{}', '[]', '{}',
           'active', ${TS})`,
        'training_cases_difficulty_check',
      );
    });

    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO training_cases (id, case_id, version, title, difficulty,
           scenario_json, disclosure_rules_json, rubric_json, status, created_at)
         VALUES ('tcase_ck2', 'C1', '1.0.1', 'T', 'easy', '{}', '[]', '{}',
           'published', ${TS})`,
        'training_cases_status_check',
      );
    });
  });

  // --------------------------------------------- training_attempts ---------

  describe('training_attempts', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO training_attempts (id, case_id, case_version, user_id,
           status, started_at, attempt_number, created_at, version)
         VALUES ('ta_ck1', 'C1', '1.0.0', 'u1', 'cancelled', ${TS}, 1, ${TS}, 1)`,
        'training_attempts_status_check',
      );
    });

    it('rejects attempt_number <= 0', () => {
      expectReject(
        `INSERT INTO training_attempts (id, case_id, case_version, user_id,
           status, started_at, attempt_number, created_at, version)
         VALUES ('ta_ck2', 'C1', '1.0.0', 'u1', 'interviewing', ${TS}, 0, ${TS}, 1)`,
        'training_attempts_attempt_number_check',
      );
    });
  });

  // ------------------------------------------------- product_events --------

  describe('product_events', () => {
    it('rejects invalid environment', () => {
      expectReject(
        `INSERT INTO product_events (id, event_id, event_name, event_schema_version,
           occurred_at, environment, app_version, mode, source_kind,
           analytics_session_id, attributes_json, created_at, expires_at)
         VALUES ('pe_ck1', 'E1', 'n', '1.0.0', ${TS}, 'staging', '1.0.0', 'quick',
           'custom', 'AS1', '{}', ${TS}, ${TS})`,
        'product_events_environment_check',
      );
    });

    it('rejects invalid mode', () => {
      expectReject(
        `INSERT INTO product_events (id, event_id, event_name, event_schema_version,
           occurred_at, environment, app_version, mode, source_kind,
           analytics_session_id, attributes_json, created_at, expires_at)
         VALUES ('pe_ck2', 'E2', 'n', '1.0.0', ${TS}, 'production', '1.0.0', 'async',
           'custom', 'AS1', '{}', ${TS}, ${TS})`,
        'product_events_mode_check',
      );
    });

    it('rejects invalid source_kind', () => {
      expectReject(
        `INSERT INTO product_events (id, event_id, event_name, event_schema_version,
           occurred_at, environment, app_version, mode, source_kind,
           analytics_session_id, attributes_json, created_at, expires_at)
         VALUES ('pe_ck3', 'E3', 'n', '1.0.0', ${TS}, 'production', '1.0.0', 'quick',
           'uploaded', 'AS1', '{}', ${TS}, ${TS})`,
        'product_events_source_kind_check',
      );
    });
  });

  // ----------------------------------------------- project_members ---------

  describe('project_members', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO project_members (project_id, user_id, capabilities_json,
           status, granted_by, created_at, updated_at, version)
         VALUES ('p1', 'u1', '[]', 'suspended', 'u2', ${TS}, ${TS}, 1)`,
        'project_members_status_check',
      );
    });

    it('rejects invalid capabilities_json', () => {
      expectReject(
        `INSERT INTO project_members (project_id, user_id, capabilities_json,
           status, granted_by, created_at, updated_at, version)
         VALUES ('p1', 'u1', 'not-json', 'active', 'u2', ${TS}, ${TS}, 1)`,
        'project_members_capabilities_json_check',
      );
    });
  });

  // ----------------------------------------------- verification_artifacts --

  describe('verification_artifacts', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO verification_artifacts (id, project_id, requirement_id,
           artifact_type, status, created_at)
         VALUES ('va_ck1', 'p1', 'r1', 'test', 'queued', ${TS})`,
        'verification_artifacts_status_check',
      );
    });
  });

  // ------------------------------------------------------- conflicts -------

  describe('conflicts', () => {
    it('rejects invalid severity', () => {
      expectReject(
        `INSERT INTO conflicts (id, project_id, statement, severity, blocking,
           status, version, created_at, updated_at)
         VALUES ('cfl_ck1', 'p1', 's', 'trivial', 0, 'open', 1, ${TS}, ${TS})`,
        'conflicts_severity_check',
      );
    });

    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO conflicts (id, project_id, statement, severity, blocking,
           status, version, created_at, updated_at)
         VALUES ('cfl_ck2', 'p1', 's', 'low', 0, 'closed', 1, ${TS}, ${TS})`,
        'conflicts_status_check',
      );
    });

    it('rejects invalid blocking', () => {
      expectReject(
        `INSERT INTO conflicts (id, project_id, statement, severity, blocking,
           status, version, created_at, updated_at)
         VALUES ('cfl_ck3', 'p1', 's', 'low', 2, 'open', 1, ${TS}, ${TS})`,
        'conflicts_blocking_check',
      );
    });
  });

  // -------------------------------------------------- change_impacts -------
  // Note: change_impacts has no created_at column in the schema.

  describe('change_impacts', () => {
    it('rejects invalid severity', () => {
      expectReject(
        `INSERT INTO change_impacts (id, change_id, entity_type, entity_id,
           impact_type, severity, rationale, status)
         VALUES ('ci_ck1', 'chg1', 'outcome', 'o1', 'rewrite', 'trivial', 'r',
           'candidate')`,
        'change_impacts_severity_check',
      );
    });

    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO change_impacts (id, change_id, entity_type, entity_id,
           impact_type, severity, rationale, status)
         VALUES ('ci_ck2', 'chg1', 'outcome', 'o1', 'rewrite', 'low', 'r',
           'pending')`,
        'change_impacts_status_check',
      );
    });
  });

  // --------------------------------------------------------- changes -------

  describe('changes', () => {
    it('rejects invalid severity', () => {
      expectReject(
        `INSERT INTO changes (id, project_id, source_type, description, severity,
           status, version, created_at, updated_at)
         VALUES ('chg_ck1', 'p1', 'internal', 'd', 'trivial', 'draft', 1, ${TS}, ${TS})`,
        'changes_severity_check',
      );
    });

    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO changes (id, project_id, source_type, description, severity,
           status, version, created_at, updated_at)
         VALUES ('chg_ck2', 'p1', 'internal', 'd', 'low', 'deleted', 1, ${TS}, ${TS})`,
        'changes_status_check',
      );
    });
  });

  // ----------------------------------------------- report_snapshots --------

  describe('report_snapshots', () => {
    it('rejects invalid status', () => {
      expectReject(
        `INSERT INTO report_snapshots (id, project_id, report_version, baseline_id,
           data_hash, template_id, template_version, core_schema_version,
           report_input_schema_hash, compiler_version, domain_profile_id,
           domain_profile_version, domain_pack_versions_json, audience, language,
           status, generated_at)
         VALUES ('rpt_ck1', 'p1', 1, 'bl1', 'sha256:x', 'tmpl', '1.0.0', '1.0.0',
           'sha256:y', 'cv1', 'dpm1', 1, '[]', 'executive', 'zh-CN', 'published', ${TS})`,
        'report_snapshots_status_check',
      );
    });

    it('rejects report_version <= 0', () => {
      expectReject(
        `INSERT INTO report_snapshots (id, project_id, report_version, baseline_id,
           data_hash, template_id, template_version, core_schema_version,
           report_input_schema_hash, compiler_version, domain_profile_id,
           domain_profile_version, domain_pack_versions_json, audience, language,
           status, generated_at)
         VALUES ('rpt_ck2', 'p1', 0, 'bl1', 'sha256:x', 'tmpl', '1.0.0', '1.0.0',
           'sha256:y', 'cv1', 'dpm1', 1, '[]', 'executive', 'zh-CN', 'draft', ${TS})`,
        'report_snapshots_report_version_check',
      );
    });
  });
});
