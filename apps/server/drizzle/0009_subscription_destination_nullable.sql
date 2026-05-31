-- Make `subscriptions.destination_id` nullable, and switch the FK from
-- ON DELETE RESTRICT to ON DELETE SET NULL.
--
-- Rationale: a subscription can now exist without a destination — created
-- via Settings → Import when the destination is missing, or detached by the
-- user. The forwarder skips such rows, the UI surfaces a "no destination"
-- badge, and the user can attach a destination later.
--
-- SQLite can't ALTER a column's NOT NULL or FK in place — recreate the
-- table. Same rename → create-new → copy → drop pattern as 0001 (FKs from
-- subscription_filters / subscription_library_filters / forward_log are
-- tracked by table name and survive a recreate that preserves rowids).

CREATE TABLE `__new_subscriptions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_chat_id` text NOT NULL,
  `source_title` text NOT NULL,
  `handle` text,
  `icon_data_url` text,
  `destination_id` integer,
  `enabled` integer DEFAULT true NOT NULL,
  `forwarding_restricted_at` integer,
  `source_access_status` text NOT NULL DEFAULT 'ok',
  `source_access_checked_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

INSERT INTO `__new_subscriptions` (
  `id`, `source_chat_id`, `source_title`, `handle`, `icon_data_url`,
  `destination_id`, `enabled`, `forwarding_restricted_at`,
  `source_access_status`, `source_access_checked_at`, `created_at`
)
SELECT
  `id`, `source_chat_id`, `source_title`, `handle`, `icon_data_url`,
  `destination_id`, `enabled`, `forwarding_restricted_at`,
  `source_access_status`, `source_access_checked_at`, `created_at`
FROM `subscriptions`;
--> statement-breakpoint

DROP TABLE `subscriptions`;
--> statement-breakpoint

ALTER TABLE `__new_subscriptions` RENAME TO `subscriptions`;
--> statement-breakpoint

CREATE INDEX `idx_subscriptions_source_chat_id` ON `subscriptions` (`source_chat_id`);
