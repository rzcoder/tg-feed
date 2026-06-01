/**
 * Shared constants, types, and helpers for the Settings → Data sheets
 * (export / import / wipe). Kept in one module so the section labels and the
 * "which sections does this file carry" logic stay in a single place instead
 * of being re-derived in each sheet.
 */
import { EXPORT_SECTIONS, type ExportFile, type ExportSection } from '@tg-feed/shared';

export const SECTION_LABELS: Record<ExportSection, string> = {
  subscriptions: 'Subscriptions',
  destinations: 'Destinations',
  libraryFilters: 'Library filters',
  appSettings: 'App settings',
};

export const SECTION_HINT: Record<ExportSection, string> = {
  subscriptions: 'Includes inline filters for each subscription.',
  destinations: 'Forwarding targets.',
  libraryFilters: 'Reusable named filters.',
  appSettings:
    'Forward delay, album debounce, and (if signed in) the encrypted Telegram account. The account only re-imports on a host with the same TG_SESSION_ENCRYPTION_KEY.',
};

export const FILE_SOFT_WARN_BYTES = 1024 * 1024;
export const WIPE_CONFIRM_PHRASE = 'delete';

export interface ParsedFile {
  raw: ExportFile;
  fileName: string;
}

/**
 * Sections actually carried by an export file, in the canonical
 * `EXPORT_SECTIONS` order so checkbox lists and result rows render
 * consistently regardless of the file's key order.
 */
export function presentSections(file: ExportFile): ExportSection[] {
  return EXPORT_SECTIONS.filter((s) => file[s] != null);
}

/** Return a new Set with `value` toggled in/out — for checkbox selection state. */
export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function downloadJson(file: ExportFile): void {
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
