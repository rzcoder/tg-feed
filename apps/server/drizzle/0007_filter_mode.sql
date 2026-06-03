-- Per-filter include/exclude mode.
--
-- 'include' is the legacy AND-pass default — every include filter must match
-- for the message to forward. 'exclude' inverts the rule for that one row:
-- a message is rejected when its rule matches.
--
-- The CHECK keeps hand-written rows honest. Existing rows back-fill to
-- 'include' via the DEFAULT, preserving prior behavior.

ALTER TABLE `subscription_filters` ADD COLUMN `mode` TEXT NOT NULL DEFAULT 'include' CHECK (`mode` IN ('include', 'exclude'));
--> statement-breakpoint
ALTER TABLE `library_filters` ADD COLUMN `mode` TEXT NOT NULL DEFAULT 'include' CHECK (`mode` IN ('include', 'exclude'));
