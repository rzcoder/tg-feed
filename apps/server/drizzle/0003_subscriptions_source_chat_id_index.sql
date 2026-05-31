-- Index `subscriptions.source_chat_id` for the listener's per-event lookup.
--
-- The TG listener queries `WHERE source_chat_id = ?` on every incoming
-- message; without this index it falls back to a full scan of all enabled
-- subscriptions. With the index it's an O(log n) probe.

CREATE INDEX `idx_subscriptions_source_chat_id` ON `subscriptions` (`source_chat_id`);
