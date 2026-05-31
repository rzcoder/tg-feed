-- Track when a subscription's source channel last refused forwarding.
--
-- When `messages.forwardMessages` returns `CHAT_FORWARDS_RESTRICTED`
-- (Telegram's `noforwards` flag — channel admin disabled "Save Content"),
-- the forwarder writes `now()` into this column. The next successful
-- forward clears it back to NULL. The web UI reads this through the
-- subscription DTO and renders a badge so the operator sees which
-- subscriptions are silently bouncing on every send.
--
-- Nullable, no default — matches the "absent until observed" semantics.

ALTER TABLE `subscriptions` ADD COLUMN `forwarding_restricted_at` integer;
