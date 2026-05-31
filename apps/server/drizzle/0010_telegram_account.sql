-- Single-row table for the Telegram session signed in via the Settings page.
-- Convention: always upserted at id=1. The encrypted blob is AES-256-GCM
-- ciphertext (`base64(iv ‖ tag ‖ ct)`) of the raw gramjs StringSession value,
-- encrypted with `TG_SESSION_ENCRYPTION_KEY`. `key_fingerprint` (first 16
-- hex chars of sha256(key)) lets exports advertise which key encrypted the
-- row so an import on a host with a different key can skip the row instead
-- of attempting to decrypt with the wrong key.

CREATE TABLE `telegram_account` (
  `id` integer PRIMARY KEY NOT NULL,
  `encrypted_session_string` text NOT NULL,
  `key_fingerprint` text NOT NULL,
  `phone_number` text,
  `display_name` text,
  `username` text,
  `telegram_user_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
