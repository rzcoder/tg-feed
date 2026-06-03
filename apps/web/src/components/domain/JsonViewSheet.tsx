import { useEffect, useMemo, useState } from 'react';
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

// Keep the library's structural class, stack our coloured token with `!` so Tailwind wins regardless of stylesheet order.
function withTone(libraryClass: string, ...tones: string[]): string {
  return [libraryClass, ...tones].filter(Boolean).join(' ');
}

// Root + immediate children only; keeps album payloads from dumping hundreds of lines on open.
const expandFirstLevelOnly = (level: number): boolean => level < 2;

const jsonViewStyles = {
  ...defaultStyles,
  container: withTone(defaultStyles.container, 'bg-transparent'),
  label: withTone(defaultStyles.label, '!text-accent'),
  clickableLabel: withTone(defaultStyles.clickableLabel, '!text-accent'),
  stringValue: withTone(defaultStyles.stringValue, '!text-success'),
  numberValue: withTone(defaultStyles.numberValue, '!text-warning'),
  booleanValue: withTone(defaultStyles.booleanValue, '!text-danger'),
  nullValue: withTone(defaultStyles.nullValue, '!text-danger'),
  undefinedValue: withTone(defaultStyles.undefinedValue, '!text-text-muted', 'italic'),
  otherValue: withTone(defaultStyles.otherValue, '!text-text-muted'),
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
  const formatted = useMemo(() => (raw !== null ? JSON.stringify(raw, null, 2) : null), [raw]);

  const onCopy = async () => {
    if (!formatted) return;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
    } catch {
      // Clipboard API can fail in non-secure contexts; user can still select + copy by hand.
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
        // Stored primitive: the library only renders objects/arrays, so fall back to plain text.
        <pre className="font-mono text-[11px] leading-[1.5] text-text whitespace-pre-wrap break-all">
          {JSON.stringify(raw, null, 2)}
        </pre>
      ) : (
        <div className="text-[12.5px] text-text-muted">No raw payload stored for this entry.</div>
      )}
    </Sheet>
  );
}
