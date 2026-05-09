import { minLengthParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';

export const minLengthRule: FilterRule<'min-length'> = {
  type: 'min-length',
  label: 'Minimum text length',
  paramsSchema: minLengthParamsSchema,
  evaluate(context, params) {
    if (context.text.length >= params.min) return { pass: true };
    return {
      pass: false,
      reason: `text length ${context.text.length} below min ${params.min}`,
    };
  },
};
