/**
 * System routes.
 *
 * - `GET /system/status`: Surface enough info for the web UI to explain
 *   why some features are unavailable (e.g. Telegram disconnected →
 *   subscribing/forwarding disabled). The status is supplied as a getter
 *   so the health monitor (apps/server/src/tg/healthMonitor.ts) can update
 *   it on each probe and the route always reads the current value.
 *
 * - `POST /system/export`, `POST /system/import`, `POST /system/wipe`:
 *   Settings → Data section. Versioned JSON envelope (`exportFileSchema`)
 *   carries selected sections (subscriptions / destinations / library
 *   filters / app settings) round-trip without ID collisions — IDs are
 *   intentionally omitted and import remaps via natural keys (chatId+name
 *   for destinations, name for library filters, sourceChatId for
 *   subscriptions). Import body limit is bumped to 2 MB on the route
 *   level — large enough for thousands of subscriptions, small enough to
 *   refuse abuse.
 */
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  EXPORT_SCHEMA_VERSION,
  exportRequestSchema,
  importRequestSchema,
  wipeRequestSchema,
  type ExportFile,
  type ExportSection,
  type ExportedAppSettings,
  type ExportedLibraryFilter,
  type ExportedSubscription,
  type ExportedTelegramAccount,
  type ImportConflictStrategy,
  type ImportResult,
  type ImportSectionResult,
  type ImportWarning,
  type SystemStatusResponse,
  type TelegramStatus,
  type WipeResult,
  type WipeSection,
} from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import {
  appSettings,
  destinations,
  libraryFilters,
  subscriptionFilters,
  subscriptionLibraryFilters,
  subscriptions,
  telegramAccount,
  type Destination,
  type LibraryFilter,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { getKeyFingerprint } from '../../lib/sessionCrypto.js';
import {
  GLOBAL_SETTINGS_KEY,
  getAlbumDebounceMs,
  getGlobalDelayMs,
} from '../../forwarding/throttle.js';
import { replaceInlineFilters, replaceLibraryFilterAttachments } from './subscriptions.js';

// Read the app version from the root package.json so exports carry a
// truthful tag. The path goes from this module up four levels:
// apps/server/src/api/routes → apps/server → repo root.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let cachedAppVersion: string | undefined;
function readAppVersion(): string {
  if (cachedAppVersion !== undefined) return cachedAppVersion;
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const rootPkg = path.resolve(moduleDir, '../../../../../package.json');
    const parsed = JSON.parse(readFileSync(rootPkg, 'utf8')) as { version?: unknown };
    cachedAppVersion = typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    cachedAppVersion = 'unknown';
  }
  return cachedAppVersion;
}

const IMPORT_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

export interface RegisterSystemRoutesDeps {
  db: Db;
  getTelegramStatus: () => TelegramStatus;
  /**
   * Returns the loaded `TG_SESSION_ENCRYPTION_KEY` as a 32-byte Buffer, or
   * null when not set. Used by import to decide whether to write the
   * encrypted account blob carried inside `appSettings.telegramAccount`.
   */
  getEncryptionKey?: () => Buffer | null;
  /**
   * Triggers a live-swap of the gramjs runtime so an imported account row
   * activates without a process restart. Optional; when absent, the row is
   * still written but takes effect on next boot.
   */
  reloadTelegramSession?: () => Promise<void>;
}

export function registerSystemRoutes(app: FastifyInstance, deps: RegisterSystemRoutesDeps): void {
  const { db, getTelegramStatus, getEncryptionKey, reloadTelegramSession } = deps;

  app.get('/system/status', async (): Promise<SystemStatusResponse> => {
    return { telegram: getTelegramStatus() };
  });

  app.post(
    '/system/export',
    {
      // Behind cookie auth and SameSite=strict, but cap nonetheless: a stolen
      // cookie or compromised browser extension shouldn't be able to grind
      // out unlimited full-DB dumps. Generous enough that legitimate
      // back-to-back exports work; tight enough that abuse is bounded.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request): Promise<ExportFile> => {
      const body = exportRequestSchema.parse(request.body);
      const sectionSet = new Set<ExportSection>(body.sections);
      return buildExport(db, sectionSet);
    },
  );

  app.post(
    '/system/import',
    { bodyLimit: IMPORT_BODY_LIMIT_BYTES },
    async (request): Promise<ImportResult> => {
      const body = importRequestSchema.parse(request.body);
      if (body.data.schemaVersion > EXPORT_SCHEMA_VERSION) {
        throw new AppError(
          400,
          'export_schema_too_new',
          `unsupported export schemaVersion ${body.data.schemaVersion}`,
        );
      }
      // v1 files lack `appSettings.telegramAccount`; v2 importers handle
      // both transparently because the field is `.optional()`.
      const sectionSet = new Set<ExportSection>(body.sections);
      const result = applyImport(db, body.data, sectionSet, body.conflictStrategy, {
        ...(getEncryptionKey !== undefined ? { getEncryptionKey } : {}),
      });
      // If a telegram account was actually written, kick the live-swap so
      // the running app picks it up without a restart. Failures are
      // swallowed — the row is saved either way.
      if (result.telegramAccountWritten && reloadTelegramSession) {
        await reloadTelegramSession().catch(() => {});
      }
      return result.body;
    },
  );

  app.post(
    '/system/wipe',
    {
      // Destructive — cap aggressively. A leaked cookie or stored-XSS
      // shouldn't be able to nuke the DB in a tight loop. Three calls per
      // minute is still plenty for a legitimate "clear & re-import" flow.
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (request): Promise<WipeResult> => {
      const body = wipeRequestSchema.parse(request.body);
      const sectionSet = new Set<WipeSection>(body.sections);
      return applyWipe(db, sectionSet);
    },
  );
}

// --- Export ----------------------------------------------------------------

function buildExport(db: Db, sections: Set<ExportSection>): ExportFile {
  const envelope: ExportFile = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: readAppVersion(),
  };

  if (sections.has('destinations')) {
    envelope.destinations = db
      .select({
        name: destinations.name,
        chatId: destinations.chatId,
        note: destinations.note,
      })
      .from(destinations)
      .all()
      .map((row) => ({
        name: row.name,
        chatId: row.chatId,
        note: row.note,
      }));
  }

  if (sections.has('libraryFilters')) {
    envelope.libraryFilters = db
      .select({
        name: libraryFilters.name,
        ruleType: libraryFilters.ruleType,
        params: libraryFilters.params,
        mode: libraryFilters.mode,
      })
      .from(libraryFilters)
      .all()
      .map(
        (row) =>
          ({
            name: row.name,
            ruleType: row.ruleType,
            params: row.params,
            mode: row.mode,
          }) as ExportedLibraryFilter,
      );
  }

  if (sections.has('subscriptions')) {
    const subRows = db
      .select({
        id: subscriptions.id,
        sourceChatId: subscriptions.sourceChatId,
        sourceTitle: subscriptions.sourceTitle,
        handle: subscriptions.handle,
        enabled: subscriptions.enabled,
        destinationId: subscriptions.destinationId,
        destinationName: destinations.name,
        destinationChatId: destinations.chatId,
      })
      .from(subscriptions)
      .leftJoin(destinations, eq(subscriptions.destinationId, destinations.id))
      .all();

    const ids = subRows.map((r) => r.id);
    const inlineRows = ids.length
      ? db
          .select({
            subscriptionId: subscriptionFilters.subscriptionId,
            ruleType: subscriptionFilters.ruleType,
            params: subscriptionFilters.params,
            enabled: subscriptionFilters.enabled,
            mode: subscriptionFilters.mode,
          })
          .from(subscriptionFilters)
          .where(inArray(subscriptionFilters.subscriptionId, ids))
          .all()
      : [];
    const inlineBySub = new Map<number, typeof inlineRows>();
    for (const r of inlineRows) {
      const list = inlineBySub.get(r.subscriptionId) ?? [];
      list.push(r);
      inlineBySub.set(r.subscriptionId, list);
    }

    const libAttachRows = ids.length
      ? db
          .select({
            subscriptionId: subscriptionLibraryFilters.subscriptionId,
            name: libraryFilters.name,
          })
          .from(subscriptionLibraryFilters)
          .innerJoin(
            libraryFilters,
            eq(subscriptionLibraryFilters.libraryFilterId, libraryFilters.id),
          )
          .where(inArray(subscriptionLibraryFilters.subscriptionId, ids))
          .all()
      : [];
    const libsBySub = new Map<number, string[]>();
    for (const r of libAttachRows) {
      const list = libsBySub.get(r.subscriptionId) ?? [];
      list.push(r.name);
      libsBySub.set(r.subscriptionId, list);
    }

    envelope.subscriptions = subRows.map((sub) => {
      const out: ExportedSubscription = {
        sourceChatId: sub.sourceChatId,
        sourceTitle: sub.sourceTitle,
        handle: sub.handle,
        enabled: sub.enabled,
        destination:
          sub.destinationChatId && sub.destinationName
            ? { chatId: sub.destinationChatId, name: sub.destinationName }
            : null,
        inlineFilters: (inlineBySub.get(sub.id) ?? []).map(
          (f) =>
            ({
              ruleType: f.ruleType,
              params: f.params,
              enabled: f.enabled,
              mode: f.mode,
            }) as ExportedSubscription['inlineFilters'][number],
        ),
        libraryFilters: (libsBySub.get(sub.id) ?? []).map((name) => ({ name })),
      };
      return out;
    });
  }

  if (sections.has('appSettings')) {
    const settings: ExportedAppSettings = {
      delayMs: getGlobalDelayMs(db),
      albumDebounceMs: getAlbumDebounceMs(db),
    };
    // v2: include the encrypted Telegram account row when present. The
    // ciphertext + fingerprint travel as-is — the importing host decides
    // (via fingerprint match) whether to write the row to its own DB.
    const accountRow = db.select().from(telegramAccount).get();
    if (accountRow) {
      settings.telegramAccount = {
        encryptedSessionString: accountRow.encryptedSessionString,
        keyFingerprint: accountRow.keyFingerprint,
        phoneNumber: accountRow.phoneNumber,
        displayName: accountRow.displayName,
        username: accountRow.username,
        telegramUserId: accountRow.telegramUserId,
      };
    }
    envelope.appSettings = settings;
  }

  return envelope;
}

// --- Import ----------------------------------------------------------------

function destKey(chatId: string, name: string): string {
  return `${chatId} ${name}`;
}

const emptySectionResult = (): ImportSectionResult => ({ created: 0, skipped: 0, replaced: 0 });

interface ApplyImportResult {
  body: ImportResult;
  /** True when a `telegram_account` row was created or replaced. */
  telegramAccountWritten: boolean;
}

function applyImport(
  db: Db,
  data: ExportFile,
  sections: Set<ExportSection>,
  strategy: ImportConflictStrategy,
  opts: { getEncryptionKey?: () => Buffer | null } = {},
): ApplyImportResult {
  const result: ImportResult = {
    destinations: emptySectionResult(),
    libraryFilters: emptySectionResult(),
    subscriptions: emptySectionResult(),
    appSettings: emptySectionResult(),
    warnings: [],
  };
  let telegramAccountWritten = false;

  db.transaction((tx) => {
    // Build initial maps from existing rows so subscriptions can resolve
    // refs even when the user opted out of importing destinations / library
    // filters in this run (and the records already exist).
    const destMap = new Map<string, number>();
    for (const d of tx.select().from(destinations).all() as Destination[]) {
      destMap.set(destKey(d.chatId, d.name), d.id);
    }
    const libMap = new Map<string, number>();
    for (const l of tx.select().from(libraryFilters).all() as LibraryFilter[]) {
      libMap.set(l.name, l.id);
    }

    if (sections.has('destinations') && data.destinations) {
      for (const item of data.destinations) {
        const key = destKey(item.chatId, item.name);
        const existingId = destMap.get(key);
        if (existingId !== undefined) {
          if (strategy === 'replace') {
            tx.update(destinations)
              .set({ note: item.note ?? null })
              .where(eq(destinations.id, existingId))
              .run();
            result.destinations.replaced += 1;
          } else {
            result.destinations.skipped += 1;
          }
          continue;
        }
        const inserted = tx
          .insert(destinations)
          .values({
            name: item.name,
            chatId: item.chatId,
            note: item.note ?? null,
          })
          .returning({ id: destinations.id })
          .all();
        const newId = inserted[0]!.id;
        destMap.set(key, newId);
        result.destinations.created += 1;
      }
    }

    if (sections.has('libraryFilters') && data.libraryFilters) {
      for (const item of data.libraryFilters) {
        const existingId = libMap.get(item.name);
        if (existingId !== undefined) {
          // ruleType is immutable post-create; if it changed, surface a
          // warning and skip this row regardless of strategy.
          const existingRow = tx
            .select()
            .from(libraryFilters)
            .where(eq(libraryFilters.id, existingId))
            .get();
          if (existingRow && existingRow.ruleType !== item.ruleType) {
            result.warnings.push({
              kind: 'rule_type_mismatch',
              message: `library filter "${item.name}" already exists with ruleType ${existingRow.ruleType}; cannot import ${item.ruleType}`,
            });
            result.libraryFilters.skipped += 1;
            continue;
          }
          if (strategy === 'replace') {
            tx.update(libraryFilters)
              .set({ params: item.params, mode: item.mode })
              .where(eq(libraryFilters.id, existingId))
              .run();
            result.libraryFilters.replaced += 1;
          } else {
            result.libraryFilters.skipped += 1;
          }
          continue;
        }
        const inserted = tx
          .insert(libraryFilters)
          .values({
            name: item.name,
            ruleType: item.ruleType,
            params: item.params,
            mode: item.mode,
          })
          .returning({ id: libraryFilters.id })
          .all();
        const newId = inserted[0]!.id;
        libMap.set(item.name, newId);
        result.libraryFilters.created += 1;
      }
    }

    if (sections.has('subscriptions') && data.subscriptions) {
      for (const item of data.subscriptions) {
        const resolvedDestId = resolveDestinationId(item, destMap, result.warnings);

        const existing = tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.sourceChatId, item.sourceChatId))
          .get();

        if (existing) {
          if (strategy === 'skip') {
            result.subscriptions.skipped += 1;
            continue;
          }
          // Replace: overwrite mutable fields + bulk-replace filter sets via
          // the existing helpers (same code path as PATCH /subscriptions/:id).
          tx.update(subscriptions)
            .set({
              sourceTitle: item.sourceTitle,
              destinationId: resolvedDestId,
              enabled: item.enabled,
            })
            .where(eq(subscriptions.id, existing.id))
            .run();
          replaceInlineFilters(tx, existing.id, importableInlineFilters(item, result.warnings));
          replaceLibraryFilterAttachments(
            tx,
            existing.id,
            resolveLibraryFilterIds(item, libMap, result.warnings),
          );
          result.subscriptions.replaced += 1;
          continue;
        }

        const inserted = tx
          .insert(subscriptions)
          .values({
            sourceChatId: item.sourceChatId,
            sourceTitle: item.sourceTitle,
            handle: item.handle ?? null,
            destinationId: resolvedDestId,
            enabled: item.enabled,
          })
          .returning({ id: subscriptions.id })
          .all();
        const newId = inserted[0]!.id;
        replaceInlineFilters(tx, newId, importableInlineFilters(item, result.warnings));
        replaceLibraryFilterAttachments(
          tx,
          newId,
          resolveLibraryFilterIds(item, libMap, result.warnings),
        );
        result.subscriptions.created += 1;
      }
    }

    if (sections.has('appSettings') && data.appSettings) {
      // The throttle/debouncer fields go into `app_settings`. The optional
      // `telegramAccount` sub-object is split off and routed to its own
      // table (`telegram_account`) — the wire format embeds it under
      // `appSettings` so the user can manage both with one checkbox in the
      // UI, but at rest they live separately.
      const { telegramAccount: importedAccount, ...appSettingsValue } = data.appSettings;
      const existing = tx
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, GLOBAL_SETTINGS_KEY))
        .get();
      if (existing && strategy === 'skip') {
        result.appSettings.skipped += 1;
      } else {
        tx.insert(appSettings)
          .values({ key: GLOBAL_SETTINGS_KEY, value: appSettingsValue })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: appSettingsValue },
          })
          .run();
        if (existing) {
          result.appSettings.replaced += 1;
        } else {
          result.appSettings.created += 1;
        }
      }
      if (importedAccount) {
        const wrote = importTelegramAccount(
          tx,
          importedAccount,
          strategy,
          result,
          opts.getEncryptionKey,
        );
        if (wrote) telegramAccountWritten = true;
      }
    }
  });

  return { body: result, telegramAccountWritten };
}

/**
 * Returns true when the row was actually upserted (caller triggers
 * live-swap). Returns false when the row was skipped (no key, fingerprint
 * mismatch, or strategy=skip with an existing row); the warning array is
 * mutated in place either way.
 */
type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

function importTelegramAccount(
  tx: DbOrTx,
  account: ExportedTelegramAccount,
  strategy: ImportConflictStrategy,
  result: ImportResult,
  getEncryptionKey?: () => Buffer | null,
): boolean {
  const key = getEncryptionKey?.() ?? null;
  if (!key) {
    result.warnings.push({
      kind: 'telegram_account_no_key',
      message: 'imported account skipped: TG_SESSION_ENCRYPTION_KEY is not configured on this host',
    });
    return false;
  }
  if (getKeyFingerprint(key) !== account.keyFingerprint) {
    result.warnings.push({
      kind: 'telegram_account_key_mismatch',
      message:
        'imported account skipped: encrypted with a different TG_SESSION_ENCRYPTION_KEY (fingerprint mismatch)',
    });
    return false;
  }
  const existing = tx.select().from(telegramAccount).get();
  if (existing && strategy === 'skip') {
    return false;
  }
  const now = new Date();
  tx.insert(telegramAccount)
    .values({
      id: 1,
      encryptedSessionString: account.encryptedSessionString,
      keyFingerprint: account.keyFingerprint,
      phoneNumber: account.phoneNumber,
      displayName: account.displayName,
      username: account.username,
      telegramUserId: account.telegramUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: telegramAccount.id,
      set: {
        encryptedSessionString: account.encryptedSessionString,
        keyFingerprint: account.keyFingerprint,
        phoneNumber: account.phoneNumber,
        displayName: account.displayName,
        username: account.username,
        telegramUserId: account.telegramUserId,
        updatedAt: now,
      },
    })
    .run();
  return true;
}

function resolveDestinationId(
  item: ExportedSubscription,
  destMap: Map<string, number>,
  warnings: ImportWarning[],
): number | null {
  if (!item.destination) return null;
  const key = destKey(item.destination.chatId, item.destination.name);
  const id = destMap.get(key);
  if (id !== undefined) return id;
  warnings.push({
    kind: 'destination_missing',
    message: `subscription "${item.sourceTitle}": destination "${item.destination.name}" (${item.destination.chatId}) not found, left unattached`,
  });
  return null;
}

function resolveLibraryFilterIds(
  item: ExportedSubscription,
  libMap: Map<string, number>,
  warnings: ImportWarning[],
): number[] {
  const ids: number[] = [];
  for (const ref of item.libraryFilters) {
    const id = libMap.get(ref.name);
    if (id === undefined) {
      warnings.push({
        kind: 'library_filter_missing',
        message: `subscription "${item.sourceTitle}": library filter "${ref.name}" not found, not attached`,
      });
      continue;
    }
    ids.push(id);
  }
  return ids;
}

// The exported subscription's inline filters are already validated by the
// `exportFileSchema`'s discriminated union — every entry carries valid
// per-rule params. Pass them through, but keep the warning hook so a future
// schema bump or hand-edited file with stray entries gets a clear surface
// rather than a silent throw.
function importableInlineFilters(
  item: ExportedSubscription,
  _warnings: ImportWarning[],
): ExportedSubscription['inlineFilters'] {
  return item.inlineFilters;
}

// --- Wipe ------------------------------------------------------------------

function applyWipe(db: Db, sections: Set<WipeSection>): WipeResult {
  const deleted = { destinations: 0, libraryFilters: 0, subscriptions: 0 };

  db.transaction((tx) => {
    if (sections.has('subscriptions')) {
      const result = tx.delete(subscriptions).run();
      deleted.subscriptions = result.changes;
    }
    if (sections.has('libraryFilters')) {
      // Pre-detach to avoid the FK RESTRICT on `subscription_library_filters
      // → library_filters` when subscriptions weren't selected for wipe.
      tx.delete(subscriptionLibraryFilters).run();
      const result = tx.delete(libraryFilters).run();
      deleted.libraryFilters = result.changes;
    }
    if (sections.has('destinations')) {
      // FK is ON DELETE SET NULL on `subscriptions.destination_id`, so
      // subscriptions survive — just lose their destination. Order matters
      // only relative to subscriptions wipe (already done above if selected).
      const result = tx.delete(destinations).run();
      deleted.destinations = result.changes;
    }
  });

  return { deleted };
}
