/**
 * Export sheet — section checkboxes that trigger a JSON file download
 * (Blob + anchor click) of the selected sections. Versioned for forward /
 * backward compatibility via the shared `exportFileSchema`.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { EXPORT_SECTIONS, type ExportSection } from '@tg-feed/shared';
import { Button } from '@/components/ui/button';
import { CheckboxCard } from '@/components/ui/checkbox-card';
import { Hint } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useExportData } from '@/hooks/useExportImport';
import { apiErrorMessage } from '@/api/client';
import { SECTION_HINT, SECTION_LABELS, downloadJson, toggleInSet } from './shared';

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ExportSheet({ open, onClose }: ExportSheetProps) {
  const toast = useToast();
  const exportMut = useExportData();
  const [selected, setSelected] = useState<Set<ExportSection>>(new Set(EXPORT_SECTIONS));

  const toggle = (s: ExportSection) => setSelected((prev) => toggleInSet(prev, s));

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
            icon={<Download size={14} />}
            loading={exportMut.isPending}
            disabled={selected.size === 0 || exportMut.isPending}
            onClick={onExport}
          >
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
            <CheckboxCard
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
