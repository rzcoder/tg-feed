import { textRegexParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';

export const textRegexRule: FilterRule<'text-regex'> = {
  type: 'text-regex',
  label: 'Text matches regex',
  paramsSchema: textRegexParamsSchema,
  evaluate(context, params) {
    const re = new RegExp(params.pattern, params.flags);
    if (re.test(context.text)) return { pass: true };
    return { pass: false, reason: `pattern /${params.pattern}/${params.flags} not matched` };
  },
};
