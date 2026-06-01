-- Add forum-topic routing to destinations. When a destination's chat is a
-- forum supergroup, `topic_id` holds the topic's `top_msg_id` (stored as
-- text for parity with the other 64-bit ids, converted to a number only at
-- the forward boundary) and `topic_title` caches the topic name so the list
-- and badges render without a live `channels.GetForumTopics` round-trip.
-- NULL means "no explicit topic" — the General topic for a forum, or the
-- only behaviour for a normal chat.

ALTER TABLE `destinations` ADD COLUMN `topic_id` text;
--> statement-breakpoint
ALTER TABLE `destinations` ADD COLUMN `topic_title` text;
