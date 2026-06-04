import { textExcludesParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';
import { textValueMatches } from './textTargets.js';

export const textExcludesRule: FilterRule<'text-excludes'> = {
  type: 'text-excludes',
  label: 'Text excludes',
  paramsSchema: textExcludesParamsSchema,
  evaluate(context, params) {
    if (textValueMatches(context, params)) {
      return { pass: false, reason: `value "${params.value}" found` };
    }
    return { pass: true };
  },
};
