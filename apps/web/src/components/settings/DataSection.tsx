/**
 * Settings → Data section.
 *
 * Two cards:
 *   1. Import / Export — two buttons that open Sheets. The Export sheet has
 *      section checkboxes and triggers a JSON file download (Blob + anchor
 *      click). The Import sheet has a file picker that validates against
 *      the shared `exportFileSchema`, shows a preview, lets the user pick
 *      sections + conflict strategy (skip / replace), then POSTs to
 *      /api/system/import.
 *   2. Danger zone — single button opens a Sheet with checkboxes per
 *      wipeable section, gates on a typed-in confirmation, then POSTs to
 *      /api/system/wipe.
 *
 * The whole flow is offline-safe — no Telegram dependencies. Imports never
 * call joinChannel; the access monitor's sweep refreshes status afterwards.
 */
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Database, Download, Trash, Upload, X } from 'lucide-react';
import {
  EXPORT_SECTIONS,
  WIPE_SECTIONS,
  exportFileSchema,
  type ExportFile,
  type ExportSection,
  type ImportConflictStrategy,
  type ImportResult,
  type WipeSection,
} from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { CardFooter, CardHeader, SettingsCard } from './primitives';
import { useDestinations } from '@/hooks/useDestinations';
import { useExportData, useImportData, useWipeData } from '@/hooks/useExportImport';
import { useLibraryFilters } from '@/hooks/useFilters';
import { useSubscriptions } from '@/hooks/useSubscriptions';
import { apiErrorMessage } from '@/api/client';

const SECTION_LABELS: Record<ExportSection, string> = {
  subscriptions: 'Subscriptions',
  destinations: 'Destinations',
  libraryFilters: 'Library filters',
  appSettings: 'App settings',
};

const SECTION_HINT: Record<ExportSection, string> = {
  subscriptions: 'Includes inline filters for each subscription.',
  destinations: 'Forwarding targets.',
  libraryFilters: 'Reusable named filters.',
  appSettings:
    'Forward delay, album debounce, and (if signed in) the encrypted Telegram account. The account only re-imports on a host with the same TG_SESSION_ENCRYPTION_KEY.',
};

const FILE_SOFT_WARN_BYTES = 1 * 1024 * 1024;
const WIPE_CONFIRM_PHRASE = 'delete';

export function DataSection() {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <SettingsCard>
        <CardHeader icon={<Database size={14} />} title="Import / Export" />
        <div className="p-4">
          <p className="text-[12px] text-text-muted leading-relaxed">
            Back up or transfer your configuration as a versioned JSON file.
          </p>
        </div>
        <CardFooter>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Import…
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)}>
            <Download size={14} /> Export…
          </Button>
        </CardFooter>
      </SettingsCard>

      <SettingsCard className="border-danger/30">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-danger/20 bg-danger-soft/40">
          <span className="grid place-items-center w-[26px] h-[26px] rounded-[7px] bg-danger-soft text-danger border border-danger/30 flex-shrink-0">
            <AlertTriangle size={14} />
          </span>
          <span className="text-[14px] font-semibold tracking-tight text-danger">Danger zone</span>
        </div>
        <div className="p-4">
          <p className="text-[12px] text-text-muted leading-relaxed">
            Bulk-delete subscriptions, destinations, or library filters. Cannot be undone.
          </p>
        </div>
        <CardFooter>
          <Button variant="danger" size="sm" onClick={() => setWipeOpen(true)}>
            <Trash size={14} /> Delete data…
          </Button>
        </CardFooter>
      </SettingsCard>

      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} />
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      <WipeSheet open={wipeOpen} onClose={() => setWipeOpen(false)} />
    </div>
  );
}

// --- Export sheet ----------------------------------------------------------

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
}

function ExportSheet({ open, onClose }: ExportSheetProps) {
  const toast = useToast();
  const exportMut = useExportData();
  const [selected, setSelected] = useState<Set<ExportSection>>(new Set(EXPORT_SECTIONS));

  const toggle = (s: ExportSection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const onExport = () => {
    const sections = Array.from(selected);
    if (sections.length === 0) return;
    exportMut.mutate(
      { sections },
      {
        onSuccess: (file) => {
          downloadJson(file);
          toast.show('Export downloaded');
          onClose();
        },
        onError: (err) => toast.error(apiErrorMessage(err, 'Export failed')),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Export"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={selected.size === 0 || exportMut.isPending}
            onClick={onExport}
          >
            {exportMut.isPending ? <Spinner size={14} /> : <Download size={14} />}
            {exportMut.isPending ? 'Exporting…' : 'Export'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Hint>
          Download a JSON snapshot of the selected sections. Versioned for forward / backward
          compatibility.
        </Hint>
        <div className="flex flex-col gap-1.5">
          {EXPORT_SECTIONS.map((s) => (
            <SectionCheckbox
              key={s}
              label={SECTION_LABELS[s]}
              description={SECTION_HINT[s]}
              checked={selected.has(s)}
              onToggle={() => toggle(s)}
            />
          ))}
        </div>
      </div>
    </Sheet>
  );
}

// --- Import sheet ----------------------------------------------------------

interface ParsedFile {
  raw: ExportFile;
  fileName: string;
  fileSize: number;
}

interface ImportSheetProps {
  open: boolean;
  onClose: () => void;
}

function ImportSheet({ open, onClose }: ImportSheetProps) {
  const toast = useToast();
  const importMut = useImportData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [softWarn, setSoftWarn] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<ExportSection>>(new Set());
  const [strategy, setStrategy] = useState<ImportConflictStrategy>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);

  const presentSections = useMemo<ExportSection[]>(() => {
    if (!parsed) return [];
    const list: ExportSection[] = [];
    if (parsed.raw.destinations) list.push('destinations');
    if (parsed.raw.libraryFilters) list.push('libraryFilters');
    if (parsed.raw.subscriptions) list.push('subscriptions');
    if (parsed.raw.appSettings) list.push('appSettings');
    return list;
  }, [parsed]);

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
      const allPresent = new Set<ExportSection>();
      if (parseResult.data.destinations) allPresent.add('destinations');
      if (parseResult.data.libraryFilters) allPresent.add('libraryFilters');
      if (parseResult.data.subscriptions) allPresent.add('subscriptions');
      if (parseResult.data.appSettings) allPresent.add('appSettings');
      setParsed({ raw: parseResult.data, fileName: file.name, fileSize: file.size });
      setSelected(allPresent);
    };
    reader.readAsText(file);
  };

  const toggle = (s: ExportSection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

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
              disabled={!parsed || selected.size === 0 || importMut.isPending}
              onClick={onImport}
            >
              {importMut.isPending ? <Spinner size={14} /> : <Upload size={14} />}
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
                  {presentSections.map((s) => (
                    <SectionCheckbox
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
  const sections: ExportSection[] = [
    'destinations',
    'libraryFilters',
    'subscriptions',
    'appSettings',
  ];
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

// --- Wipe sheet ------------------------------------------------------------

const WIPE_LABELS: Record<WipeSection, string> = {
  subscriptions: 'Subscriptions',
  destinations: 'Destinations',
  libraryFilters: 'Library filters',
};

const WIPE_SIDE_EFFECTS: Record<WipeSection, string> = {
  subscriptions: 'Inline filters and library-filter attachments are dropped too.',
  destinations: 'Subscriptions referencing them will be detached and stop forwarding.',
  libraryFilters: 'Subscriptions using them as filters will simply lose those filters.',
};

interface WipeSheetProps {
  open: boolean;
  onClose: () => void;
}

function WipeSheet({ open, onClose }: WipeSheetProps) {
  const toast = useToast();
  const wipeMut = useWipeData();
  const subs = useSubscriptions();
  const dests = useDestinations();
  const lib = useLibraryFilters();
  const [selected, setSelected] = useState<Set<WipeSection>>(new Set());
  const [confirmText, setConfirmText] = useState('');

  const counts: Record<WipeSection, number> = {
    subscriptions: subs.data?.length ?? 0,
    destinations: dests.data?.length ?? 0,
    libraryFilters: lib.data?.length ?? 0,
  };

  const totalSelected = Array.from(selected).reduce((acc, s) => acc + counts[s], 0);
  const phraseOk = confirmText.trim().toLowerCase() === WIPE_CONFIRM_PHRASE;

  const reset = () => {
    setSelected(new Set());
    setConfirmText('');
  };

  const closeSheet = () => {
    reset();
    onClose();
  };

  const toggle = (s: WipeSection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const onConfirm = () => {
    const sections = Array.from(selected);
    if (sections.length === 0 || !phraseOk) return;
    wipeMut.mutate(
      { sections },
      {
        onSuccess: (r) => {
          const total = sections.reduce((acc, s) => acc + r.deleted[s], 0);
          toast.show(`Deleted ${total} item${total === 1 ? '' : 's'}`);
          closeSheet();
        },
        onError: (err) => toast.error(apiErrorMessage(err, 'Delete failed')),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && closeSheet()}
      title="Delete data"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={closeSheet}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={selected.size === 0 || !phraseOk || wipeMut.isPending}
            onClick={onConfirm}
          >
            {wipeMut.isPending ? <Spinner size={14} /> : <Trash size={14} />}
            {wipeMut.isPending
              ? 'Deleting…'
              : totalSelected > 0
                ? `Delete ${totalSelected} item${totalSelected === 1 ? '' : 's'}`
                : 'Delete'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Hint>
          Pick what to delete. Cannot be undone — export first if you might want this back.
        </Hint>

        <div className="flex flex-col gap-1.5">
          {WIPE_SECTIONS.map((s) => (
            <WipeCheckbox
              key={s}
              label={WIPE_LABELS[s]}
              count={counts[s]}
              description={WIPE_SIDE_EFFECTS[s]}
              checked={selected.has(s)}
              disabled={counts[s] === 0}
              onToggle={() => toggle(s)}
            />
          ))}
        </div>

        {selected.size > 0 && (
          <div className="flex flex-col gap-1.5 mt-1">
            <Hint>
              Type <strong className="text-danger font-mono">{WIPE_CONFIRM_PHRASE}</strong> to
              confirm:
            </Hint>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={WIPE_CONFIRM_PHRASE}
              className={cn(
                'h-[36px] px-3 rounded-lg border bg-bg text-[13px] font-mono outline-none transition-colors',
                phraseOk ? 'border-danger/40 text-danger' : 'border-border focus:border-danger/40',
              )}
            />
          </div>
        )}
      </div>
    </Sheet>
  );
}

// --- Shared subcomponents --------------------------------------------------

interface SectionCheckboxProps {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}

function SectionCheckbox({ label, description, checked, onToggle }: SectionCheckboxProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
        checked
          ? 'bg-accent-soft border border-accent'
          : 'bg-bg border border-border hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'w-4 h-4 rounded grid place-items-center border-[1.5px] flex-shrink-0',
          checked ? 'border-accent bg-accent' : 'border-border-strong',
        )}
      >
        {checked && <Check size={11} strokeWidth={3} className="text-accent-fg" />}
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight">{label}</div>
        <div className="text-[11px] text-text-muted">{description}</div>
      </div>
    </button>
  );
}

interface WipeCheckboxProps {
  label: string;
  count: number;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}

function WipeCheckbox({
  label,
  count,
  description,
  checked,
  disabled,
  onToggle,
}: WipeCheckboxProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
        disabled
          ? 'bg-bg border border-border opacity-50 cursor-not-allowed'
          : checked
            ? 'bg-danger-soft border border-danger/40'
            : 'bg-bg border border-border hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'w-4 h-4 rounded grid place-items-center border-[1.5px] flex-shrink-0',
          checked ? 'border-danger bg-danger' : 'border-border-strong',
        )}
      >
        {checked && <Check size={11} strokeWidth={3} className="text-white" />}
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight">
          {label} <span className="text-text-faint font-normal">({count})</span>
        </div>
        <div className="text-[11px] text-text-muted leading-snug">{description}</div>
      </div>
    </button>
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

// --- Helpers ---------------------------------------------------------------

function downloadJson(file: ExportFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tg-feed-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
