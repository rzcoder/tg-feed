import { senderAllowlistParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';

export const senderAllowlistRule: FilterRule<'sender-allowlist'> = {
  type: 'sender-allowlist',
  label: 'Sender in allowlist',
  paramsSchema: senderAllowlistParamsSchema,
  evaluate(context, params) {
    if (context.senderUsername === undefined) {
      return { pass: false, reason: 'no sender info on message' };
    }
    const allowed = params.usernames.map((u) => u.toLowerCase());
    if (allowed.includes(context.senderUsername)) return { pass: true };
    return { pass: false, reason: `sender "${context.senderUsername}" not in allowlist` };
  },
};
