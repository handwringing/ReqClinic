CREATE TABLE `training_turns` (
  `id` text PRIMARY KEY NOT NULL,
  `attempt_id` text NOT NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `bound_refs_json` text DEFAULT '[]' NOT NULL,
  `coach_projection_json` text DEFAULT '{}' NOT NULL,
  `ai_job_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`attempt_id`) REFERENCES `training_attempts`(`id`) ON UPDATE no action ON DELETE restrict,
  CONSTRAINT "training_turns_role_check" CHECK(role IN ('user','role','coach')),
  CONSTRAINT "training_turns_bound_refs_json_check" CHECK(json_valid(bound_refs_json)),
  CONSTRAINT "training_turns_coach_projection_json_check" CHECK(json_valid(coach_projection_json))
);
--> statement-breakpoint
CREATE INDEX `idx_training_turns_attempt_id` ON `training_turns` (`attempt_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_training_turns_job_role` ON `training_turns` (`ai_job_id`,`role`) WHERE ai_job_id IS NOT NULL;
