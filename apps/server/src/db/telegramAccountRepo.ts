/**
 * Repository for the single-row `telegram_account` table.
 *
 * The row is logically a singleton: every write goes to id=1 via
 * `onConflictDoUpdate`, every read returns the row or null. Callers never
 * see the encryption key here — they pass already-encrypted blobs in and
 * decryption happens at the call site (see `tg/client.ts`).
 */
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { telegramAccount, type TelegramAccount } from './schema.js';

const ROW_ID = 1;

export interface UpsertTelegramAccountInput {
  encryptedSessionString: string;
  keyFingerprint: string;
  phoneNumber: string | null;
  displayName: string | null;
  username: string | null;
  telegramUserId: string | null;
}

export function getActiveAccount(db: Db): TelegramAccount | null {
  const row = db.select().from(telegramAccount).where(eq(telegramAccount.id, ROW_ID)).get();
  return row ?? null;
}

export function upsertAccount(db: Db, payload: UpsertTelegramAccountInput): TelegramAccount {
  const now = new Date();
  db.insert(telegramAccount)
    .values({
      id: ROW_ID,
      encryptedSessionString: payload.encryptedSessionString,
      keyFingerprint: payload.keyFingerprint,
      phoneNumber: payload.phoneNumber,
      displayName: payload.displayName,
      username: payload.username,
      telegramUserId: payload.telegramUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: telegramAccount.id,
      set: {
        encryptedSessionString: payload.encryptedSessionString,
        keyFingerprint: payload.keyFingerprint,
        phoneNumber: payload.phoneNumber,
        displayName: payload.displayName,
        username: payload.username,
        telegramUserId: payload.telegramUserId,
        updatedAt: now,
      },
    })
    .run();
  const row = getActiveAccount(db);
  if (!row) {
    // Should be impossible — the upsert above just wrote id=1.
    throw new Error('telegram_account row vanished after upsert');
  }
  return row;
}

export function deleteAccount(db: Db): void {
  db.delete(telegramAccount).where(eq(telegramAccount.id, ROW_ID)).run();
}
