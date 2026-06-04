import type { MessageContext } from '../types.js';

// What a text rule matches against: always the visible body, plus entity-carried text
// (hidden hyperlink targets, code-block language tags) when the rule opts in via includeEntities.
export function textSearchTargets(context: MessageContext, includeEntities: boolean): string[] {
  const entityTexts = context.entityTexts;
  if (includeEntities && entityTexts && entityTexts.length > 0) {
    return [context.text, ...entityTexts];
  }
  return [context.text];
}

interface TextMatchParams {
  value: string;
  caseInsensitive: boolean;
  includeEntities: boolean;
}

// True when `value` occurs in the body (or, when opted in, any entity-carried text). Shared by the
// contains/excludes rules so the case-folding lives in one place; excludes just inverts the result.
export function textValueMatches(context: MessageContext, params: TextMatchParams): boolean {
  const needle = params.caseInsensitive ? params.value.toLowerCase() : params.value;
  return textSearchTargets(context, params.includeEntities).some((t) =>
    (params.caseInsensitive ? t.toLowerCase() : t).includes(needle),
  );
}
