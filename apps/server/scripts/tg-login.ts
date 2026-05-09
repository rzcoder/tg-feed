/**
 * Interactive one-shot to mint a Telegram session string for the forwarding
 * account. Prompts for phone, login code, and (if set) 2FA password, then
 * prints a `StringSession` payload to stdout. Paste it into `.env` as
 * `TG_SESSION_STRING`.
 *
 * Usage: `pnpm tg:login`
 */
import 'dotenv/config';
import process from 'node:process';
import input from 'input';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { LogLevel } from 'telegram/extensions/Logger.js';

async function readApiId(): Promise<number> {
  const fromEnv = process.env.TG_API_ID;
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  const raw = await input.text('TG_API_ID (from https://my.telegram.org): ');
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(`Invalid TG_API_ID: ${raw}`);
  }
  return num;
}

async function readApiHash(): Promise<string> {
  const fromEnv = process.env.TG_API_HASH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const raw = await input.text('TG_API_HASH: ');
  if (!raw) throw new Error('TG_API_HASH is required');
  return raw;
}

async function main(): Promise<void> {
  const apiId = await readApiId();
  const apiHash = await readApiHash();

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });
  client.setLogLevel(LogLevel.WARN);

  console.log('\nSigning in. Use the *forwarding* account, not your main one.\n');

  await client.start({
    phoneNumber: async () => input.text('Phone (international format, e.g. +123…): '),
    phoneCode: async () => input.text('Login code: '),
    password: async () => input.password('2FA password (leave blank if none): '),
    onError: async (err) => {
      console.error(err);
      return false;
    },
  });

  const sessionString = client.session.save();
  console.log('\n=== TG_SESSION_STRING ===');
  console.log(sessionString);
  console.log('=========================');
  console.log('\nPaste the string above into .env as TG_SESSION_STRING.');

  await client.disconnect();
  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
