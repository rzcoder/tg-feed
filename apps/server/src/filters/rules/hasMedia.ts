import { hasMediaParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';

export const hasMediaRule: FilterRule<'has-media'> = {
  type: 'has-media',
  label: 'Has media',
  paramsSchema: hasMediaParamsSchema,
  evaluate(context, params) {
    if (context.hasMedia === params.required) return { pass: true };
    return {
      pass: false,
      reason: params.required ? 'no media on message' : 'media present',
    };
  },
};
