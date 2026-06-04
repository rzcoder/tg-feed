-- Allow the 'link-prefix' rule type in library_filters.
--
-- The rule_type CHECK (from 0002) enumerates the allowed types; SQLite can't
-- alter a CHECK in place, so rebuild the table — same create-new → copy → drop
-- → rename pattern as 0009. Live column order is id, name, rule_type, params,
-- created_at, mode (mode was appended by 0007), so the INSERT...SELECT follows
-- that order. Both CHECKs are re-declared inline.
--
-- The FK from subscription_library_filters.library_filter_id is tracked by table
-- name and survives the rename; migrate.ts runs with foreign_keys=OFF and a
-- foreign_key_check afterwards, so no referencing rows are touched (ids preserved).

CREATE TABLE `__new_library_filters` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `rule_type` text NOT NULL,
  `params` text NOT NULL,
  `created_at` integer NOT NULL,
  `mode` text DEFAULT 'include' NOT NULL,
  CONSTRAINT "library_filters_rule_type_check" CHECK(rule_type IN ('text-contains', 'text-excludes', 'text-regex', 'has-media', 'min-length', 'sender-allowlist', 'link-prefix')),
  CONSTRAINT "library_filters_mode_check" CHECK(mode IN ('include', 'exclude'))
);
--> statement-breakpoint

INSERT INTO `__new_library_filters` (`id`, `name`, `rule_type`, `params`, `created_at`, `mode`)
SELECT `id`, `name`, `rule_type`, `params`, `created_at`, `mode` FROM `library_filters`;
--> statement-breakpoint

DROP TABLE `library_filters`;
--> statement-breakpoint

ALTER TABLE `__new_library_filters` RENAME TO `library_filters`;
