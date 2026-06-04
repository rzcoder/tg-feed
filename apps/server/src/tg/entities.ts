// Pulls searchable text and links out of a message's Telegram entities, for the text and link filter rules.
// Duck-typed on `className` rather than `instanceof`: the live listener passes gramjs Api.* instances, but the
// history poller passes raw client.invoke() TL objects, and class identity is irrelevant to what we read.
import type { MessageLink } from '../filters/types.js';

export interface MessageEntityLike {
  className?: string;
  offset?: number;
  length?: number;
  url?: string; // MessageEntityTextUrl
  language?: string; // MessageEntityPre
}

export interface ExtractedEntities {
  // Entity-carried text not present in the visible body (TextUrl url + Pre language).
  entityTexts: string[];
  // Every link, tagged by source. TextUrl urls are hidden ('entity'); auto-detected Url spans are visible ('text').
  links: MessageLink[];
}

// Total by contract: runs at ingestion, outside the evaluator's fail-open try/catch, so it must never throw.
export function extractMessageEntities(
  text: string,
  rawEntities: readonly MessageEntityLike[] | null | undefined,
): ExtractedEntities {
  const entityTexts: string[] = [];
  const links: MessageLink[] = [];
  if (!rawEntities || rawEntities.length === 0) return { entityTexts, links };

  for (const e of rawEntities) {
    if (!e || typeof e.className !== 'string') continue;
    switch (e.className) {
      case 'MessageEntityTextUrl': {
        // Hidden hyperlink: the target lives in `url`, the display text is already in `text`.
        if (typeof e.url === 'string' && e.url.length > 0) {
          entityTexts.push(e.url);
          links.push({ url: e.url, source: 'entity' });
        }
        break;
      }
      case 'MessageEntityUrl': {
        // Auto-detected URL: the link IS the body span at [offset, length].
        const slice = sliceByEntity(text, e);
        if (slice) links.push({ url: slice, source: 'text' });
        break;
      }
      case 'MessageEntityPre': {
        if (typeof e.language === 'string' && e.language.length > 0) {
          entityTexts.push(e.language);
        }
        break;
      }
      // Bold/Italic/Mention/Hashtag/Code/Email/Phone/etc. only mark spans of `text`, which rules already search.
      default:
        break;
    }
  }
  return { entityTexts, links };
}

// Telegram offsets/lengths are UTF-16 code units, matching JS string indexing. Bounds-checked so a malformed entity can't throw.
function sliceByEntity(text: string, e: MessageEntityLike): string | undefined {
  if (typeof e.offset !== 'number' || typeof e.length !== 'number') return undefined;
  if (e.offset < 0 || e.length <= 0 || e.offset + e.length > text.length) return undefined;
  return text.slice(e.offset, e.offset + e.length);
}
