CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `forward_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer,
	`source_message_id` text NOT NULL,
	`dest_message_id` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "forward_log_status_check" CHECK("forward_log"."status" IN ('sent', 'filtered', 'flood_wait', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_forward_log_created_at` ON `forward_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_forward_log_subscription` ON `forward_log` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `subscription_filters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`rule_type` text NOT NULL,
	`params` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_subscription_filters_sub` ON `subscription_filters` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_chat_id` text NOT NULL,
	`source_title` text NOT NULL,
	`destination_chat_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tg_session` (
	`key` text PRIMARY KEY NOT NULL,
	`encrypted_string` text NOT NULL
);
