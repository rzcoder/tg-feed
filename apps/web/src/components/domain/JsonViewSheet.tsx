/**
 * Sheet wrapper that surfaces the raw gramjs JSON for a `forward_log` row.
 *
 * Triggered from `ActivityRow`'s "{}" button. The actual JSON isn't on the
 * list response — the Sheet fetches `GET /forward-log/:id/raw` via
 * `useForwardLogRaw` so we don't bloat hydration. Rendering goes through
 * `react-json-view-lite` for free collapsible nodes — essential for album
 * payloads (JSON array of N nested gramjs `Message` objects).
 *
 * Theming: the library ships its own CSS module classes (which carry the
 * expand/collapse glyphs as `::after` content), and exposes the per-token
 * class names via `defaultStyles`. We spread those defaults and append our
 * own Tailwind colour tokens with `!important` so the palette follows our
 * oklch CSS variables (dark + light theme are handled automatically).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { JsonView, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useForwardLogRaw } from '@/hooks/useForwardLogRaw';

interface JsonViewSheetProps {
  open: boolean;
  forwardLogId: number | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Compose a class string for one of the library's per-token style slots.
 * Keeps the library's structural class (margins, expand-glyph `::after`,
 * etc.) and stacks our coloured token with `!` so Tailwind wins regardless
 * of stylesheet order.
 */
function withTone(libraryClass: string, ...tones: string[]): string {
  return [libraryClass, ...tones].filter(Boolean).join(' ');
}

/**
 * Expand only the root and its immediate children by default — anything
 * deeper stays collapsed behind a `{...}` placeholder. Albums (root is an
 * array of `Message` objects) then surface each member's existence on first
 * paint, but keep their internals folded so the panel doesn't dump
 * hundreds of lines on open. Single-message payloads similarly show the
 * top-level fields but collapse nested objects like `media`, `fwdFrom`.
 *
 * `level === 0` is the root call; children increment from there, so
 * `level < 2` covers root + first nesting level.
 */
const expandFirstLevelOnly = (level: number): boolean => level < 2;

const jsonViewStyles = {
  ...defaultStyles,
  // Containers don't need recolouring — they inherit from <pre>.
  container: withTone(defaultStyles.container, 'bg-transparent'),
  // Keys (object field names).
  label: withTone(defaultStyles.label, '!text-accent'),
  clickableLabel: withTone(defaultStyles.clickableLabel, '!text-accent'),
  // Value types.
  stringValue: withTone(defaultStyles.stringValue, '!text-success'),
  numberValue: withTone(defaultStyles.numberValue, '!text-warning'),
  // true / false / null share the danger tone so they stand out from
  // strings and numbers when skimming a deep payload.
  booleanValue: withTone(defaultStyles.booleanValue, '!text-danger'),
  nullValue: withTone(defaultStyles.nullValue, '!text-danger'),
  undefinedValue: withTone(defaultStyles.undefinedValue, '!text-text-muted', 'italic'),
  otherValue: withTone(defaultStyles.otherValue, '!text-text-muted'),
  // Structural marks (commas, braces, the "..." collapsed indicator, and
  // the expand/collapse triangles) all share the muted tone.
  punctuation: withTone(defaultStyles.punctuation, '!text-text-muted'),
  expandIcon: withTone(defaultStyles.expandIcon, '!text-text-muted'),
  collapseIcon: withTone(defaultStyles.collapseIcon, '!text-text-muted'),
  collapsedContent: withTone(defaultStyles.collapsedContent, '!text-text-muted'),
};

export function JsonViewSheet({ open, forwardLogId, onOpenChange }: JsonViewSheetProps) {
  const query = useForwardLogRaw(open ? forwardLogId : null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const raw = query.data?.rawMessage ?? null;
  const formatted = raw !== null ? JSON.stringify(raw, null, 2) : null;

  const onCopy = async () => {
    if (!formatted) return;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
    } catch {
      // Clipboard API can fail in non-secure contexts — silently ignore;
      // the user can still select + copy from the rendered tree by hand.
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Raw message"
      description={
        Array.isArray(raw)
          ? `Album · ${raw.length} message${raw.length === 1 ? '' : 's'}`
          : undefined
      }
      footer={
        formatted ? (
          <Button variant="secondary" size="sm" onClick={onCopy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        ) : undefined
      }
    >
      {query.isPending && forwardLogId != null ? (
        <div className="grid place-items-center py-10 text-text-muted">
          <Spinner />
        </div>
      ) : query.isError ? (
        <div className="flex items-start gap-2 text-[12.5px] text-danger">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Failed to load raw message.</span>
        </div>
      ) : raw !== null && (typeof raw === 'object' || Array.isArray(raw)) ? (
        <div className="font-mono text-[11.5px] leading-[1.5] text-text">
          <JsonView
            data={raw as object | unknown[]}
            style={jsonViewStyles}
            shouldExpandNode={expandFirstLevelOnly}
            clickToExpandNode
          />
        </div>
      ) : raw !== null ? (
        // Edge case: a stored primitive (string/number/null wrapper). The
        // library only renders objects/arrays — fall back to plain text.
        <pre className="font-mono text-[11px] leading-[1.5] text-text whitespace-pre-wrap break-all">
          {JSON.stringify(raw, null, 2)}
        </pre>
      ) : (
        <div className="text-[12.5px] text-text-muted">No raw payload stored for this entry.</div>
      )}
    </Sheet>
  );
}
