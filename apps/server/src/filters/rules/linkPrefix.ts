import { linkPrefixParamsSchema, type LinkPrefixScope } from '@tg-feed/shared';
import type { FilterRule, MessageContext } from '../types.js';

// Prefix-matches a message's links against `value`, case-insensitively, ignoring a leading `www.` on the host.
// Scheme handling: a scheme (https://, tg://, …) is compared only when BOTH the value and the link carry one,
// so `https://t.me/` still matches a bare `t.me/…` that Telegram stored without a protocol, while `tg://x`
// won't match an explicit `https://x`. A host-only value is anchored at the host boundary, so `t.me` matches
// `t.me`, `t.me/x`, `t.me:80` but NOT the look-alike `t.me.evil.com`; a value that already includes a path
// (`t.me/join`) matches by plain prefix from there.

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
const LEADING_WWW_RE = /^www\./i;
// Characters that terminate the host: path, port, query, fragment.
const HOST_BOUNDARY_RE = /[/:?#]/;

interface ParsedUrl {
  scheme: string | null;
  rest: string; // host[/path…], lowercased, leading www. removed
}

function parseUrl(s: string): ParsedUrl {
  const lowered = s.trim().toLowerCase();
  const m = SCHEME_RE.exec(lowered);
  const scheme = m ? m[1]! : null;
  const afterScheme = m ? lowered.slice(m[0].length) : lowered;
  return { scheme, rest: afterScheme.replace(LEADING_WWW_RE, '') };
}

function urlMatches(value: ParsedUrl, link: ParsedUrl): boolean {
  // Scheme is a discriminator only when both sides specify one.
  if (value.scheme !== null && link.scheme !== null && value.scheme !== link.scheme) {
    return false;
  }
  if (!link.rest.startsWith(value.rest)) return false;
  // A value that reaches past the host (has its own delimiter) is already anchored.
  if (HOST_BOUNDARY_RE.test(value.rest)) return true;
  // Host-only value: the next char must end the host, not extend the label/domain.
  const next = link.rest.charAt(value.rest.length);
  return next === '' || HOST_BOUNDARY_RE.test(next);
}

export function linkPrefixMatches(value: string, links: readonly string[]): boolean {
  const needle = parseUrl(value);
  if (needle.rest.length === 0) return false; // empty value, or just a scheme/"www."
  for (const link of links) {
    if (link.length > 0 && urlMatches(needle, parseUrl(link))) return true;
  }
  return false;
}

function linksForScope(context: MessageContext, scope: LinkPrefixScope): string[] {
  const all = context.links ?? [];
  const filtered = scope === 'both' ? all : all.filter((l) => l.source === scope);
  return filtered.map((l) => l.url);
}

export const linkPrefixRule: FilterRule<'link-prefix'> = {
  type: 'link-prefix',
  label: 'Link prefix',
  paramsSchema: linkPrefixParamsSchema,
  evaluate(context, params) {
    const links = linksForScope(context, params.scope);
    if (linkPrefixMatches(params.value, links)) return { pass: true };
    return {
      pass: false,
      reason: `no link starting with "${params.value}" (scope: ${params.scope})`,
    };
  },
};
