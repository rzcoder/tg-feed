// Import remaps by natural key (destinations: chatId+name; library filters: name; subscriptions: sourceChatId).
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
  type ExportedBotConfig,
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
import type { EventBus } from '../../events/bus.js';
import type { Logger } from '../../lib/logger.js';
import type { ProfilePhotoFetcher } from '../../tg/profilePhoto.js';
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
import { BOT_SETTINGS_KEY, readBotConfigRaw } from '../../db/botConfigRepo.js';
import {
  GLOBAL_SETTINGS_KEY,
  getAlbumDebounceMs,
  getGlobalDelayMs,
} from '../../forwarding/throttle.js';
import { getStatsDigestConfig } from '../../forwarding/statsDigestConfig.js';
import { replaceInlineFilters, replaceLibraryFilterAttachments } from './subscriptions.js';

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
  bus: EventBus;
  logger: Logger;
  getTelegramStatus: () => TelegramStatus;
  // null gates writing the imported account blob.
  getEncryptionKey?: () => Buffer | null;
  // Live-swaps gramjs so an imported account activates without restart.
  reloadTelegramSession?: () => Promise<void>;
  // Live-swaps the bot so an imported token/admins activate without restart.
  reloadBot?: () => Promise<void>;
  getFetchProfilePhoto?: () => ProfilePhotoFetcher | undefined;
}

export function registerSystemRoutes(app: FastifyInstance, deps: RegisterSystemRoutesDeps): void {
  const {
    db,
    bus,
    logger,
    getTelegramStatus,
    getEncryptionKey,
    reloadTelegramSession,
    reloadBot,
    getFetchProfilePhoto,
  } = deps;

  app.get('/system/status', async (): Promise<SystemStatusResponse> => {
    return { telegram: getTelegramStatus() };
  });

  app.post(
    '/system/export',
    {
      // Cap full-DB dumps against a stolen cookie.
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
      const sectionSet = new Set<ExportSection>(body.sections);
      const result = applyImport(db, body.data, sectionSet, body.conflictStrategy, {
        ...(getEncryptionKey !== undefined ? { getEncryptionKey } : {}),
      });
      // Failures swallowed: the row is saved either way.
      if (result.telegramAccountWritten && reloadTelegramSession) {
        await reloadTelegramSession().catch(() => {});
      }
      if (result.botConfigWritten && reloadBot) {
        await reloadBot().catch(() => {});
      }
      // Fire-and-forget so a big import doesn't block on sequential TG downloads.
      const fetchProfilePhoto = getFetchProfilePhoto?.();
      if (fetchProfilePhoto && result.iconTargets.length > 0) {
        void backfillImportedIcons({
          db,
          bus,
          fetchProfilePhoto,
          targets: result.iconTargets,
          logger,
        }).catch((err) => {
          logger.error({ err }, 'import icon backfill failed');
        });
      }
      return result.body;
    },
  );

  app.post(
    '/system/wipe',
    {
      // Destructive — cap aggressively against a leaked cookie.
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
        topicId: destinations.topicId,
        topicTitle: destinations.topicTitle,
      })
      .from(destinations)
      .all()
      .map((row) => ({
        name: row.name,
        chatId: row.chatId,
        note: row.note,
        topicId: row.topicId,
        topicTitle: row.topicTitle,
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
    const digest = getStatsDigestConfig(db);
    const settings: ExportedAppSettings = {
      delayMs: getGlobalDelayMs(db),
      albumDebounceMs: getAlbumDebounceMs(db),
      statsDigestEnabled: digest.enabled,
      statsDigestFrequency: digest.frequency,
      statsDigestDayOfWeek: digest.dayOfWeek,
      statsDigestTime: digest.time,
      statsDigestTimezone: digest.timezone,
    };
    // Ciphertext + fingerprint travel as-is; importing host decides via fingerprint match.
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
    // Bot token rides as its encrypted envelope (fingerprint-gated on import); admins/publicUrl are plain.
    const bot = readBotConfigRaw(db);
    if (bot.token || bot.admins !== undefined || bot.publicUrl !== undefined) {
      settings.bot = bot;
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

export interface IconBackfillTarget {
  kind: 'subscription' | 'destination';
  id: number;
  chatId: string;
}

interface ApplyImportResult {
  body: ImportResult;
  telegramAccountWritten: boolean;
  botConfigWritten: boolean;
  iconTargets: IconBackfillTarget[];
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
  let botConfigWritten = false;
  const touchedDestIds: number[] = [];
  const touchedSubIds: number[] = [];

  db.transaction((tx) => {
    // Seed from existing rows so subscriptions resolve refs even when those sections weren't imported.
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
              .set({
                note: item.note ?? null,
                topicId: item.topicId ?? null,
                topicTitle: item.topicTitle ?? null,
              })
              .where(eq(destinations.id, existingId))
              .run();
            touchedDestIds.push(existingId);
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
            topicId: item.topicId ?? null,
            topicTitle: item.topicTitle ?? null,
          })
          .returning({ id: destinations.id })
          .all();
        const newId = inserted[0]!.id;
        destMap.set(key, newId);
        touchedDestIds.push(newId);
        result.destinations.created += 1;
      }
    }

    if (sections.has('libraryFilters') && data.libraryFilters) {
      for (const item of data.libraryFilters) {
        const existingId = libMap.get(item.name);
        if (existingId !== undefined) {
          // ruleType is immutable; on mismatch, warn and skip regardless of strategy.
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
          touchedSubIds.push(existing.id);
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
        touchedSubIds.push(newId);
        result.subscriptions.created += 1;
      }
    }

    if (sections.has('appSettings') && data.appSettings) {
      // telegramAccount + bot ride under appSettings on the wire but persist to their own rows.
      const {
        telegramAccount: importedAccount,
        bot: importedBot,
        ...appSettingsValue
      } = data.appSettings;
      const existing = tx
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, GLOBAL_SETTINGS_KEY))
        .get();
      if (existing && strategy === 'skip') {
        result.appSettings.skipped += 1;
      } else {
        // Merge, don't overwrite: an older export may omit fields the row already holds.
        const mergedValue = {
          ...((existing?.value as Record<string, unknown> | undefined) ?? {}),
          ...appSettingsValue,
        };
        tx.insert(appSettings)
          .values({ key: GLOBAL_SETTINGS_KEY, value: mergedValue })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: mergedValue },
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
      if (importedBot) {
        const wrote = importBotConfig(tx, importedBot, strategy, result, opts.getEncryptionKey);
        if (wrote) botConfigWritten = true;
      }
    }
  });

  // Keep only touched rows still missing an icon, so we never re-download.
  const iconTargets: IconBackfillTarget[] = [];
  if (touchedDestIds.length > 0) {
    const rows = db
      .select({
        id: destinations.id,
        chatId: destinations.chatId,
        iconDataUrl: destinations.iconDataUrl,
      })
      .from(destinations)
      .where(inArray(destinations.id, touchedDestIds))
      .all();
    for (const row of rows) {
      if (row.iconDataUrl === null) {
        iconTargets.push({ kind: 'destination', id: row.id, chatId: row.chatId });
      }
    }
  }
  if (touchedSubIds.length > 0) {
    const rows = db
      .select({
        id: subscriptions.id,
        chatId: subscriptions.sourceChatId,
        iconDataUrl: subscriptions.iconDataUrl,
      })
      .from(subscriptions)
      .where(inArray(subscriptions.id, touchedSubIds))
      .all();
    for (const row of rows) {
      if (row.iconDataUrl === null) {
        iconTargets.push({ kind: 'subscription', id: row.id, chatId: row.chatId });
      }
    }
  }

  return { body: result, telegramAccountWritten, botConfigWritten, iconTargets };
}

// Best-effort, deduped per chatId; each stamp emits a *.changed event so the UI refreshes.
export async function backfillImportedIcons(deps: {
  db: Db;
  bus: EventBus;
  fetchProfilePhoto: ProfilePhotoFetcher;
  targets: IconBackfillTarget[];
  logger: Logger;
}): Promise<number> {
  const { db, bus, fetchProfilePhoto, targets, logger } = deps;
  const cache = new Map<string, string | null>();
  let stamped = 0;

  for (const target of targets) {
    let iconDataUrl = cache.get(target.chatId);
    if (iconDataUrl === undefined) {
      iconDataUrl = await fetchProfilePhoto(target.chatId);
      cache.set(target.chatId, iconDataUrl);
    }
    if (iconDataUrl === null) continue;

    if (target.kind === 'subscription') {
      db.update(subscriptions).set({ iconDataUrl }).where(eq(subscriptions.id, target.id)).run();
      bus.emit({ type: 'subscription.changed', subscriptionId: target.id, change: 'updated' });
    } else {
      db.update(destinations).set({ iconDataUrl }).where(eq(destinations.id, target.id)).run();
      bus.emit({ type: 'destination.changed', destinationId: target.id, change: 'updated' });
    }
    stamped += 1;
  }

  logger.debug({ requested: targets.length, stamped }, 'import icon backfill complete');
  return stamped;
}

// false = skipped: no key, fingerprint mismatch, or skip strategy.
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

// false = nothing written: skip strategy on an existing row, or an empty patch.
// The token is fingerprint-gated like the telegram account; admins/publicUrl carry no secret and always apply.
function importBotConfig(
  tx: DbOrTx,
  bot: ExportedBotConfig,
  strategy: ImportConflictStrategy,
  result: ImportResult,
  getEncryptionKey?: () => Buffer | null,
): boolean {
  const existingRow = tx
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, BOT_SETTINGS_KEY))
    .get();
  if (existingRow && strategy === 'skip') return false;

  // Merge onto the stored row so a partial export never drops fields the host already holds.
  const next: Record<string, unknown> = {
    ...((existingRow?.value as Record<string, unknown> | undefined) ?? {}),
  };
  if (bot.admins !== undefined) next.admins = bot.admins;
  if (bot.publicUrl !== undefined) next.publicUrl = bot.publicUrl;
  if (bot.token) {
    const key = getEncryptionKey?.() ?? null;
    if (!key) {
      result.warnings.push({
        kind: 'bot_token_no_key',
        message: 'bot token skipped: TG_SESSION_ENCRYPTION_KEY is not configured on this host',
      });
    } else if (getKeyFingerprint(key) !== bot.token.keyFingerprint) {
      result.warnings.push({
        kind: 'bot_token_key_mismatch',
        message:
          'bot token skipped: encrypted with a different TG_SESSION_ENCRYPTION_KEY (fingerprint mismatch)',
      });
    } else {
      next.token = { ciphertext: bot.token.ciphertext, keyFingerprint: bot.token.keyFingerprint };
    }
  }

  if (Object.keys(next).length === 0) return false;
  tx.insert(appSettings)
    .values({ key: BOT_SETTINGS_KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next } })
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

// Already validated by exportFileSchema; warning hook retained for future schema drift.
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
      // Pre-detach to dodge FK RESTRICT on subscription_library_filters → library_filters.
      tx.delete(subscriptionLibraryFilters).run();
      const result = tx.delete(libraryFilters).run();
      deleted.libraryFilters = result.changes;
    }
    if (sections.has('destinations')) {
      // FK is ON DELETE SET NULL on subscriptions.destination_id, so subscriptions survive.
      const result = tx.delete(destinations).run();
      deleted.destinations = result.changes;
    }
  });

  return { deleted };
}
