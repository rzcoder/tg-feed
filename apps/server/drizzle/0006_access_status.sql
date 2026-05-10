-- Track whether the userbot still has access to a chat.
--
-- The access monitor (`apps/server/src/tg/accessMonitor.ts`) periodically
-- calls `getEntity` on every source channel and destination chat. If the
-- call fails, the corresponding `*_access_status` flips to 'no_access' and
-- the web UI surfaces it as a "no access" badge. Default 'ok' so existing
-- rows aren't surfaced as broken before the first sweep completes.
--
-- The companion `*_checked_at` columns let future UIs distinguish "fresh
-- ok" from "stale ok" (we updated them every sweep regardless of status
-- transition).

ALTER TABLE `subscriptions` ADD COLUMN `source_access_status` text NOT NULL DEFAULT 'ok';
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD COLUMN `source_access_checked_at` integer;
--> statement-breakpoint
ALTER TABLE `destinations` ADD COLUMN `access_status` text NOT NULL DEFAULT 'ok';
--> statement-breakpoint
ALTER TABLE `destinations` ADD COLUMN `access_checked_at` integer;
