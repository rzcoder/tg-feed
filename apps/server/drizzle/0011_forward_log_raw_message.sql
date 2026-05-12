-- Add a JSON snapshot of the raw gramjs `Message` to `forward_log` so the
-- Activity UI can surface the original payload for debugging. Nullable so
-- rows from before this column existed remain valid and so we can store
-- NULL for events we deliberately skip (MessageEmpty / MessageService).

ALTER TABLE `forward_log` ADD `raw_message` text;
