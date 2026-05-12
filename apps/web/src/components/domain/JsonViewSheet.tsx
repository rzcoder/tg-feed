/**
 * Sheet wrapper that surfaces the raw gramjs JSON for a `forward_log` row.
 *
 * Triggered from `ActivityRow`'s "{}" button. The actual JSON isn't on the
 * list response — the Sheet fetches `GET /forward-log/:id/raw` via
 * `useForwardLogRaw` so we don't bloat hydration. For album rows the
 * payload is a JSON array; for single messages, a plain object — the
 * `<pre>` renders either shape verbatim. Copy puts the formatted string on
 * the clipboard; a brief "Copied" label confirms.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useForwardLogRaw } from '@/hooks/useForwardLogRaw';
import { highlightJson } from '@/lib/highlightJson';

interface JsonViewSheetProps {
  open: boolean;
  forwardLogId: number | null;
  onOpenChange: (open: boolean) => void;
}

export function JsonViewSheet({ open, forwardLogId, onOpenChange }: JsonViewSheetProps) {
  const query = useForwardLogRaw(open ? forwardLogId : null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const formatted =
    query.data && query.data.rawMessage !== null
      ? JSON.stringify(query.data.rawMessage, null, 2)
      : null;
  // Memoise so re-renders for the spinner / copy-state don't re-tokenize a
  // multi-KB payload. The token regex is linear but allocations add up on
  // a long album.
  const highlighted = useMemo(() => (formatted ? highlightJson(formatted) : null), [formatted]);

  const onCopy = async () => {
    if (!formatted) return;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
    } catch {
      // Clipboard API can fail in non-secure contexts — silently ignore;
      // the user can still select + copy from the <pre> by hand.
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Raw message"
      description={
        Array.isArray(query.data?.rawMessage)
          ? `Album · ${query.data.rawMessage.length} message${
              query.data.rawMessage.length === 1 ? '' : 's'
            }`
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
      ) : highlighted ? (
        <pre className="font-mono text-[11px] leading-[1.5] text-text whitespace-pre-wrap break-all">
          {highlighted}
        </pre>
      ) : (
        <div className="text-[12.5px] text-text-muted">No raw payload stored for this entry.</div>
      )}
    </Sheet>
  );
}
