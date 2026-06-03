import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ExportFile,
  ExportRequest,
  ImportRequest,
  ImportResult,
  WipeRequest,
  WipeResult,
} from '@tg-feed/shared';
import { exportData, importData, wipeData } from '@/api/exportImportApi';
import { DESTINATIONS_KEY } from './useDestinations';
import { FILTER_CATALOG_KEY, LIBRARY_FILTERS_KEY } from './useFilters';
import { SETTINGS_KEY } from './useSettings';
import { SUBSCRIPTIONS_KEY } from './useSubscriptions';

export function useExportData() {
  return useMutation<ExportFile, Error, ExportRequest>({
    mutationFn: exportData,
  });
}

export function useImportData() {
  const qc = useQueryClient();
  return useMutation<ImportResult, Error, ImportRequest>({
    mutationFn: importData,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      qc.invalidateQueries({ queryKey: DESTINATIONS_KEY });
      qc.invalidateQueries({ queryKey: LIBRARY_FILTERS_KEY });
      qc.invalidateQueries({ queryKey: FILTER_CATALOG_KEY });
      qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

export function useWipeData() {
  const qc = useQueryClient();
  return useMutation<WipeResult, Error, WipeRequest>({
    mutationFn: wipeData,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      qc.invalidateQueries({ queryKey: DESTINATIONS_KEY });
      qc.invalidateQueries({ queryKey: LIBRARY_FILTERS_KEY });
    },
  });
}
