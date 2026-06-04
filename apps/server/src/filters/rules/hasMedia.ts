import { hasMediaParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';

export const hasMediaRule: FilterRule<'has-media'> = {
  type: 'has-media',
  label: 'Has media',
  paramsSchema: hasMediaParamsSchema,
  evaluate(context, params) {
    if (context.hasMedia !== params.required) {
      return {
        pass: false,
        reason: params.required ? 'no media on message' : 'media present',
      };
    }
    if (params.countOp !== undefined && params.count !== undefined) {
      const n = context.mediaCount ?? (context.hasMedia ? 1 : 0);
      const ok = params.countOp === 'gt' ? n > params.count : n < params.count;
      if (!ok) {
        const sym = params.countOp === 'gt' ? '>' : '<';
        return { pass: false, reason: `media count ${n} not ${sym} ${params.count}` };
      }
    }
    return { pass: true };
  },
};
