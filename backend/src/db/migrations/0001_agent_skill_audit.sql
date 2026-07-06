CREATE TABLE IF NOT EXISTS `agent_runs` (
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

CREATE INDEX IF NOT EXISTS `idx_agent_runs_job` ON `agent_runs` (`ai_job_id`);
CREATE INDEX IF NOT EXISTS `idx_agent_runs_plan` ON `agent_runs` (`plan_id`,`plan_version`);

CREATE TABLE IF NOT EXISTS `skill_runs` (
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

CREATE UNIQUE INDEX IF NOT EXISTS `uq_skill_runs_agent_step` ON `skill_runs` (`agent_run_id`,`step_index`);
CREATE INDEX IF NOT EXISTS `idx_skill_runs_agent` ON `skill_runs` (`agent_run_id`);
CREATE INDEX IF NOT EXISTS `idx_skill_runs_skill` ON `skill_runs` (`skill_id`,`skill_version`);
