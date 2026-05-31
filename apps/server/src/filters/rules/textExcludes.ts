import { textExcludesParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';

export const textExcludesRule: FilterRule<'text-excludes'> = {
  type: 'text-excludes',
  label: 'Text excludes',
  paramsSchema: textExcludesParamsSchema,
  evaluate(context, params) {
    const haystack = params.caseInsensitive ? context.text.toLowerCase() : context.text;
    const needle = params.caseInsensitive ? params.value.toLowerCase() : params.value;
    if (haystack.includes(needle)) {
      return { pass: false, reason: `value "${params.value}" found` };
    }
    return { pass: true };
  },
};
