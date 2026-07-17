CREATE TABLE `event_calendar_syncs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`target_kind` text NOT NULL,
	`target_calendar_id` text NOT NULL,
	`google_event_id` text,
	`google_etag` text,
	`last_payload_hash` text,
	`sync_state` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_attempt_at` text,
	`synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_calendar_syncs_target_kind_check" CHECK("event_calendar_syncs"."target_kind" in ('master', 'venue')),
	CONSTRAINT "event_calendar_syncs_sync_state_check" CHECK("event_calendar_syncs"."sync_state" in ('pending', 'syncing', 'synced', 'delete_pending', 'deleted', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_calendar_syncs_event_target_unique` ON `event_calendar_syncs` (`event_id`,`target_kind`);--> statement-breakpoint
CREATE INDEX `event_calendar_syncs_state_updated_idx` ON `event_calendar_syncs` (`sync_state`,`updated_at`);--> statement-breakpoint
ALTER TABLE `events` ADD `start_time` text;--> statement-breakpoint
ALTER TABLE `events` ADD `end_time` text;--> statement-breakpoint
ALTER TABLE `events` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `events` ADD `timezone` text DEFAULT 'Europe/Madrid' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `calendar_dirty` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `calendar_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `venues` ADD `google_calendar_id` text;--> statement-breakpoint
UPDATE `venues`
SET `google_calendar_id` = '844713c0767a21b5e5ae9ac53bd467f8efc24afe9893c4830a19b6fcae810674@group.calendar.google.com'
WHERE lower(trim(`name`)) = lower('Vive Roda');
