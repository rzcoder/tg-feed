/**
 * Best-effort POJO snapshot of a gramjs `Message` (or any TL object) for
 * persistence in `forward_log.raw_message`.
 *
 * gramjs's `TLObject` classes already implement `toJSON()` correctly —
 * `BigInteger` instances stringify, `Buffer`s become base64. Round-tripping
 * through `JSON.stringify` + `JSON.parse` invokes those `toJSON` hooks for
 * us and drops class identity, which is exactly the POJO we want to store.
 * The replacer adds two safety nets that `toJSON` alone doesn't cover:
 *
 *   - **Cycle guard** via WeakSet. gramjs payloads are mostly tree-shaped,
 *     but `fwdFrom.fromId` chains can occasionally re-enter the original
 *     `peerId` graph; without the guard a single weird message blows the
 *     stack and we'd lose the row.
 *   - **Native `BigInt`** — newer Node versions (≥21) sometimes hand back
 *     raw `bigint` from MTProto deserialization where older versions used
 *     `big-integer`. `JSON.stringify` throws on these; coerce to string.
 *
 * After the round-trip we measure the encoded byte length. Pathological
 * payloads (full thumbnail strips, file refs with embedded preview blobs)
 * can balloon past 100KB; cap at `maxBytes` and replace the value with a
 * marker so the row still inserts cleanly and the UI surfaces the reason.
 *
 * Returns `null` for `null`/`undefined`, `MessageEmpty`, and `MessageService`
 * — none of those carry payloads worth viewing, and `MessageService`
 * specifically is filtered out earlier in the pipeline anyway. Callers
 * store the `null` directly.
 */

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
    // Last-resort: gramjs surfaced a value we can't round-trip (e.g. a
    // class with a throwing `toJSON`). Drop it rather than crash the
    // forward — the row is still valuable without the snapshot.
    return null;
  }

  if (encoded === undefined) return null;
  if (encoded.length > maxBytes) {
    return { __truncated: true, size: encoded.length };
  }
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    return null;
  }
}
