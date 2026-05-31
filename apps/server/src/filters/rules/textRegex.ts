import RE2 from 're2';
import { textRegexParamsSchema } from '@tg-feed/shared';
import type { FilterRule } from '../types.js';

// RE2 (linear-time regex) instead of native RegExp — pattern comes from user
// input and could otherwise trigger catastrophic backtracking and stall the
// listener loop.
export const textRegexRule: FilterRule<'text-regex'> = {
  type: 'text-regex',
  label: 'Text matches regex',
  paramsSchema: textRegexParamsSchema,
  evaluate(context, params) {
    const re = new RE2(params.pattern, params.flags);
    if (re.test(context.text)) return { pass: true };
    return { pass: false, reason: `pattern /${params.pattern}/${params.flags} not matched` };
  },
};
