CREATE TABLE `event_interviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`completion` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_interviews_event_id_unique` ON `event_interviews` (`event_id`);