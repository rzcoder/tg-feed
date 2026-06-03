-- Library filters + M:N join.
--
-- Reusable named filter rules attachable to many subscriptions. The
-- evaluator UNIONs these with per-sub filters at evaluation time.

CREATE TABLE `library_filters` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `rule_type` text NOT NULL,
  `params` text NOT NULL,
  `created_at` integer NOT NULL,
  CONSTRAINT "library_filters_rule_type_check" CHECK(rule_type IN ('text-contains', 'text-excludes', 'text-regex', 'has-media', 'min-length', 'sender-allowlist'))
);
--> statement-breakpoint

CREATE TABLE `subscription_library_filters` (
  `subscription_id` integer NOT NULL,
  `library_filter_id` integer NOT NULL,
  PRIMARY KEY (`subscription_id`, `library_filter_id`),
  FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`library_filter_id`) REFERENCES `library_filters`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint

CREATE INDEX `idx_subscription_library_filters_lib` ON `subscription_library_filters` (`library_filter_id`);
