-- Cache the Telegram channel/chat profile photo per row as a base64 data URL.
--
-- Telegram doesn't expose a public URL for chat photos — gramjs has to
-- download the bytes via `client.downloadProfilePhoto`. Storing the small
-- thumbnail inline (a few KB once base64-encoded) avoids a per-icon endpoint
-- and lets the existing list-DTO pipeline carry the value to the UI.
--
-- NULL means "not yet fetched". The access monitor
-- (`apps/server/src/tg/accessMonitor.ts`) backfills these lazily on its
-- daily sweep — we don't migrate existing rows here because population
-- requires a live gramjs client which isn't available during a migration.

ALTER TABLE `destinations` ADD COLUMN `icon_data_url` text;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD COLUMN `icon_data_url` text;
