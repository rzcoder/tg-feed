-- Drop the unused `tg_session` table.
--
-- Originally created in 0000 as an optional encrypted-at-rest cache for the
-- gramjs StringSession. The MVP design ended up using `TG_SESSION_STRING`
-- from .env as the source of truth. The
-- table was never written to from app code, and `TG_SESSION_ENCRYPTION_KEY`
-- — the env knob that would have driven AES around it — was removed in
-- favour of plain env-only storage.
--
-- Safe to DROP: no application code reads or writes this table, and any
-- existing row carried only an opaque encrypted blob the env-based flow
-- can't decrypt anyway.

DROP TABLE IF EXISTS `tg_session`;
