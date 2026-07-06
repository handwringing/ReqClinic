CREATE TABLE `change_impacts` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text,
	`preview_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`impact_type` text NOT NULL,
	`severity` text NOT NULL,
	`recommended_action` text,
	`required_stage` text,
	`rationale` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`preview_id`) REFERENCES `change_previews`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "change_impacts_severity_check" CHECK(severity IN ('low','medium','high','critical')),
	CONSTRAINT "change_impacts_required_stage_check" CHECK(required_stage IS NULL OR required_stage IN ('interview','outcome','decision','scope','report')),
	CONSTRAINT "change_impacts_status_check" CHECK(status IN ('candidate','reviewed','accepted','dismissed')),
	CONSTRAINT "change_impacts_source_xor" CHECK((change_id IS NULL) <> (preview_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE `change_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`baseline_id` text NOT NULL,
	`scenario_json` text NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`baseline_id`) REFERENCES `baselines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "change_previews_scenario_json_check" CHECK(json_valid(scenario_json)),
	CONSTRAINT "change_previews_status_check" CHECK(status IN ('draft','analyzing','ready','failed','expired'))
);
--> statement-breakpoint
CREATE TABLE `changes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_id` text,
	`source_type` text NOT NULL,
	`description` text NOT NULL,
	`trigger_type` text,
	`occurred_at` text,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`confirmed_by` text,
	`confirmed_at` text,
	`withdrawn_by` text,
	`withdrawn_at` text,
	`withdrawal_reason` text,
	`supersedes_change_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`withdrawn_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "changes_severity_check" CHECK(severity IN ('low','medium','high','critical')),
	CONSTRAINT "changes_status_check" CHECK(status IN ('draft','confirmed','analyzing','reviewing','baselined','withdrawn','superseded')),
	CONSTRAINT "changes_version_check" CHECK(version > 0),
	CONSTRAINT "changes_confirmed_check" CHECK(status <> 'confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
	CONSTRAINT "changes_withdrawn_check" CHECK(status <> 'withdrawn' OR (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_changes_project_status_created` ON `changes` (`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_changes_project_source_occurred` ON `changes` (`project_id`,`source_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `acceptance_criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`context` text,
	`action_or_condition` text NOT NULL,
	`expected_result` text NOT NULL,
	`measurement_method` text,
	`evidence_type` text,
	`threshold_value` text,
	`unit` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "acceptance_criteria_status_check" CHECK(status IN ('draft','reviewed','accepted','verified','superseded')),
	CONSTRAINT "acceptance_criteria_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_acceptance_criteria_requirement_status` ON `acceptance_criteria` (`requirement_id`,`status`);--> statement-breakpoint
CREATE TABLE `assumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`statement` text NOT NULL,
	`validation_plan` text,
	`owner_id` text,
	`due_at` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assumptions_status_check" CHECK(status IN ('open','testing','validated','invalidated','retired')),
	CONSTRAINT "assumptions_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE TABLE `capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`parent_capability_id` text,
	`epistemic_type` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "capabilities_epistemic_type_check" CHECK(epistemic_type IN ('Fact','Inference','Assumption','Proposal')),
	CONSTRAINT "capabilities_status_check" CHECK(status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
	CONSTRAINT "capabilities_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE TABLE `conflict_options` (
	`id` text PRIMARY KEY NOT NULL,
	`conflict_id` text NOT NULL,
	`description` text NOT NULL,
	`benefits` text,
	`costs` text,
	`risks` text,
	`reversibility` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conflict_id`) REFERENCES `conflicts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "conflict_options_reversibility_check" CHECK(reversibility IS NULL OR reversibility IN ('high','medium','low')),
	CONSTRAINT "conflict_options_status_check" CHECK(status IN ('candidate','selected','rejected','withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `idx_conflict_options_conflict_status` ON `conflict_options` (`conflict_id`,`status`);--> statement-breakpoint
CREATE TABLE `conflict_sides` (
	`id` text PRIMARY KEY NOT NULL,
	`conflict_id` text NOT NULL,
	`label` text NOT NULL,
	`statement` text NOT NULL,
	`stance` text NOT NULL,
	`evidence_link_ids_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conflict_id`) REFERENCES `conflicts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "conflict_sides_evidence_link_ids_json_check" CHECK(json_valid(evidence_link_ids_json))
);
--> statement-breakpoint
CREATE INDEX `idx_conflict_sides_conflict` ON `conflict_sides` (`conflict_id`);--> statement-breakpoint
CREATE TABLE `conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`statement` text NOT NULL,
	`severity` text NOT NULL,
	`blocking` integer DEFAULT 0 NOT NULL,
	`owner_id` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "conflicts_severity_check" CHECK(severity IN ('low','medium','high','critical')),
	CONSTRAINT "conflicts_blocking_check" CHECK(blocking IN (0,1)),
	CONSTRAINT "conflicts_status_check" CHECK(status IN ('open','deciding','resolved','accepted_risk')),
	CONSTRAINT "conflicts_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_conflicts_project_blocking_status` ON `conflicts` (`project_id`,`blocking`,`status`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conflict_id` text,
	`question` text NOT NULL,
	`selected_option_id` text,
	`rationale` text,
	`decided_by` text,
	`decided_at` text,
	`review_trigger` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conflict_id`) REFERENCES `conflicts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`selected_option_id`) REFERENCES `conflict_options`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "decisions_status_check" CHECK(status IN ('draft','decided','superseded','revoked')),
	CONSTRAINT "decisions_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE TABLE `drivers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`driver_type` text NOT NULL,
	`statement` text NOT NULL,
	`owner_id` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "drivers_driver_type_check" CHECK(driver_type IN ('goal','outcome','obligation','risk','problem','opportunity')),
	CONSTRAINT "drivers_status_check" CHECK(status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
	CONSTRAINT "drivers_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_drivers_project_type_status` ON `drivers` (`project_id`,`driver_type`,`status`);--> statement-breakpoint
CREATE TABLE `evidence_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`evidence_span_id` text NOT NULL,
	`relation` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evidence_span_id`) REFERENCES `evidence_spans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_links_relation_check" CHECK(relation IN ('supports','contradicts','qualifies','originates'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_evidence_links_entity_span_relation` ON `evidence_links` (`entity_type`,`entity_id`,`evidence_span_id`,`relation`);--> statement-breakpoint
CREATE INDEX `idx_evidence_links_project_entity` ON `evidence_links` (`project_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `future_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`probability_class` text,
	`activation_trigger` text NOT NULL,
	`leading_indicators_json` text DEFAULT '[]' NOT NULL,
	`horizon` text NOT NULL,
	`architecture_response` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "future_scenarios_probability_class_check" CHECK(probability_class IS NULL OR probability_class IN ('low','medium','high','unknown')),
	CONSTRAINT "future_scenarios_leading_indicators_json_check" CHECK(json_valid(leading_indicators_json)),
	CONSTRAINT "future_scenarios_horizon_check" CHECK(horizon IN ('next','later','watch')),
	CONSTRAINT "future_scenarios_status_check" CHECK(status IN ('draft','active','triggered','retired')),
	CONSTRAINT "future_scenarios_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_future_scenarios_project_horizon_status` ON `future_scenarios` (`project_id`,`horizon`,`status`);--> statement-breakpoint
CREATE TABLE `interview_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`turn_index` integer NOT NULL,
	`role` text NOT NULL,
	`stakeholder_id` text,
	`speaker_label` text NOT NULL,
	`content` text NOT NULL,
	`evidence_span_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stakeholder_id`) REFERENCES `stakeholders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`evidence_span_id`) REFERENCES `evidence_spans`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "interview_turns_turn_index_check" CHECK(turn_index >= 0),
	CONSTRAINT "interview_turns_role_check" CHECK(role IN ('interviewer','stakeholder','system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_interview_turns_project_index` ON `interview_turns` (`project_id`,`turn_index`);--> statement-breakpoint
CREATE INDEX `idx_interview_turns_project_index` ON `interview_turns` (`project_id`,`turn_index`);--> statement-breakpoint
CREATE INDEX `idx_interview_turns_project_role_created` ON `interview_turns` (`project_id`,`role`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stakeholder_id` text,
	`context` text NOT NULL,
	`job_statement` text NOT NULL,
	`pain` text,
	`current_workaround` text,
	`expected_progress` text,
	`epistemic_type` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stakeholder_id`) REFERENCES `stakeholders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "jobs_epistemic_type_check" CHECK(epistemic_type IN ('Fact','Inference','Assumption','Proposal')),
	CONSTRAINT "jobs_status_check" CHECK(status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
	CONSTRAINT "jobs_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE TABLE `operational_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`name` text NOT NULL,
	`measurement` text NOT NULL,
	`threshold_value` text,
	`unit` text,
	`observation_window` text,
	`owner_id` text,
	`review_cadence` text,
	`trigger_condition` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "operational_signals_status_check" CHECK(status IN ('draft','active','paused','retired')),
	CONSTRAINT "operational_signals_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`driver_id` text NOT NULL,
	`job_id` text,
	`description` text NOT NULL,
	`success_metric` text,
	`baseline_value` text,
	`target_value` text,
	`unit` text,
	`failure_condition` text,
	`horizon` text,
	`owner_id` text,
	`epistemic_type` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "outcomes_horizon_check" CHECK(horizon IS NULL OR horizon IN ('now','next','later','watch')),
	CONSTRAINT "outcomes_epistemic_type_check" CHECK(epistemic_type IN ('Fact','Inference','Assumption','Proposal')),
	CONSTRAINT "outcomes_status_check" CHECK(status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
	CONSTRAINT "outcomes_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outcomes_driver_id_unique` ON `outcomes` (`driver_id`);--> statement-breakpoint
CREATE INDEX `idx_outcomes_project_job_status` ON `outcomes` (`project_id`,`job_id`,`status`);--> statement-breakpoint
CREATE TABLE `requirement_driver_links` (
	`requirement_id` text NOT NULL,
	`driver_id` text NOT NULL,
	`relation` text NOT NULL,
	`rationale` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`requirement_id`, `driver_id`, `relation`),
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "requirement_driver_links_relation_check" CHECK(relation IN ('motivated_by','constrains','mitigates','realizes'))
);
--> statement-breakpoint
CREATE INDEX `idx_requirement_driver_links_driver_requirement` ON `requirement_driver_links` (`driver_id`,`requirement_id`);--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requirement_key` text NOT NULL,
	`title` text,
	`statement` text NOT NULL,
	`requirement_type` text NOT NULL,
	`provenance` text NOT NULL,
	`horizon` text,
	`scope_disposition` text DEFAULT 'included' NOT NULL,
	`commitment` text NOT NULL,
	`stability` text NOT NULL,
	`priority` text,
	`valid_from` text,
	`valid_until` text,
	`activation_trigger` text,
	`deactivation_trigger` text,
	`volatility_drivers_json` text DEFAULT '[]' NOT NULL,
	`migration_strategy` text,
	`reversibility` text,
	`owner_id` text,
	`supersedes_requirement_id` text,
	`lifecycle_status` text NOT NULL,
	`rationale` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "requirements_provenance_check" CHECK(provenance IN ('explicitly_stated','derived','assumed','proposed')),
	CONSTRAINT "requirements_horizon_check" CHECK(horizon IS NULL OR horizon IN ('now','next','later','watch')),
	CONSTRAINT "requirements_scope_disposition_check" CHECK(scope_disposition IN ('included','excluded')),
	CONSTRAINT "requirements_commitment_check" CHECK(commitment IN ('committed','conditional','scenario','speculation')),
	CONSTRAINT "requirements_stability_check" CHECK(stability IN ('stable','policy-variable','experimental')),
	CONSTRAINT "requirements_volatility_drivers_json_check" CHECK(json_valid(volatility_drivers_json)),
	CONSTRAINT "requirements_migration_strategy_check" CHECK(migration_strategy IS NULL OR migration_strategy IN ('coexist','transform','replace','retire')),
	CONSTRAINT "requirements_reversibility_check" CHECK(reversibility IS NULL OR reversibility IN ('high','medium','low')),
	CONSTRAINT "requirements_lifecycle_status_check" CHECK(lifecycle_status IN ('candidate','supported','reviewed','accepted','implemented','verified','superseded','retired')),
	CONSTRAINT "requirements_version_check" CHECK(version > 0),
	CONSTRAINT "requirements_valid_until_check" CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_requirements_project_key` ON `requirements` (`project_id`,`requirement_key`);--> statement-breakpoint
CREATE INDEX `idx_requirements_project_horizon_scope_lifecycle` ON `requirements` (`project_id`,`horizon`,`scope_disposition`,`lifecycle_status`);--> statement-breakpoint
CREATE TABLE `stakeholders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`influence` text,
	`interest` text,
	`authority` text,
	`contact_scope` text,
	`notes` text,
	`epistemic_type` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stakeholders_epistemic_type_check" CHECK(epistemic_type IN ('Fact','Inference','Assumption','Proposal')),
	CONSTRAINT "stakeholders_status_check" CHECK(status IN ('candidate','supported','reviewed','accepted','superseded','retired')),
	CONSTRAINT "stakeholders_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE TABLE `trace_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`relation` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trace_links_status_check" CHECK(status IN ('active','superseded','invalidated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trace_links_project_relation` ON `trace_links` (`project_id`,`from_type`,`from_id`,`relation`,`to_type`,`to_id`);--> statement-breakpoint
CREATE INDEX `idx_trace_links_project_from` ON `trace_links` (`project_id`,`from_type`,`from_id`);--> statement-breakpoint
CREATE INDEX `idx_trace_links_project_to` ON `trace_links` (`project_id`,`to_type`,`to_id`);--> statement-breakpoint
CREATE TABLE `unknowns` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`question` text NOT NULL,
	`information_value` text,
	`impact` text,
	`owner_id` text,
	`due_at` text,
	`resolution_condition` text,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "unknowns_status_check" CHECK(status IN ('open','investigating','resolved','closed')),
	CONSTRAINT "unknowns_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE TABLE `verification_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`acceptance_criterion_id` text,
	`artifact_type` text NOT NULL,
	`description` text,
	`source_id` text,
	`artifact_path` text,
	`result` text,
	`executed_at` text,
	`verified_by` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`acceptance_criterion_id`) REFERENCES `acceptance_criteria`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "verification_artifacts_status_check" CHECK(status IN ('planned','available','passed','failed','invalidated')),
	CONSTRAINT "verification_artifacts_evidence_xor" CHECK(source_id IS NOT NULL OR artifact_path IS NOT NULL OR result IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_verification_artifacts_requirement_acceptance_status` ON `verification_artifacts` (`requirement_id`,`acceptance_criterion_id`,`status`);--> statement-breakpoint
CREATE TABLE `domain_packs` (
	`id` text NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`compatible_core_schema` text NOT NULL,
	`manifest_json` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`released_at` text NOT NULL,
	`deprecated_at` text,
	PRIMARY KEY(`id`, `version`),
	CONSTRAINT "domain_packs_status_check" CHECK(status IN ('released','deprecated')),
	CONSTRAINT "domain_packs_manifest_json_check" CHECK(json_valid(manifest_json))
);
--> statement-breakpoint
CREATE TABLE `domain_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`work_type` text NOT NULL,
	`domain_labels_json` text NOT NULL,
	`risk_flags_json` text NOT NULL,
	`terminology_map_json` text NOT NULL,
	`suggested_pack_ids_json` text NOT NULL,
	`required_human_roles_json` text NOT NULL,
	`routing_risk` text NOT NULL,
	`routing_basis_json` text NOT NULL,
	`rationale_evidence_links_json` text NOT NULL,
	`unknowns_json` text NOT NULL,
	`status` text NOT NULL,
	`classifier_model` text,
	`prompt_version` text,
	`approved_by` text,
	`approved_at` text,
	`supersedes_profile_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_profile_id`) REFERENCES `domain_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "domain_profiles_profile_version_check" CHECK(profile_version > 0),
	CONSTRAINT "domain_profiles_domain_labels_json_check" CHECK(json_valid(domain_labels_json)),
	CONSTRAINT "domain_profiles_risk_flags_json_check" CHECK(json_valid(risk_flags_json)),
	CONSTRAINT "domain_profiles_terminology_map_json_check" CHECK(json_valid(terminology_map_json)),
	CONSTRAINT "domain_profiles_suggested_pack_ids_json_check" CHECK(json_valid(suggested_pack_ids_json)),
	CONSTRAINT "domain_profiles_required_human_roles_json_check" CHECK(json_valid(required_human_roles_json)),
	CONSTRAINT "domain_profiles_routing_risk_check" CHECK(routing_risk IN ('low','medium','high','unknown')),
	CONSTRAINT "domain_profiles_routing_basis_json_check" CHECK(json_valid(routing_basis_json)),
	CONSTRAINT "domain_profiles_rationale_evidence_links_json_check" CHECK(json_valid(rationale_evidence_links_json)),
	CONSTRAINT "domain_profiles_unknowns_json_check" CHECK(json_valid(unknowns_json)),
	CONSTRAINT "domain_profiles_status_check" CHECK(status IN ('candidate','under_review','approved','rejected','superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_domain_profiles_project_version` ON `domain_profiles` (`project_id`,`profile_version`);--> statement-breakpoint
CREATE INDEX `idx_domain_profiles_project_status_version` ON `domain_profiles` (`project_id`,`status`,`profile_version`);--> statement-breakpoint
CREATE TABLE `project_domain_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain_pack_id` text NOT NULL,
	`domain_pack_version` text NOT NULL,
	`domain_profile_id` text NOT NULL,
	`activation_reason` text NOT NULL,
	`status` text NOT NULL,
	`activated_by` text NOT NULL,
	`activated_at` text NOT NULL,
	`deactivated_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`domain_profile_id`) REFERENCES `domain_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`activated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`domain_pack_id`,`domain_pack_version`) REFERENCES `domain_packs`(`id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_domain_packs_status_check" CHECK(status IN ('active','inactive'))
);
--> statement-breakpoint
CREATE INDEX `idx_project_domain_packs_project_status` ON `project_domain_packs` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `entity_change_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`project_id` text,
	`quick_session_id` text,
	`change_kind` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`field_changes_json` text,
	`before_state_hash` text,
	`after_state_hash` text,
	`idempotency_key` text,
	`occurred_at` text NOT NULL,
	`received_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quick_session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "entity_change_logs_entity_type_check" CHECK(entity_type IN (
        'project','project_member','project_intake','baseline','requirement',
        'driver','review_action','report_snapshot','change',
        'quick_session','brief_version','brief_export','option_preference',
        'upgrade_record','training_attempt','training_feedback',
        'agreement_version','agreement_consent','guest_session','task'
      )),
	CONSTRAINT "entity_change_logs_change_kind_check" CHECK(change_kind IN ('created','updated','state_changed','deleted','archived','restored')),
	CONSTRAINT "entity_change_logs_actor_kind_check" CHECK(actor_kind IN ('user','guest','system')),
	CONSTRAINT "entity_change_logs_field_changes_json_check" CHECK(field_changes_json IS NULL OR json_valid(field_changes_json))
);
--> statement-breakpoint
CREATE INDEX `idx_entity_change_logs_entity_occurred` ON `entity_change_logs` (`entity_type`,`entity_id`,occurred_at DESC);--> statement-breakpoint
CREATE INDEX `idx_entity_change_logs_project_occurred` ON `entity_change_logs` (`project_id`,occurred_at DESC) WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_entity_change_logs_quick_session_occurred` ON `entity_change_logs` (`quick_session_id`,occurred_at DESC) WHERE quick_session_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_entity_change_logs_actor_occurred` ON `entity_change_logs` (`actor_kind`,`actor_id`,occurred_at DESC);--> statement-breakpoint
CREATE INDEX `idx_entity_change_logs_idempotency_key` ON `entity_change_logs` (`idempotency_key`) WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE TABLE `product_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_name` text NOT NULL,
	`event_schema_version` text NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text,
	`environment` text NOT NULL,
	`app_version` text NOT NULL,
	`mode` text NOT NULL,
	`source_kind` text NOT NULL,
	`analytics_session_id` text NOT NULL,
	`actor_key` text,
	`stage` text,
	`experiment_id` text,
	`attributes_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "product_events_environment_check" CHECK(environment IN ('demo','development','test','pilot','production')),
	CONSTRAINT "product_events_mode_check" CHECK(mode IN ('quick','formal','training','entry')),
	CONSTRAINT "product_events_source_kind_check" CHECK(source_kind IN ('custom','sample','training_fixture','internal_test')),
	CONSTRAINT "product_events_attributes_json_check" CHECK(json_valid(attributes_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_events_event_id_unique` ON `product_events` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_product_events_session_occurred` ON `product_events` (`analytics_session_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_product_events_occurred_at` ON `product_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_product_events_mode` ON `product_events` (`mode`);--> statement-breakpoint
CREATE INDEX `idx_product_events_source_kind` ON `product_events` (`source_kind`);--> statement-breakpoint
CREATE INDEX `idx_product_events_expires_at` ON `product_events` (`expires_at`);--> statement-breakpoint
CREATE TABLE `agreement_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`agreement_version_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`user_id` text,
	`guest_session_id` text,
	`action` text NOT NULL,
	`scope` text NOT NULL,
	`channel` text DEFAULT 'web' NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text,
	FOREIGN KEY (`agreement_version_id`) REFERENCES `agreement_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`guest_session_id`) REFERENCES `guest_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agreement_consents_actor_kind_check" CHECK(actor_kind IN ('user','guest')),
	CONSTRAINT "agreement_consents_action_check" CHECK(action IN ('accepted','reaccepted','withdrawn')),
	CONSTRAINT "agreement_consents_scope_check" CHECK(scope IN ('quick','formal','training','all')),
	CONSTRAINT "agreement_consents_channel_check" CHECK(channel IN ('web','cli','api')),
	CONSTRAINT "agreement_consents_actor_xor" CHECK((actor_kind='user' AND user_id IS NOT NULL AND guest_session_id IS NULL)
        OR (actor_kind='guest' AND user_id IS NULL AND guest_session_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_agreement_consents_user_id` ON `agreement_consents` (`user_id`) WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_agreement_consents_guest_session_id` ON `agreement_consents` (`guest_session_id`) WHERE guest_session_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_agreement_consents_version` ON `agreement_consents` (`agreement_version_id`);--> statement-breakpoint
CREATE TABLE `agreement_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`change_type` text NOT NULL,
	`effective_at` text NOT NULL,
	`content_ref` text NOT NULL,
	`superseded_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`superseded_by`) REFERENCES `agreement_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agreement_versions_status_check" CHECK(status IN ('draft','active','superseded','withdrawn')),
	CONSTRAINT "agreement_versions_change_type_check" CHECK(change_type IN ('major','minor'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_versions_version_unique` ON `agreement_versions` (`version`);--> statement-breakpoint
CREATE TABLE `guest_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_key_digest` text NOT NULL,
	`created_at` text NOT NULL,
	`last_active_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guest_sessions_session_key_digest_unique` ON `guest_sessions` (`session_key_digest`);--> statement-breakpoint
CREATE INDEX `idx_guest_sessions_expires_at` ON `guest_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_guest_sessions_last_active_at` ON `guest_sessions` (`last_active_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`auth_subject` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "users_status_check" CHECK(status IN ('active','disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_unique` ON `users` (`auth_subject`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schema_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`intake_version` integer NOT NULL,
	`original_text` text NOT NULL,
	`decision_intent` text,
	`selected_work_type` text,
	`candidate_roles_json` text DEFAULT '[]' NOT NULL,
	`candidate_constraints_json` text DEFAULT '[]' NOT NULL,
	`source_channel` text DEFAULT 'web' NOT NULL,
	`submitted_by` text NOT NULL,
	`supersedes_intake_id` text,
	`source_quick_session_id` text,
	`source_brief_version_id` text,
	`source_quick_session_hash` text,
	`source_brief_snapshot_hash` text,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_intake_id`) REFERENCES `project_intakes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_quick_session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_brief_version_id`) REFERENCES `brief_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "project_intakes_intake_version_check" CHECK(intake_version > 0),
	CONSTRAINT "project_intakes_original_text_check" CHECK(length(trim(original_text)) > 0),
	CONSTRAINT "project_intakes_candidate_roles_json_check" CHECK(json_valid(candidate_roles_json)),
	CONSTRAINT "project_intakes_candidate_constraints_json_check" CHECK(json_valid(candidate_constraints_json)),
	CONSTRAINT "project_intakes_supersede_version_check" CHECK((intake_version = 1 AND supersedes_intake_id IS NULL)
        OR (intake_version > 1 AND supersedes_intake_id IS NOT NULL)),
	CONSTRAINT "project_intakes_source_ids_xor" CHECK((source_quick_session_id IS NULL AND source_brief_version_id IS NULL)
        OR (source_quick_session_id IS NOT NULL AND source_brief_version_id IS NOT NULL)),
	CONSTRAINT "project_intakes_source_hashes_xor" CHECK((source_quick_session_hash IS NULL AND source_brief_snapshot_hash IS NULL)
        OR (source_quick_session_hash IS NOT NULL AND source_brief_snapshot_hash IS NOT NULL)),
	CONSTRAINT "project_intakes_source_id_hash_link" CHECK(source_quick_session_id IS NULL OR source_quick_session_hash IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_intakes_project_version` ON `project_intakes` (`project_id`,`intake_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_intake_initial` ON `project_intakes` (`project_id`) WHERE supersedes_intake_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_intake_successor` ON `project_intakes` (`project_id`,`supersedes_intake_id`) WHERE supersedes_intake_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_project_intakes_project_version` ON `project_intakes` (`project_id`,`intake_version`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`capabilities_json` text NOT NULL,
	`status` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_members_capabilities_json_check" CHECK(json_valid(capabilities_json)),
	CONSTRAINT "project_members_status_check" CHECK(status IN ('active','revoked')),
	CONSTRAINT "project_members_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_project_members_user_status_project` ON `project_members` (`user_id`,`status`,`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_by` text NOT NULL,
	`name` text,
	`description` text,
	`status` text NOT NULL,
	`risk_level` text DEFAULT 'unknown' NOT NULL,
	`current_domain_profile_id` text,
	`language` text DEFAULT 'zh-CN' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`current_domain_profile_id`) REFERENCES `domain_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "projects_status_check" CHECK(status IN ('Draft','Ingesting','Eliciting','Reviewing','Baselined','Reporting','Released','Changing','Archived')),
	CONSTRAINT "projects_risk_level_check" CHECK(risk_level IN ('unknown','low','medium','high')),
	CONSTRAINT "projects_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_projects_owner_status_updated` ON `projects` (`owner_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `brief_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_version_id` text NOT NULL,
	`view_type` text NOT NULL,
	`export_type` text NOT NULL,
	`exported_at` text NOT NULL,
	`exported_by` text NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`brief_version_id`) REFERENCES `brief_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "brief_exports_view_type_check" CHECK(view_type IN ('simple','exec','ai_task','learn')),
	CONSTRAINT "brief_exports_export_type_check" CHECK(export_type IN ('copy','download'))
);
--> statement-breakpoint
CREATE INDEX `idx_brief_exports_brief_version_id` ON `brief_exports` (`brief_version_id`);--> statement-breakpoint
CREATE INDEX `idx_brief_exports_expires_at` ON `brief_exports` (`expires_at`);--> statement-breakpoint
CREATE TABLE `brief_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`quick_session_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`is_incomplete` integer DEFAULT 0 NOT NULL,
	`blocking_unknown_count` integer DEFAULT 0 NOT NULL,
	`generated_at` text NOT NULL,
	`generated_by` text NOT NULL,
	FOREIGN KEY (`quick_session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "brief_versions_version_check" CHECK(version > 0),
	CONSTRAINT "brief_versions_snapshot_json_check" CHECK(json_valid(snapshot_json)),
	CONSTRAINT "brief_versions_is_incomplete_check" CHECK(is_incomplete IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_brief_versions_session_version` ON `brief_versions` (`quick_session_id`,`version`);--> statement-breakpoint
CREATE TABLE `option_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`quick_session_id` text NOT NULL,
	`brief_version_id` text,
	`option_id` text NOT NULL,
	`matches_ai_recommendation` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`quick_session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brief_version_id`) REFERENCES `brief_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "option_preferences_matches_ai_recommendation_check" CHECK(matches_ai_recommendation IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `quick_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`guest_session_id` text,
	`user_id` text,
	`origin_guest_session_id` text,
	`claimed_at` text,
	`status` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_case_id` text,
	`original_input` text NOT NULL,
	`intent` text,
	`decision_intent` text,
	`coverage_slots_json` text DEFAULT '{}' NOT NULL,
	`current_understanding_version` integer DEFAULT 0 NOT NULL,
	`current_brief_version_id` text,
	`expires_at` text,
	`last_active_at` text NOT NULL,
	`upgraded_at` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`guest_session_id`) REFERENCES `guest_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_guest_session_id`) REFERENCES `guest_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`current_brief_version_id`) REFERENCES `brief_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "quick_sessions_status_check" CHECK(status IN ('draft','clarifying','understanding_review','option_review','brief_ready','upgraded','archived')),
	CONSTRAINT "quick_sessions_source_kind_check" CHECK(source_kind IN ('custom','sample','training_fixture','internal_test')),
	CONSTRAINT "quick_sessions_original_input_check" CHECK(length(trim(original_input)) > 0),
	CONSTRAINT "quick_sessions_coverage_slots_json_check" CHECK(json_valid(coverage_slots_json)),
	CONSTRAINT "quick_sessions_version_check" CHECK(version > 0),
	CONSTRAINT "quick_sessions_owner_xor" CHECK((guest_session_id IS NOT NULL AND user_id IS NULL)
        OR (guest_session_id IS NULL AND user_id IS NOT NULL)),
	CONSTRAINT "quick_sessions_origin_check" CHECK(origin_guest_session_id IS NULL OR origin_guest_session_id = guest_session_id OR user_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_quick_sessions_guest_session_id` ON `quick_sessions` (`guest_session_id`);--> statement-breakpoint
CREATE INDEX `idx_quick_sessions_user_id` ON `quick_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_quick_sessions_origin_guest_session_id` ON `quick_sessions` (`origin_guest_session_id`);--> statement-breakpoint
CREATE INDEX `idx_quick_sessions_status` ON `quick_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_quick_sessions_expires_at` ON `quick_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `quick_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`quick_session_id` text NOT NULL,
	`turn_index` integer NOT NULL,
	`role` text NOT NULL,
	`question_id` text,
	`content` text NOT NULL,
	`understanding_version` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quick_session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quick_turns_turn_index_check" CHECK(turn_index >= 0),
	CONSTRAINT "quick_turns_role_check" CHECK(role IN ('ai','user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_quick_turns_session_index` ON `quick_turns` (`quick_session_id`,`turn_index`);--> statement-breakpoint
CREATE TABLE `quick_unknowns` (
	`id` text PRIMARY KEY NOT NULL,
	`quick_session_id` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`is_blocking` integer DEFAULT 1 NOT NULL,
	`resolved_at` text,
	`resolved_by_turn_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quick_session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_turn_id`) REFERENCES `quick_turns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "quick_unknowns_category_check" CHECK(category IN ('expected_outcome','user_object','core_scenarios','scope_boundary','completion_criteria','constraints_risks')),
	CONSTRAINT "quick_unknowns_is_blocking_check" CHECK(is_blocking IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `upgrade_records` (
	`id` text PRIMARY KEY NOT NULL,
	`quick_session_id` text NOT NULL,
	`brief_version_id` text NOT NULL,
	`target_project_id` text,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`error_category` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`quick_session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brief_version_id`) REFERENCES `brief_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "upgrade_records_status_check" CHECK(status IN ('started','succeeded','failed')),
	CONSTRAINT "upgrade_records_status_target_xor" CHECK((status='succeeded' AND target_project_id IS NOT NULL)
        OR (status IN ('started','failed') AND target_project_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_upgrade_records_session_key` ON `upgrade_records` (`quick_session_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_upgrade_records_target_project_id` ON `upgrade_records` (`target_project_id`);--> statement-breakpoint
CREATE TABLE `blobs` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`storage_path` text NOT NULL,
	`byte_size` integer NOT NULL,
	`media_type` text NOT NULL,
	`scan_status` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "blobs_byte_size_check" CHECK(byte_size >= 0),
	CONSTRAINT "blobs_scan_status_check" CHECK(scan_status IN ('pending','clean','blocked','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blobs_sha256_unique` ON `blobs` (`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `blobs_storage_path_unique` ON `blobs` (`storage_path`);--> statement-breakpoint
CREATE INDEX `idx_blobs_sha256` ON `blobs` (`sha256`);--> statement-breakpoint
CREATE TABLE `evidence_spans` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`page` integer,
	`section` text,
	`coordinate_space` text DEFAULT 'normalized_unicode_codepoint_v1' NOT NULL,
	`normalized_document_hash` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`exact_text` text NOT NULL,
	`normalized_text` text NOT NULL,
	`span_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_spans_page_check" CHECK(page IS NULL OR page > 0),
	CONSTRAINT "evidence_spans_start_offset_check" CHECK(start_offset >= 0),
	CONSTRAINT "evidence_spans_end_offset_check" CHECK(end_offset > start_offset)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_evidence_spans_source_span` ON `evidence_spans` (`source_id`,`start_offset`,`end_offset`,`span_hash`);--> statement-breakpoint
CREATE INDEX `idx_evidence_spans_source_start` ON `evidence_spans` (`source_id`,`start_offset`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`blob_id` text NOT NULL,
	`file_name` text NOT NULL,
	`media_type` text NOT NULL,
	`source_type` text NOT NULL,
	`author` text,
	`captured_at` text,
	`extracted_text_hash` text,
	`parser_version` text,
	`supersedes_source_id` text,
	`sensitivity` text NOT NULL,
	`extraction_status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`blob_id`) REFERENCES `blobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sources_sensitivity_check" CHECK(sensitivity IN ('public','internal','confidential','restricted')),
	CONSTRAINT "sources_extraction_status_check" CHECK(extraction_status IN ('uploaded','queued','parsing','parsed','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_sources_project_extraction_created` ON `sources` (`project_id`,`extraction_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sources_project_blob` ON `sources` (`project_id`,`blob_id`);--> statement-breakpoint
CREATE TABLE `baseline_items` (
	`baseline_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_version` integer NOT NULL,
	`snapshot_hash` text NOT NULL,
	PRIMARY KEY(`baseline_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`baseline_id`) REFERENCES `baselines`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "baseline_items_entity_version_check" CHECK(entity_version > 0)
);
--> statement-breakpoint
CREATE TABLE `baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`baseline_version` integer NOT NULL,
	`status` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`data_hash` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "baselines_baseline_version_check" CHECK(baseline_version > 0),
	CONSTRAINT "baselines_status_check" CHECK(status IN ('draft','approved','superseded')),
	CONSTRAINT "baselines_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_baselines_project_version` ON `baselines` (`project_id`,`baseline_version`);--> statement-breakpoint
CREATE INDEX `idx_baselines_project_version` ON `baselines` (`project_id`,`baseline_version`);--> statement-breakpoint
CREATE TABLE `requirement_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`changed_by` text,
	`change_reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "requirement_versions_version_check" CHECK(version > 0),
	CONSTRAINT "requirement_versions_snapshot_json_check" CHECK(json_valid(snapshot_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_requirement_versions_requirement_version` ON `requirement_versions` (`requirement_id`,`version`);--> statement-breakpoint
CREATE TABLE `review_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`gate` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_version` integer NOT NULL,
	`action` text NOT NULL,
	`before_value` text,
	`after_value` text,
	`reviewer_id` text NOT NULL,
	`reason` text NOT NULL,
	`follow_up_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_actions_gate_check" CHECK(gate IS NULL OR gate IN ('outcome','evidence_conflict','scope','domain_profile','report_release')),
	CONSTRAINT "review_actions_action_check" CHECK(action IN ('accept','modify','reject','uncertain')),
	CONSTRAINT "review_actions_before_value_check" CHECK(before_value IS NULL OR json_valid(before_value)),
	CONSTRAINT "review_actions_after_value_check" CHECK(after_value IS NULL OR json_valid(after_value)),
	CONSTRAINT "review_actions_follow_up_json_check" CHECK(follow_up_json IS NULL OR json_valid(follow_up_json))
);
--> statement-breakpoint
CREATE INDEX `idx_review_actions_project_gate_created` ON `review_actions` (`project_id`,`gate`,`created_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`assignee_id` text NOT NULL,
	`due_at` text,
	`status` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tasks_status_check" CHECK(status IN ('pending','in_progress','completed','overdue','rejected','reassigned')),
	CONSTRAINT "tasks_priority_check" CHECK(priority IN ('low','normal','high','blocking')),
	CONSTRAINT "tasks_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_project_assignee_status_due` ON `tasks` (`project_id`,`assignee_id`,`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`project_id` text,
	`quick_session_id` text,
	`training_attempt_id` text,
	`task_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`input_hash` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`next_run_at` text,
	`locked_by` text,
	`locked_at` text,
	`last_error_code` text,
	`cancellation_reason` text,
	`cancelled_by_kind` text,
	`cancelled_by_user_id` text,
	`cancelled_by_guest_session_id` text,
	`cancelled_at` text,
	`idempotency_record_id` text,
	`dedupe_key` text NOT NULL,
	`created_by_kind` text NOT NULL,
	`created_by_user_id` text,
	`created_by_guest_session_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quick_session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`training_attempt_id`) REFERENCES `training_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cancelled_by_guest_session_id`) REFERENCES `guest_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`idempotency_record_id`) REFERENCES `idempotency_records`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_guest_session_id`) REFERENCES `guest_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_jobs_scope_kind_check" CHECK(scope_kind IN ('formal_project','quick_session','training_attempt')),
	CONSTRAINT "ai_jobs_payload_json_check" CHECK(json_valid(payload_json)),
	CONSTRAINT "ai_jobs_status_check" CHECK(status IN ('queued','running','validating','retry_wait','succeeded','failed','manual_review','cancelled')),
	CONSTRAINT "ai_jobs_attempts_check" CHECK(attempts >= 0),
	CONSTRAINT "ai_jobs_max_attempts_check" CHECK(max_attempts > 0),
	CONSTRAINT "ai_jobs_cancelled_by_kind_check" CHECK(cancelled_by_kind IS NULL OR cancelled_by_kind IN ('user','guest','system')),
	CONSTRAINT "ai_jobs_created_by_kind_check" CHECK(created_by_kind IN ('user','guest')),
	CONSTRAINT "ai_jobs_scope_xor" CHECK((scope_kind='formal_project' AND project_id IS NOT NULL AND quick_session_id IS NULL AND training_attempt_id IS NULL)
        OR (scope_kind='quick_session' AND project_id IS NULL AND quick_session_id IS NOT NULL AND training_attempt_id IS NULL)
        OR (scope_kind='training_attempt' AND project_id IS NULL AND quick_session_id IS NULL AND training_attempt_id IS NOT NULL)),
	CONSTRAINT "ai_jobs_created_by_xor" CHECK((created_by_kind='user' AND created_by_user_id IS NOT NULL AND created_by_guest_session_id IS NULL)
        OR (created_by_kind='guest' AND created_by_user_id IS NULL AND created_by_guest_session_id IS NOT NULL)),
	CONSTRAINT "ai_jobs_formal_user_creator" CHECK(scope_kind <> 'formal_project' OR created_by_kind='user'),
	CONSTRAINT "ai_jobs_cancelled_by_xor" CHECK((cancelled_by_kind IS NULL AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NULL)
        OR (cancelled_by_kind='user' AND cancelled_by_user_id IS NOT NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NOT NULL)
        OR (cancelled_by_kind='guest' AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NOT NULL AND cancelled_at IS NOT NULL)
        OR (cancelled_by_kind='system' AND cancelled_by_user_id IS NULL AND cancelled_by_guest_session_id IS NULL AND cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_ai_jobs_status_next_run_created` ON `ai_jobs` (`status`,`next_run_at`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ai_job_formal_dedupe` ON `ai_jobs` (`project_id`,`task_type`,`dedupe_key`) WHERE scope_kind='formal_project';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ai_job_quick_dedupe` ON `ai_jobs` (`quick_session_id`,`task_type`,`dedupe_key`) WHERE scope_kind='quick_session';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ai_job_training_dedupe` ON `ai_jobs` (`training_attempt_id`,`task_type`,`dedupe_key`) WHERE scope_kind='training_attempt';--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ai_job_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`provider` text,
	`model` text,
	`model_revision` text,
	`thinking_mode` text,
	`reasoning_effort` text,
	`prompt_version` text,
	`schema_version` text,
	`domain_profile_id` text,
	`domain_profile_version` integer,
	`domain_pack_versions_json` text,
	`dataset_version` text,
	`input_hash` text,
	`outbound_payload_hash` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`raw_audit_blob_id` text,
	`raw_audit_class` text DEFAULT 'final_output' NOT NULL,
	`raw_audit_expires_at` text,
	`parsed_output_json` text,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`ai_job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_profile_id`) REFERENCES `domain_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`raw_audit_blob_id`) REFERENCES `blobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_runs_attempt_check" CHECK(attempt > 0),
	CONSTRAINT "ai_runs_raw_audit_class_check" CHECK(raw_audit_class IN ('none','final_output','debug_with_reasoning')),
	CONSTRAINT "ai_runs_parsed_output_json_check" CHECK(parsed_output_json IS NULL OR json_valid(parsed_output_json)),
	CONSTRAINT "ai_runs_status_check" CHECK(status IN ('running','validating','succeeded','failed','cancelled')),
	CONSTRAINT "ai_runs_domain_profile_xor" CHECK((domain_profile_id IS NULL AND domain_profile_version IS NULL)
        OR (domain_profile_id IS NOT NULL AND domain_profile_version IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ai_runs_job_attempt` ON `ai_runs` (`ai_job_id`,`attempt`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ai_job_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`plan_version` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_hash` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`ai_job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_runs_mode_check" CHECK(mode IN ('quick','formal','training')),
	CONSTRAINT "agent_runs_status_check" CHECK(status IN ('running','succeeded','failed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_agent_runs_job` ON `agent_runs` (`ai_job_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_plan` ON `agent_runs` (`plan_id`,`plan_version`);--> statement-breakpoint
CREATE TABLE `skill_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_run_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`skill_id` text NOT NULL,
	`skill_version` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_hash` text,
	`input_schema_version` text NOT NULL,
	`output_schema_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`model` text,
	`error_code` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "skill_runs_step_index_check" CHECK(step_index >= 0),
	CONSTRAINT "skill_runs_category_check" CHECK(category IN ('routing','elicitation','structuring','validation','decisioning','composition')),
	CONSTRAINT "skill_runs_status_check" CHECK(status IN ('running','succeeded','failed','skipped','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skill_runs_agent_step` ON `skill_runs` (`agent_run_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `idx_skill_runs_agent` ON `skill_runs` (`agent_run_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_runs_skill` ON `skill_runs` (`skill_id`,`skill_version`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer,
	`response_json` text,
	`resource_type` text,
	`resource_id` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "idempotency_records_actor_kind_check" CHECK(actor_kind IN ('user','guest')),
	CONSTRAINT "idempotency_records_response_json_check" CHECK(response_json IS NULL OR json_valid(response_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_idempotency_records_actor_endpoint_key` ON `idempotency_records` (`actor_kind`,`actor_id`,`endpoint`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `report_gate_results` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`gate_code` text NOT NULL,
	`status` text NOT NULL,
	`defects_json` text DEFAULT '[]' NOT NULL,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `report_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "report_gate_results_status_check" CHECK(status IN ('passed','failed','warning')),
	CONSTRAINT "report_gate_results_defects_json_check" CHECK(json_valid(defects_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_gate_results_report_gate` ON `report_gate_results` (`report_id`,`gate_code`);--> statement-breakpoint
CREATE TABLE `report_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`report_version` integer NOT NULL,
	`baseline_id` text NOT NULL,
	`data_hash` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version` text NOT NULL,
	`core_schema_version` text NOT NULL,
	`report_input_schema_hash` text NOT NULL,
	`compiler_version` text NOT NULL,
	`domain_profile_id` text NOT NULL,
	`domain_profile_version` integer NOT NULL,
	`domain_pack_versions_json` text NOT NULL,
	`prompt_versions_json` text DEFAULT '[]' NOT NULL,
	`model_versions_json` text DEFAULT '[]' NOT NULL,
	`audience` text NOT NULL,
	`language` text NOT NULL,
	`file_blob_id` text,
	`file_sha256` text,
	`status` text NOT NULL,
	`generated_at` text NOT NULL,
	`released_by` text,
	`released_at` text,
	`supersedes_report_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`baseline_id`) REFERENCES `baselines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`domain_profile_id`) REFERENCES `domain_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`file_blob_id`) REFERENCES `blobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`released_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_id`,`template_version`) REFERENCES `report_templates`(`id`,`version`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_report_id`) REFERENCES `report_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "report_snapshots_report_version_check" CHECK(report_version > 0),
	CONSTRAINT "report_snapshots_domain_pack_versions_json_check" CHECK(json_valid(domain_pack_versions_json)),
	CONSTRAINT "report_snapshots_prompt_versions_json_check" CHECK(json_valid(prompt_versions_json)),
	CONSTRAINT "report_snapshots_model_versions_json_check" CHECK(json_valid(model_versions_json)),
	CONSTRAINT "report_snapshots_status_check" CHECK(status IN ('draft','gate_failed','rendering','staged','ready','released','publish_failed','superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_report_snapshots_project_version` ON `report_snapshots` (`project_id`,`report_version`);--> statement-breakpoint
CREATE INDEX `idx_report_snapshots_project_version` ON `report_snapshots` (`project_id`,`report_version`);--> statement-breakpoint
CREATE TABLE `report_templates` (
	`id` text NOT NULL,
	`audience` text NOT NULL,
	`version` text NOT NULL,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`id`, `version`),
	CONSTRAINT "report_templates_status_check" CHECK(status IN ('draft','active','deprecated'))
);
--> statement-breakpoint
CREATE TABLE `training_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`case_version` text NOT NULL,
	`user_id` text,
	`guest_session_id` text,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`attempt_number` integer NOT NULL,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`guest_session_id`) REFERENCES `guest_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "training_attempts_status_check" CHECK(status IN ('not_started','interviewing','summarizing','feedback_ready','retrying','completed')),
	CONSTRAINT "training_attempts_attempt_number_check" CHECK(attempt_number > 0),
	CONSTRAINT "training_attempts_version_check" CHECK(version > 0),
	CONSTRAINT "training_attempts_owner_xor" CHECK((user_id IS NOT NULL AND guest_session_id IS NULL)
        OR (user_id IS NULL AND guest_session_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_training_attempts_user_id` ON `training_attempts` (`user_id`) WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_training_attempts_guest_session_id` ON `training_attempts` (`guest_session_id`) WHERE guest_session_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_training_attempts_case_id` ON `training_attempts` (`case_id`);--> statement-breakpoint
CREATE TABLE `training_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`difficulty` text NOT NULL,
	`scenario_json` text NOT NULL,
	`disclosure_rules_json` text NOT NULL,
	`rubric_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "training_cases_difficulty_check" CHECK(difficulty IN ('easy','medium','hard')),
	CONSTRAINT "training_cases_status_check" CHECK(status IN ('draft','active','deprecated')),
	CONSTRAINT "training_cases_scenario_json_check" CHECK(json_valid(scenario_json)),
	CONSTRAINT "training_cases_disclosure_rules_json_check" CHECK(json_valid(disclosure_rules_json)),
	CONSTRAINT "training_cases_rubric_json_check" CHECK(json_valid(rubric_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_training_cases_case_version` ON `training_cases` (`case_id`,`version`);--> statement-breakpoint
CREATE TABLE `training_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`coverage_score_bp` integer NOT NULL,
	`missing_dimension_count` integer NOT NULL,
	`feedback_json` text NOT NULL,
	`dimension_breakdown_json` text DEFAULT '[]' NOT NULL,
	`improvement_examples_json` text DEFAULT '[]' NOT NULL,
	`generated_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `training_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "training_feedback_coverage_score_bp_check" CHECK(coverage_score_bp >= 0 AND coverage_score_bp <= 10000),
	CONSTRAINT "training_feedback_feedback_json_check" CHECK(json_valid(feedback_json)),
	CONSTRAINT "training_feedback_dimension_breakdown_json_check" CHECK(json_valid(dimension_breakdown_json)),
	CONSTRAINT "training_feedback_improvement_examples_json_check" CHECK(json_valid(improvement_examples_json))
);
--> statement-breakpoint
CREATE TABLE `training_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`question_index` integer NOT NULL,
	`asked_at` text NOT NULL,
	`disclosure_rule_hit` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `training_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "training_questions_question_index_check" CHECK(question_index >= 0)
);
--> statement-breakpoint
CREATE TABLE `training_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`version` integer NOT NULL,
	`summary_hash` text NOT NULL,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `training_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "training_summaries_version_check" CHECK(version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_training_summaries_attempt_version` ON `training_summaries` (`attempt_id`,`version`);--> statement-breakpoint
CREATE TABLE `delete_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`target_id` text NOT NULL,
	`requester_type` text NOT NULL,
	`requester_id` text NOT NULL,
	`reason` text,
	`status` text NOT NULL,
	`legal_hold` integer DEFAULT 0 NOT NULL,
	`legal_hold_reason` text,
	`estimated_purge_at` text,
	`completed_at` text,
	`failure_reason` text,
	`audit_ref` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "delete_tasks_scope_check" CHECK(scope IN ('quick_session','formal_project','training_attempt','user_account','expired_data','temp_export')),
	CONSTRAINT "delete_tasks_requester_type_check" CHECK(requester_type IN ('user','guest','system')),
	CONSTRAINT "delete_tasks_status_check" CHECK(status IN ('pending','in_progress','completed','failed','cancelled')),
	CONSTRAINT "delete_tasks_legal_hold_check" CHECK(legal_hold IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `idx_delete_tasks_target_id` ON `delete_tasks` (`target_id`);--> statement-breakpoint
CREATE INDEX `idx_delete_tasks_status` ON `delete_tasks` (`status`);--> statement-breakpoint
CREATE TABLE `deletion_ledger` (
	`ledger_seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`delete_task_id` text NOT NULL,
	`scope` text NOT NULL,
	`target_hmac` text NOT NULL,
	`accepted_at` text NOT NULL,
	`status` text NOT NULL,
	`db_snapshot_watermark` text,
	`entry_hash` text NOT NULL,
	`prev_entry_hash` text,
	`written_at` text NOT NULL,
	CONSTRAINT "deletion_ledger_scope_check" CHECK(scope IN ('quick_session','formal_project','training_attempt','user_account','expired_data','temp_export')),
	CONSTRAINT "deletion_ledger_status_check" CHECK(status IN ('accepted','completed','failed','cancelled'))
);
