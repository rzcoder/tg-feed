// POJO snapshot of a gramjs TL object for forward_log.raw_message. JSON round-trip invokes toJSON and drops class identity; the replacer adds a WeakSet cycle guard (fwdFrom.fromId can re-enter the peerId graph) and coerces native bigint (Node ≥21) since JSON.stringify throws on it. Returns null for null/undefined, MessageEmpty, MessageService.

export interface ToJsonSafeOptions {
  /** Max serialized JSON byte length; over this, value is replaced with a truncation marker. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 64 * 1024;

export function toJsonSafe(value: unknown, opts: ToJsonSafeOptions = {}): unknown {
  if (value === null || value === undefined) return null;
  const cls = (value as { className?: unknown }).className;
  if (cls === 'MessageEmpty' || cls === 'MessageService') return null;

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const seen = new WeakSet<object>();
  let encoded: string;
  try {
    encoded = JSON.stringify(value, (_key, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v !== null && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    // Unround-trippable value (e.g. a throwing toJSON); drop the snapshot, keep the row.
    return null;
  }

  if (encoded === undefined) return null;
  // Real UTF-8 bytes, not UTF-16 .length which understates multibyte content.
  const byteLen = Buffer.byteLength(encoded, 'utf8');
  if (byteLen > maxBytes) {
    return { __truncated: true, size: byteLen };
  }
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    return null;
  }
}
