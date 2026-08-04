CREATE TABLE IF NOT EXISTS `ai_usage` (
  `usage_date` text PRIMARY KEY NOT NULL,
  `neurons` integer NOT NULL DEFAULT 0,
  `requests` integer NOT NULL DEFAULT 0
);
