import type { BotAdmin } from '@tg-feed/shared';

export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function adminIdsKey(admins: BotAdmin[]): string {
  return admins.map((a) => a.id).join(',');
}

export function adminLabel(a: BotAdmin): string {
  return a.displayName ?? (a.username ? `@${a.username}` : a.id);
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
