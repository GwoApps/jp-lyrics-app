CREATE TABLE IF NOT EXISTS `ai_usage_reservations` (
	`request_id` text PRIMARY KEY NOT NULL,
	`usage_date` text NOT NULL,
	`estimated_neurons` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_usage_reservations_usage_date_idx` ON `ai_usage_reservations` (`usage_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_usage_reservations_status_idx` ON `ai_usage_reservations` (`status`);
