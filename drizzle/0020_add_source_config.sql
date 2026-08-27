-- Add per-source behaviour overrides for builtin lyrics providers (ISSUE #196).
-- Stored as JSON; each builtin source defines its own schema via the provider
-- API schema (see src/lib/lyrics-provider/api-schema.ts).
ALTER TABLE `lyrics_provider_configs` ADD `source_config` text;--> statement-breakpoint
