/**
 * Tiny syntax highlighter for `JSON.stringify(value, null, 2)` output.
 *
 * Returns a flat list of React nodes (mix of plain strings for whitespace
 * and `<span>`s with semantic Tailwind classes for tokens) so the caller
 * just splats them inside a `<pre>`. No external dependency — the regex
 * covers the entire JSON grammar produced by `JSON.stringify`:
 *
 *   - strings (with escapes), distinguishing keys (followed by `:`) from values
 *   - numbers, including the exponent form
 *   - the literals `true` / `false` / `null`
 *   - structural punctuation `{ } [ ] , :`
 *
 * Anything outside a token (whitespace, newlines) is emitted verbatim,
 * which preserves the indentation `JSON.stringify` already produced.
 */
import { Fragment, type ReactNode } from 'react';

// Single pass tokenizer. Groups:
//   1: string body (possibly a key — see group 2)
//   2: `\s*:` when the preceding string is a key (always empty whitespace
//      in `JSON.stringify` output, but we accept it for safety)
//   3: number
//   4: true | false | null
//   5: structural punctuation
const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g;

export function highlightJson(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of json.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(json.slice(last, idx));
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push(
          <span key={key++} className="text-accent">
            {m[1]}
          </span>,
          <span key={key++} className="text-text-muted">
            {m[2]}
          </span>,
        );
      } else {
        out.push(
          <span key={key++} className="text-success">
            {m[1]}
          </span>,
        );
      }
    } else if (m[3] !== undefined) {
      out.push(
        <span key={key++} className="text-warning">
          {m[3]}
        </span>,
      );
    } else if (m[4] !== undefined) {
      // true / false / null share the danger color so they stand out from
      // numeric/string values — they're the things you usually skim for.
      out.push(
        <span key={key++} className="text-danger">
          {m[4]}
        </span>,
      );
    } else if (m[5] !== undefined) {
      out.push(
        <span key={key++} className="text-text-muted">
          {m[5]}
        </span>,
      );
    }
    last = idx + m[0].length;
  }
  if (last < json.length) out.push(json.slice(last));
  // Wrap in Fragment-keyed array — React doesn't require keys on plain
  // strings, only on the span elements which already carry them.
  return out.map((node, i) =>
    typeof node === 'string' ? <Fragment key={`t${i}`}>{node}</Fragment> : node,
  );
}
