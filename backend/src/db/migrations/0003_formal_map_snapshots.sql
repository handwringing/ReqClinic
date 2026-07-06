CREATE TABLE IF NOT EXISTS `formal_map_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `version` integer NOT NULL,
  `status` text NOT NULL,
  `source_kind` text NOT NULL,
  `source_quick_session_id` text,
  `source_brief_version_id` text,
  `ai_job_id` text,
  `snapshot_json` text NOT NULL,
  `input_hash` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`ai_job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT "formal_map_snapshots_version_check" CHECK(version > 0),
  CONSTRAINT "formal_map_snapshots_status_check" CHECK(status IN ('draft','ready','fallback')),
  CONSTRAINT "formal_map_snapshots_source_kind_check" CHECK(source_kind IN ('direct','quick_upgrade','conversation_update','fallback')),
  CONSTRAINT "formal_map_snapshots_snapshot_json_check" CHECK(json_valid(snapshot_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_formal_map_snapshots_project_version` ON `formal_map_snapshots` (`project_id`,`version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_formal_map_snapshots_project_version` ON `formal_map_snapshots` (`project_id`,`version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_formal_map_snapshots_job` ON `formal_map_snapshots` (`ai_job_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `formal_turns` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `turn_index` integer NOT NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `message_type` text NOT NULL,
  `bound_refs_json` text NOT NULL DEFAULT '[]',
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "formal_turns_turn_index_check" CHECK(turn_index >= 0),
  CONSTRAINT "formal_turns_role_check" CHECK(role IN ('ai','user')),
  CONSTRAINT "formal_turns_message_type_check" CHECK(message_type IN ('question','answer','status')),
  CONSTRAINT "formal_turns_bound_refs_json_check" CHECK(json_valid(bound_refs_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_formal_turns_project_index` ON `formal_turns` (`project_id`,`turn_index`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_formal_turns_project` ON `formal_turns` (`project_id`);
