/**
 * Settings → Data section.
 *
 * Two cards:
 *   1. Import / Export — two buttons that open the `ExportSheet` / `ImportSheet`
 *      flows.
 *   2. Danger zone — a single button that opens the `WipeSheet` flow.
 *
 * Each flow lives in its own file under `./data/`; this entry just renders the
 * cards and mounts the sheets. The whole feature is offline-safe — no Telegram
 * dependencies. Imports never call joinChannel; the access monitor's sweep
 * refreshes status afterwards.
 */
import { useState } from 'react';
import { AlertTriangle, Database, Download, Trash, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardFooter, CardHeader, SettingsCard } from './primitives';
import { ExportSheet } from './data/ExportSheet';
import { ImportSheet } from './data/ImportSheet';
import { WipeSheet } from './data/WipeSheet';

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
