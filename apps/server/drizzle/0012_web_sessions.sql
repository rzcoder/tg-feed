-- Per-login session table. Replaces the static cookie value with opaque
-- random tokens so logout actually invalidates a session server-side and a
-- stolen cookie has a single revocation point.

CREATE TABLE `web_sessions` (
    `token` text PRIMARY KEY NOT NULL,
    `created_at` integer NOT NULL,
    `expires_at` integer NOT NULL,
    `last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_web_sessions_expires_at` ON `web_sessions` (`expires_at`);
