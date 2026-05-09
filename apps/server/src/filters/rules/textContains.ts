import { textContainsParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';

export const textContainsRule: FilterRule<'text-contains'> = {
  type: 'text-contains',
  label: 'Text contains',
  paramsSchema: textContainsParamsSchema,
  evaluate(context, params) {
    const haystack = params.caseInsensitive ? context.text.toLowerCase() : context.text;
    const needle = params.caseInsensitive ? params.value.toLowerCase() : params.value;
    if (haystack.includes(needle)) return { pass: true };
    return { pass: false, reason: `value "${params.value}" not found` };
  },
};
