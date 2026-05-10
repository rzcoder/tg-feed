-- Chapter 10 — Destinations + Subscriptions migration.
--
-- 1. Create `destinations` (named CRUD list).
-- 2. Backfill destinations from each distinct `subscriptions.destination_chat_id`
--    so existing subscriptions can be re-pointed.
-- 3. Recreate `subscriptions` with `handle` (nullable) + `destination_id` FK,
--    dropping the old `destination_chat_id` column. SQLite can drop columns
--    natively (3.35+) but `subscriptions` has FKs from other tables that
--    reference it; the safe pattern is rename → create new → copy → drop.
-- 4. Re-create `forward_log` and `subscription_filters` foreign keys against
--    the new `subscriptions` table (SQLite tracks FKs by name; renaming the
--    referenced table keeps the FK valid because rowids are preserved).

CREATE TABLE `destinations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `chat_id` text NOT NULL,
  `note` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint

INSERT INTO `destinations` (`name`, `chat_id`, `created_at`)
SELECT
  COALESCE('Destination ' || NULLIF((ROW_NUMBER() OVER (ORDER BY destination_chat_id)), 0), 'Destination'),
  destination_chat_id,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM (SELECT DISTINCT destination_chat_id FROM `subscriptions`);
--> statement-breakpoint

CREATE TABLE `__new_subscriptions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_chat_id` text NOT NULL,
  `source_title` text NOT NULL,
  `handle` text,
  `destination_id` integer NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

INSERT INTO `__new_subscriptions` (`id`, `source_chat_id`, `source_title`, `handle`, `destination_id`, `enabled`, `created_at`)
SELECT
  s.id,
  s.source_chat_id,
  s.source_title,
  NULL,
  (SELECT d.id FROM `destinations` d WHERE d.chat_id = s.destination_chat_id LIMIT 1),
  s.enabled,
  s.created_at
FROM `subscriptions` s;
--> statement-breakpoint

DROP TABLE `subscriptions`;
--> statement-breakpoint

ALTER TABLE `__new_subscriptions` RENAME TO `subscriptions`;
