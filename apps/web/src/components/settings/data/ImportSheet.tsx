import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Upload, X } from 'lucide-react';
import {
  EXPORT_SECTIONS,
  exportFileSchema,
  type ExportFile,
  type ExportSection,
  type ImportConflictStrategy,
  type ImportResult,
} from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { CheckboxCard } from '@/components/ui/checkbox-card';
import { Hint } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useImportData } from '@/hooks/useExportImport';
import { apiErrorMessage } from '@/api/client';
import {
  FILE_SOFT_WARN_BYTES,
  SECTION_LABELS,
  type ParsedFile,
  presentSections,
  toggleInSet,
} from './shared';

interface ImportSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ImportSheet({ open, onClose }: ImportSheetProps) {
  const toast = useToast();
  const importMut = useImportData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [softWarn, setSoftWarn] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<ExportSection>>(new Set());
  const [strategy, setStrategy] = useState<ImportConflictStrategy>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);

  const present = useMemo<ExportSection[]>(
    () => (parsed ? presentSections(parsed.raw) : []),
    [parsed],
  );

  const reset = () => {
    setParsed(null);
    setParseError(null);
    setSoftWarn(null);
    setSelected(new Set());
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const closeSheet = () => {
    reset();
    setStrategy('skip');
    onClose();
  };

  const onFileSelected = (file: File | undefined) => {
    setParseError(null);
    setSoftWarn(null);
    setResult(null);
    setParsed(null);
    if (!file) return;
    if (file.size > FILE_SOFT_WARN_BYTES) {
      setSoftWarn(
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — large imports may take a moment.`,
      );
    }
    const reader = new FileReader();
    reader.onerror = () => setParseError('Could not read the file.');
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        setParseError('Not a valid JSON file.');
        return;
      }
      const parseResult = exportFileSchema.safeParse(json);
      if (!parseResult.success) {
        setParseError('Unsupported export format.');
        return;
      }
      setParsed({ raw: parseResult.data, fileName: file.name });
      setSelected(new Set(presentSections(parseResult.data)));
    };
    reader.readAsText(file);
  };

  const toggle = (s: ExportSection) => setSelected((prev) => toggleInSet(prev, s));

  const onImport = () => {
    if (!parsed) return;
    const sections = Array.from(selected);
    if (sections.length === 0) return;
    importMut.mutate(
      { sections, conflictStrategy: strategy, data: parsed.raw },
      {
        onSuccess: (r) => {
          setResult(r);
          toast.show('Import complete');
        },
        onError: (err) => toast.error(apiErrorMessage(err, 'Import failed')),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && closeSheet()}
      title="Import"
      footer={
        result ? (
          <Button variant="primary" size="sm" onClick={closeSheet}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={closeSheet}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={14} />}
              loading={importMut.isPending}
              disabled={!parsed || selected.size === 0 || importMut.isPending}
              onClick={onImport}
            >
              {importMut.isPending ? 'Importing…' : 'Import'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <Hint>
          Apply a previously exported JSON file. Pick which sections to import and how to handle
          existing entries.
        </Hint>

        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => onFileSelected(e.target.files?.[0])}
        />

        {!parsed && !parseError && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            className="self-start"
          >
            <Upload size={14} /> Choose file
          </Button>
        )}

        {parseError && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-danger-soft text-danger border border-danger/30 text-[12.5px]"
          >
            <AlertTriangle size={13} strokeWidth={2.2} className="flex-shrink-0 mt-px" />
            <div className="flex-1">{parseError}</div>
            <button
              type="button"
              onClick={reset}
              className="text-danger/80 hover:text-danger"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {parsed && (
          <>
            <FilePreview parsed={parsed} onClear={reset} />
            {softWarn && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning-soft text-warning border border-warning/30 text-[11.5px]">
                <AlertTriangle size={12} strokeWidth={2.2} className="flex-shrink-0 mt-px" />
                <span>{softWarn}</span>
              </div>
            )}

            {!result && (
              <>
                <div className="flex flex-col gap-1.5">
                  {present.map((s) => (
                    <CheckboxCard
                      key={s}
                      label={SECTION_LABELS[s]}
                      description={`${countFor(s, parsed.raw)} item${countFor(s, parsed.raw) === 1 ? '' : 's'}`}
                      checked={selected.has(s)}
                      onToggle={() => toggle(s)}
                    />
                  ))}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Hint>If an entry already exists:</Hint>
                  <div className="flex gap-1.5">
                    <StrategyRadio
                      label="Skip duplicates"
                      checked={strategy === 'skip'}
                      onSelect={() => setStrategy('skip')}
                    />
                    <StrategyRadio
                      label="Replace existing"
                      checked={strategy === 'replace'}
                      onSelect={() => setStrategy('replace')}
                    />
                  </div>
                </div>
              </>
            )}

            {result && <ImportResultBlock result={result} />}
          </>
        )}
      </div>
    </Sheet>
  );
}

interface FilePreviewProps {
  parsed: ParsedFile;
  onClear: () => void;
}

function FilePreview({ parsed, onClear }: FilePreviewProps) {
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border bg-bg">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-accent-soft text-accent border border-accent/30 flex-shrink-0">
        <Check size={14} strokeWidth={2.5} />
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight truncate">{parsed.fileName}</div>
        <div className="text-[11px] text-text-muted">
          v{parsed.raw.schemaVersion} · {new Date(parsed.raw.exportedAt).toLocaleString()} · app{' '}
          {parsed.raw.appVersion}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear file">
        <X size={14} />
      </Button>
    </div>
  );
}

interface ImportResultBlockProps {
  result: ImportResult;
}

function ImportResultBlock({ result }: ImportResultBlockProps) {
  const sections: ExportSection[] = [...EXPORT_SECTIONS];
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const visibleWarnings =
    result.warnings.length > 5 && !showAllWarnings ? result.warnings.slice(0, 5) : result.warnings;
  const hasAnyChange = sections.some((s) => {
    const r = result[s];
    return r.created + r.skipped + r.replaced > 0;
  });
  return (
    <div className="rounded-lg border border-border bg-bg p-3 flex flex-col gap-2.5">
      <div className="text-[11.5px] font-semibold tracking-wide uppercase text-text-faint">
        Result
      </div>
      {hasAnyChange ? (
        <div className="grid gap-1">
          {sections.map((s) => {
            const r = result[s];
            if (r.created + r.skipped + r.replaced === 0) return null;
            return (
              <div key={s} className="text-[12.5px] flex items-center gap-1.5 flex-wrap">
                <span className="font-medium">{SECTION_LABELS[s]}:</span>
                <ResultPill label="created" value={r.created} tone="ok" />
                <ResultPill label="skipped" value={r.skipped} tone="muted" />
                <ResultPill label="replaced" value={r.replaced} tone="accent" />
              </div>
            );
          })}
        </div>
      ) : (
        <Hint>Nothing to import in the selected sections.</Hint>
      )}
      {result.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-semibold tracking-wide uppercase text-warning flex items-center gap-1.5">
            <AlertTriangle size={11} strokeWidth={2.2} /> Warnings ({result.warnings.length})
          </div>
          <ul className="flex flex-col gap-1 text-[11.5px] text-text-muted">
            {visibleWarnings.map((w, i) => (
              <li key={i} className="leading-snug">
                · {w.message}
              </li>
            ))}
          </ul>
          {result.warnings.length > 5 && !showAllWarnings && (
            <button
              type="button"
              className="text-[11px] text-accent self-start"
              onClick={() => setShowAllWarnings(true)}
            >
              Show all {result.warnings.length} warnings
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ResultPillProps {
  label: string;
  value: number;
  tone: 'ok' | 'muted' | 'accent';
}

function ResultPill({ label, value, tone }: ResultPillProps) {
  if (value === 0) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border',
        tone === 'ok' && 'bg-success/10 text-success border-success/30',
        tone === 'muted' && 'bg-bg text-text-muted border-border',
        tone === 'accent' && 'bg-accent-soft text-accent border-accent/30',
      )}
    >
      {value} {label}
    </span>
  );
}

interface StrategyRadioProps {
  label: string;
  checked: boolean;
  onSelect: () => void;
}

function StrategyRadio({ label, checked, onSelect }: StrategyRadioProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors',
        checked
          ? 'bg-accent-soft border-accent text-accent'
          : 'bg-bg border-border text-text-muted hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'w-3 h-3 rounded-full border grid place-items-center flex-shrink-0',
          checked ? 'border-accent bg-accent' : 'border-border-strong',
        )}
      >
        {checked && <span className="w-1 h-1 rounded-full bg-accent-fg" />}
      </span>
      {label}
    </button>
  );
}

function countFor(section: ExportSection, file: ExportFile): number {
  switch (section) {
    case 'destinations':
      return file.destinations?.length ?? 0;
    case 'libraryFilters':
      return file.libraryFilters?.length ?? 0;
    case 'subscriptions':
      return file.subscriptions?.length ?? 0;
    case 'appSettings':
      return file.appSettings ? 1 : 0;
  }
}
