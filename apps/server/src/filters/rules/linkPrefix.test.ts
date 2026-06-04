import { describe, it, expect } from 'vitest';
import type { MessageContext, MessageLink } from '../types.js';
import { linkPrefixMatches, linkPrefixRule } from './linkPrefix.js';

const ctx = (links: MessageLink[]): MessageContext => ({ text: '', hasMedia: false, links });

describe('linkPrefixMatches', () => {
  it('matches any protocol when the value has no scheme', () => {
    expect(linkPrefixMatches('t.me', ['https://t.me/foo'])).toBe(true);
    expect(linkPrefixMatches('t.me', ['tg://t.me/foo'])).toBe(true);
    expect(linkPrefixMatches('t.me', ['t.me/foo'])).toBe(true);
  });

  it('compares the scheme only when both sides carry one', () => {
    // value has a scheme, link is a bare (scheme-less) body URL → still matches.
    expect(linkPrefixMatches('https://t.me/', ['t.me/foo'])).toBe(true);
    // both have schemes and they agree.
    expect(linkPrefixMatches('https://t.me/', ['https://t.me/foo'])).toBe(true);
    // both have schemes and they differ → no match.
    expect(linkPrefixMatches('https://t.me/', ['tg://t.me/foo'])).toBe(false);
    expect(linkPrefixMatches('tg://resolve', ['tg://resolve?domain=x'])).toBe(true);
  });

  it('anchors a host-only value at the host boundary (rejects look-alike domains)', () => {
    expect(linkPrefixMatches('t.me', ['https://t.me.evil.com/x'])).toBe(false);
    expect(linkPrefixMatches('t.me', ['https://t.met/x'])).toBe(false);
    expect(linkPrefixMatches('t.me', ['https://t.me@evil.com/x'])).toBe(false);
    // legitimate boundaries
    expect(linkPrefixMatches('t.me', ['https://t.me'])).toBe(true);
    expect(linkPrefixMatches('t.me', ['https://t.me/durov'])).toBe(true);
    expect(linkPrefixMatches('t.me', ['https://t.me:443/x'])).toBe(true);
    expect(linkPrefixMatches('t.me', ['https://t.me?x=1'])).toBe(true);
  });

  it('matches a path prefix once the host is fully specified', () => {
    expect(linkPrefixMatches('t.me/joi', ['https://t.me/joinchat/abc'])).toBe(true);
    expect(linkPrefixMatches('t.me/joinchat', ['https://t.me/other'])).toBe(false);
  });

  it('normalizes a leading www. on either side', () => {
    expect(linkPrefixMatches('t.me', ['https://www.t.me/foo'])).toBe(true);
    expect(linkPrefixMatches('www.t.me', ['https://t.me/foo'])).toBe(true);
    expect(linkPrefixMatches('https://t.me', ['https://www.t.me/foo'])).toBe(true);
    // www2 is a real subdomain, not stripped
    expect(linkPrefixMatches('t.me', ['https://www2.t.me/foo'])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(linkPrefixMatches('t.me/foo', ['HTTPS://T.ME/FOO/bar'])).toBe(true);
  });

  it('keeps query strings in the prefix space', () => {
    expect(linkPrefixMatches('t.me/x?utm', ['https://t.me/x?utm=1'])).toBe(true);
  });

  it('never matches on an empty, whitespace, bare-scheme, or bare-www value', () => {
    expect(linkPrefixMatches('', ['https://t.me'])).toBe(false);
    expect(linkPrefixMatches('   ', ['https://t.me'])).toBe(false);
    expect(linkPrefixMatches('https://', ['https://t.me'])).toBe(false);
    expect(linkPrefixMatches('www.', ['https://www.t.me'])).toBe(false);
  });

  it('does not throw on an empty link list', () => {
    expect(linkPrefixMatches('t.me', [])).toBe(false);
  });
});

describe('linkPrefixRule', () => {
  it('passes when a matching link exists in scope "both"', () => {
    const result = linkPrefixRule.evaluate(
      ctx([{ url: 'https://t.me/joinchat/x', source: 'entity' }]),
      { value: 't.me/joinchat', scope: 'both' },
    );
    expect(result).toEqual({ pass: true });
  });

  it('fails with a descriptive reason when no link matches', () => {
    const result = linkPrefixRule.evaluate(ctx([{ url: 'https://example.com', source: 'text' }]), {
      value: 't.me',
      scope: 'both',
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('t.me');
    expect(result.reason).toContain('both');
  });

  it('scope "text" ignores entity-source links', () => {
    const links: MessageLink[] = [{ url: 'https://t.me/x', source: 'entity' }];
    expect(linkPrefixRule.evaluate(ctx(links), { value: 't.me', scope: 'text' }).pass).toBe(false);
    expect(linkPrefixRule.evaluate(ctx(links), { value: 't.me', scope: 'entity' }).pass).toBe(true);
    expect(linkPrefixRule.evaluate(ctx(links), { value: 't.me', scope: 'both' }).pass).toBe(true);
  });

  it('scope "entity" ignores text-source links', () => {
    const links: MessageLink[] = [{ url: 'https://t.me/x', source: 'text' }];
    expect(linkPrefixRule.evaluate(ctx(links), { value: 't.me', scope: 'entity' }).pass).toBe(
      false,
    );
    expect(linkPrefixRule.evaluate(ctx(links), { value: 't.me', scope: 'text' }).pass).toBe(true);
  });

  it('does not throw when context.links is undefined', () => {
    const result = linkPrefixRule.evaluate(
      { text: '', hasMedia: false },
      {
        value: 't.me',
        scope: 'both',
      },
    );
    expect(result.pass).toBe(false);
  });
});
