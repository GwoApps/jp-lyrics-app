CREATE TABLE IF NOT EXISTS `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text DEFAULT '' NOT NULL,
	`result` text DEFAULT 'success' NOT NULL,
	`occurred_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `admin_audit_log_occurred_at_idx` ON `admin_audit_log` (`occurred_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `admin_audit_log_actor_occurred_idx` ON `admin_audit_log` (`actor_user_id`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `admin_audit_log_target_idx` ON `admin_audit_log` (`target_type`, `target_id`, `occurred_at`);
