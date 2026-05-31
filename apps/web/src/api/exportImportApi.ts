import {
  exportFileSchema,
  importResultSchema,
  wipeResultSchema,
  type ExportFile,
  type ExportRequest,
  type ImportRequest,
  type ImportResult,
  type WipeRequest,
  type WipeResult,
} from '@tg-feed/shared';
import { apiFetch } from './client';

export async function exportData(body: ExportRequest): Promise<ExportFile> {
  const res = await apiFetch<unknown, ExportRequest>('/api/system/export', {
    method: 'POST',
    body,
  });
  return exportFileSchema.parse(res);
}

export async function importData(body: ImportRequest): Promise<ImportResult> {
  const res = await apiFetch<unknown, ImportRequest>('/api/system/import', {
    method: 'POST',
    body,
  });
  return importResultSchema.parse(res);
}

export async function wipeData(body: WipeRequest): Promise<WipeResult> {
  const res = await apiFetch<unknown, WipeRequest>('/api/system/wipe', {
    method: 'POST',
    body,
  });
  return wipeResultSchema.parse(res);
}
