ALTER TABLE `skill_runs` ADD COLUMN `provider` text;--> statement-breakpoint
ALTER TABLE `skill_runs` ADD COLUMN `thinking_mode` text;--> statement-breakpoint
ALTER TABLE `skill_runs` ADD COLUMN `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `skill_runs` ADD COLUMN `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `skill_runs` ADD COLUMN `usage_estimated` integer;
