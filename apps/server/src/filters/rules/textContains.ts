import { textContainsParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';
import { textValueMatches } from './textTargets.js';

export const textContainsRule: FilterRule<'text-contains'> = {
  type: 'text-contains',
  label: 'Text contains',
  paramsSchema: textContainsParamsSchema,
  evaluate(context, params) {
    if (textValueMatches(context, params)) return { pass: true };
    return { pass: false, reason: `value "${params.value}" not found` };
  },
};
