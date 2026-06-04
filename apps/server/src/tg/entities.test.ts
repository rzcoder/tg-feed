import { describe, it, expect } from 'vitest';
import { extractMessageEntities } from './entities.js';

describe('extractMessageEntities', () => {
  it('returns empty arrays for no entities', () => {
    expect(extractMessageEntities('hello', undefined)).toEqual({ entityTexts: [], links: [] });
    expect(extractMessageEntities('hello', null)).toEqual({ entityTexts: [], links: [] });
    expect(extractMessageEntities('hello', [])).toEqual({ entityTexts: [], links: [] });
  });

  it('TextUrl: url goes to both entityTexts and links(entity)', () => {
    const result = extractMessageEntities('click here', [
      { className: 'MessageEntityTextUrl', offset: 0, length: 5, url: 'https://example.com' },
    ]);
    expect(result.entityTexts).toEqual(['https://example.com']);
    expect(result.links).toEqual([{ url: 'https://example.com', source: 'entity' }]);
  });

  it('Url: the body span becomes a text-source link, not entityText', () => {
    const text = 'visit https://t.me/foo now';
    const result = extractMessageEntities(text, [
      { className: 'MessageEntityUrl', offset: 6, length: 16 },
    ]);
    expect(result.links).toEqual([{ url: 'https://t.me/foo', source: 'text' }]);
    expect(result.entityTexts).toEqual([]);
  });

  it('Pre: language goes to entityTexts only', () => {
    const result = extractMessageEntities('code', [
      { className: 'MessageEntityPre', offset: 0, length: 4, language: 'python' },
    ]);
    expect(result.entityTexts).toEqual(['python']);
    expect(result.links).toEqual([]);
  });

  it('Pre without a language is ignored', () => {
    const result = extractMessageEntities('code', [
      { className: 'MessageEntityPre', offset: 0, length: 4 },
    ]);
    expect(result).toEqual({ entityTexts: [], links: [] });
  });

  it('ignores formatting-only entities (Bold/Italic/Mention/Hashtag/Code/Email/Phone)', () => {
    const result = extractMessageEntities('text', [
      { className: 'MessageEntityBold', offset: 0, length: 4 },
      { className: 'MessageEntityItalic', offset: 0, length: 4 },
      { className: 'MessageEntityMention', offset: 0, length: 4 },
      { className: 'MessageEntityHashtag', offset: 0, length: 4 },
      { className: 'MessageEntityCode', offset: 0, length: 4 },
      { className: 'MessageEntityEmail', offset: 0, length: 4 },
      { className: 'MessageEntityPhone', offset: 0, length: 4 },
    ]);
    expect(result).toEqual({ entityTexts: [], links: [] });
  });

  it('preserves order and keeps duplicate TextUrl targets', () => {
    const result = extractMessageEntities('a b', [
      { className: 'MessageEntityTextUrl', offset: 0, length: 1, url: 'https://a.example' },
      { className: 'MessageEntityTextUrl', offset: 2, length: 1, url: 'https://a.example' },
    ]);
    expect(result.entityTexts).toEqual(['https://a.example', 'https://a.example']);
    expect(result.links).toHaveLength(2);
  });

  it('skips malformed entities without throwing', () => {
    const result = extractMessageEntities('short', [
      null as never,
      { offset: 0, length: 2 }, // no className
      { className: 'MessageEntityUrl', offset: -1, length: 4 }, // negative offset
      { className: 'MessageEntityUrl', offset: 0, length: 999 }, // past end
      { className: 'MessageEntityUrl', offset: 0 }, // missing length
      { className: 'MessageEntityTextUrl', offset: 0, length: 1, url: '' }, // empty url
    ]);
    expect(result).toEqual({ entityTexts: [], links: [] });
  });

  it('slices URL spans correctly across an astral character (UTF-16 code units)', () => {
    // The emoji is 2 UTF-16 code units, so the URL begins at offset 3.
    const text = '😀 https://t.me/x';
    const result = extractMessageEntities(text, [
      { className: 'MessageEntityUrl', offset: 3, length: 14 },
    ]);
    expect(result.links).toEqual([{ url: 'https://t.me/x', source: 'text' }]);
  });
});
