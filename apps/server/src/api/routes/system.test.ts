import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  EXPORT_SCHEMA_VERSION,
  type ExportFile,
  type ImportResult,
  type WipeResult,
} from '@tg-feed/shared';
import {
  destinations,
  libraryFilters,
  subscriptionFilters,
  subscriptionLibraryFilters,
  subscriptions,
  appSettings,
  telegramAccount,
} from '../../db/schema.js';
import { GLOBAL_SETTINGS_KEY } from '../../forwarding/throttle.js';
import { encryptSessionString, getKeyFingerprint } from '../../lib/sessionCrypto.js';
import { buildTestApp, seedDestination, type TestApp } from '../testing.js';

describe('system export/import/wipe routes', () => {
  let testApp: TestApp;
  let cookie: string;

  beforeEach(async () => {
    testApp = await buildTestApp();
    cookie = await testApp.loginAndGetCookie();
  });
  afterEach(async () => {
    await testApp.close();
  });

  // --- Auth ----------------------------------------------------------------

  it('POST /api/system/export rejects unauthenticated', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/export',
      payload: { sections: ['destinations'] },
    });
    expect(res.statusCode).toBe(401);
  });

  // --- Export --------------------------------------------------------------

  it('POST /api/system/export returns minimal envelope on empty DB', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/export',
      headers: { cookie },
      payload: { sections: ['destinations', 'libraryFilters', 'subscriptions', 'appSettings'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ExportFile;
    expect(body.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(typeof body.exportedAt).toBe('string');
    expect(typeof body.appVersion).toBe('string');
    expect(body.destinations).toEqual([]);
    expect(body.libraryFilters).toEqual([]);
    expect(body.subscriptions).toEqual([]);
    expect(body.appSettings).toBeDefined();
  });

  it('POST /api/system/export omits sections not requested', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/export',
      headers: { cookie },
      payload: { sections: ['destinations'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ExportFile;
    expect(body.destinations).toBeDefined();
    expect(body.subscriptions).toBeUndefined();
    expect(body.libraryFilters).toBeUndefined();
    expect(body.appSettings).toBeUndefined();
  });

  it('POST /api/system/export returns seeded items with embedded relations', async () => {
    const destId = seedDestination(testApp.db, { name: 'main', chatId: '-1001000000001' });
    testApp.db
      .insert(libraryFilters)
      .values({
        name: 'short',
        ruleType: 'min-length',
        params: { min: 50 },
        mode: 'include',
      })
      .run();
    const libRow = testApp.db.select().from(libraryFilters).all()[0]!;
    const subInsert = testApp.db
      .insert(subscriptions)
      .values({
        sourceChatId: '-1002000000001',
        sourceTitle: 'Source',
        handle: '@src',
        destinationId: destId,
        enabled: true,
      })
      .returning({ id: subscriptions.id })
      .all();
    const subId = subInsert[0]!.id;
    testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: subId,
        ruleType: 'has-media',
        params: { required: true },
        mode: 'include',
        enabled: true,
      })
      .run();
    testApp.db
      .insert(subscriptionLibraryFilters)
      .values({ subscriptionId: subId, libraryFilterId: libRow.id })
      .run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/export',
      headers: { cookie },
      payload: { sections: ['destinations', 'libraryFilters', 'subscriptions'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ExportFile;
    expect(body.destinations).toEqual([{ name: 'main', chatId: '-1001000000001', note: null }]);
    expect(body.libraryFilters).toHaveLength(1);
    expect(body.libraryFilters![0]).toMatchObject({
      name: 'short',
      ruleType: 'min-length',
      mode: 'include',
    });
    expect(body.subscriptions).toHaveLength(1);
    const sub = body.subscriptions![0]!;
    expect(sub.sourceChatId).toBe('-1002000000001');
    expect(sub.destination).toEqual({ chatId: '-1001000000001', name: 'main' });
    expect(sub.inlineFilters).toHaveLength(1);
    expect(sub.inlineFilters[0]!.ruleType).toBe('has-media');
    expect(sub.libraryFilters).toEqual([{ name: 'short' }]);
  });

  it('POST /api/system/export emits null destination for detached subscription', async () => {
    testApp.db
      .insert(subscriptions)
      .values({
        sourceChatId: '-1002000000099',
        sourceTitle: 'Detached',
        destinationId: null,
        enabled: false,
      })
      .run();
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/export',
      headers: { cookie },
      payload: { sections: ['subscriptions'] },
    });
    const body = res.json() as ExportFile;
    expect(body.subscriptions![0]!.destination).toBeNull();
  });

  // --- Import: round-trip --------------------------------------------------

  it('POST /api/system/import round-trips an exported envelope', async () => {
    const destId = seedDestination(testApp.db, { name: 'main', chatId: '-1001000000001' });
    testApp.db
      .insert(libraryFilters)
      .values({ name: 'short', ruleType: 'min-length', params: { min: 50 }, mode: 'include' })
      .run();
    const libRow = testApp.db.select().from(libraryFilters).all()[0]!;
    const subInsert = testApp.db
      .insert(subscriptions)
      .values({
        sourceChatId: '-1002000000001',
        sourceTitle: 'Source',
        destinationId: destId,
        enabled: true,
      })
      .returning({ id: subscriptions.id })
      .all();
    testApp.db
      .insert(subscriptionLibraryFilters)
      .values({ subscriptionId: subInsert[0]!.id, libraryFilterId: libRow.id })
      .run();

    // Export.
    const exportRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/export',
      headers: { cookie },
      payload: { sections: ['destinations', 'libraryFilters', 'subscriptions'] },
    });
    const exported = exportRes.json() as ExportFile;

    // Wipe everything (simulating fresh install).
    testApp.db.delete(subscriptionLibraryFilters).run();
    testApp.db.delete(subscriptionFilters).run();
    testApp.db.delete(subscriptions).run();
    testApp.db.delete(libraryFilters).run();
    testApp.db.delete(destinations).run();

    // Import.
    const importRes = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: {
        sections: ['destinations', 'libraryFilters', 'subscriptions'],
        conflictStrategy: 'skip',
        data: exported,
      },
    });
    expect(importRes.statusCode).toBe(200);
    const result = importRes.json() as ImportResult;
    expect(result.destinations.created).toBe(1);
    expect(result.libraryFilters.created).toBe(1);
    expect(result.subscriptions.created).toBe(1);
    expect(result.warnings).toEqual([]);

    expect(testApp.db.select().from(destinations).all()).toHaveLength(1);
    expect(testApp.db.select().from(libraryFilters).all()).toHaveLength(1);
    expect(testApp.db.select().from(subscriptions).all()).toHaveLength(1);
    expect(testApp.db.select().from(subscriptionLibraryFilters).all()).toHaveLength(1);
  });

  // --- Import: conflict strategies ----------------------------------------

  it('POST /api/system/import skip leaves existing destination untouched', async () => {
    seedDestination(testApp.db, { name: 'main', chatId: '-1001000000001', note: 'original' });
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      destinations: [{ name: 'main', chatId: '-1001000000001', note: 'imported' }],
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['destinations'], conflictStrategy: 'skip', data },
    });
    const result = res.json() as ImportResult;
    expect(result.destinations.skipped).toBe(1);
    expect(result.destinations.replaced).toBe(0);

    const rows = testApp.db.select().from(destinations).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe('original');
  });

  it('POST /api/system/import replace updates existing destination note', async () => {
    seedDestination(testApp.db, { name: 'main', chatId: '-1001000000001', note: 'original' });
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      destinations: [{ name: 'main', chatId: '-1001000000001', note: 'updated' }],
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['destinations'], conflictStrategy: 'replace', data },
    });
    const result = res.json() as ImportResult;
    expect(result.destinations.replaced).toBe(1);
    expect(testApp.db.select().from(destinations).all()[0]!.note).toBe('updated');
  });

  it('POST /api/system/import treats (chatId, name) as the destination key', async () => {
    seedDestination(testApp.db, { name: 'first', chatId: '-1001000000001' });
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      // Same chatId, different name → treated as a separate row.
      destinations: [{ name: 'second', chatId: '-1001000000001', note: null }],
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['destinations'], conflictStrategy: 'skip', data },
    });
    const result = res.json() as ImportResult;
    expect(result.destinations.created).toBe(1);
    expect(testApp.db.select().from(destinations).all()).toHaveLength(2);
  });

  // --- Import: warnings ----------------------------------------------------

  it('POST /api/system/import leaves subscription detached and warns when destination is missing', async () => {
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      subscriptions: [
        {
          sourceChatId: '-1002000000099',
          sourceTitle: 'Orphan',
          handle: null,
          enabled: true,
          destination: { chatId: '-1009999999999', name: 'absent' },
          inlineFilters: [],
          libraryFilters: [],
        },
      ],
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['subscriptions'], conflictStrategy: 'skip', data },
    });
    const result = res.json() as ImportResult;
    expect(result.subscriptions.created).toBe(1);
    expect(result.warnings.some((w) => w.kind === 'destination_missing')).toBe(true);

    const sub = testApp.db.select().from(subscriptions).all()[0]!;
    expect(sub.destinationId).toBeNull();
  });

  it('POST /api/system/import warns on unknown library filter name and creates subscription anyway', async () => {
    const destId = seedDestination(testApp.db, { name: 'main', chatId: '-1001000000001' });
    void destId; // destinationId on import is resolved by chatId+name, not numeric id.
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      subscriptions: [
        {
          sourceChatId: '-1002000000099',
          sourceTitle: 'OrphanLib',
          handle: null,
          enabled: true,
          destination: { chatId: '-1001000000001', name: 'main' },
          inlineFilters: [],
          libraryFilters: [{ name: 'never-was' }],
        },
      ],
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['subscriptions'], conflictStrategy: 'skip', data },
    });
    const result = res.json() as ImportResult;
    expect(result.subscriptions.created).toBe(1);
    expect(result.warnings.some((w) => w.kind === 'library_filter_missing')).toBe(true);
    expect(testApp.db.select().from(subscriptionLibraryFilters).all()).toHaveLength(0);
  });

  it('POST /api/system/import warns when existing library filter has a different ruleType', async () => {
    testApp.db
      .insert(libraryFilters)
      .values({ name: 'tag', ruleType: 'min-length', params: { min: 50 }, mode: 'include' })
      .run();
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      libraryFilters: [
        {
          name: 'tag',
          ruleType: 'has-media',
          params: { required: true },
          mode: 'include',
        },
      ],
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['libraryFilters'], conflictStrategy: 'replace', data },
    });
    const result = res.json() as ImportResult;
    expect(result.libraryFilters.skipped).toBe(1);
    expect(result.warnings.some((w) => w.kind === 'rule_type_mismatch')).toBe(true);
  });

  // --- Import: schema version ---------------------------------------------

  it('POST /api/system/import rejects newer schemaVersion with code export_schema_too_new', async () => {
    const data: ExportFile = {
      schemaVersion: 999,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['destinations'], conflictStrategy: 'skip', data },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('export_schema_too_new');
  });

  // --- Import: app settings -----------------------------------------------

  it('POST /api/system/import skip preserves existing app settings', async () => {
    testApp.db
      .insert(appSettings)
      .values({ key: GLOBAL_SETTINGS_KEY, value: { delayMs: 5000, albumDebounceMs: 1500 } })
      .run();
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      appSettings: { delayMs: 12000, albumDebounceMs: 3000 },
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['appSettings'], conflictStrategy: 'skip', data },
    });
    const result = res.json() as ImportResult;
    expect(result.appSettings.skipped).toBe(1);
    const row = testApp.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, GLOBAL_SETTINGS_KEY))
      .get();
    expect((row!.value as { delayMs: number }).delayMs).toBe(5000);
  });

  it('POST /api/system/import replace overwrites app settings', async () => {
    testApp.db
      .insert(appSettings)
      .values({ key: GLOBAL_SETTINGS_KEY, value: { delayMs: 5000, albumDebounceMs: 1500 } })
      .run();
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      appSettings: { delayMs: 12000, albumDebounceMs: 3000 },
    };
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['appSettings'], conflictStrategy: 'replace', data },
    });
    const result = res.json() as ImportResult;
    expect(result.appSettings.replaced).toBe(1);
    const row = testApp.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, GLOBAL_SETTINGS_KEY))
      .get();
    expect((row!.value as { delayMs: number }).delayMs).toBe(12000);
  });

  // --- Wipe ---------------------------------------------------------------

  it('POST /api/system/wipe clears subscriptions and cascades inline filters', async () => {
    const destId = seedDestination(testApp.db);
    const sub = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'src', sourceTitle: 'X', destinationId: destId })
      .returning({ id: subscriptions.id })
      .all();
    testApp.db
      .insert(subscriptionFilters)
      .values({
        subscriptionId: sub[0]!.id,
        ruleType: 'has-media',
        params: { required: true },
        mode: 'include',
      })
      .run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      headers: { cookie },
      payload: { sections: ['subscriptions'] },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as WipeResult;
    expect(result.deleted.subscriptions).toBe(1);
    expect(testApp.db.select().from(subscriptions).all()).toHaveLength(0);
    expect(testApp.db.select().from(subscriptionFilters).all()).toHaveLength(0);
    expect(testApp.db.select().from(destinations).all()).toHaveLength(1);
  });

  it('POST /api/system/wipe clears destinations and detaches subscriptions', async () => {
    const destId = seedDestination(testApp.db);
    testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'src', sourceTitle: 'X', destinationId: destId })
      .run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      headers: { cookie },
      payload: { sections: ['destinations'] },
    });
    const result = res.json() as WipeResult;
    expect(result.deleted.destinations).toBe(1);
    expect(testApp.db.select().from(destinations).all()).toHaveLength(0);
    const subRows = testApp.db.select().from(subscriptions).all();
    expect(subRows).toHaveLength(1);
    expect(subRows[0]!.destinationId).toBeNull();
  });

  it('POST /api/system/wipe clears library filters even when attached', async () => {
    const destId = seedDestination(testApp.db);
    const sub = testApp.db
      .insert(subscriptions)
      .values({ sourceChatId: 'src', sourceTitle: 'X', destinationId: destId })
      .returning({ id: subscriptions.id })
      .all();
    testApp.db
      .insert(libraryFilters)
      .values({ name: 'L', ruleType: 'min-length', params: { min: 1 }, mode: 'include' })
      .run();
    const lib = testApp.db.select().from(libraryFilters).all()[0]!;
    testApp.db
      .insert(subscriptionLibraryFilters)
      .values({ subscriptionId: sub[0]!.id, libraryFilterId: lib.id })
      .run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      headers: { cookie },
      payload: { sections: ['libraryFilters'] },
    });
    const result = res.json() as WipeResult;
    expect(result.deleted.libraryFilters).toBe(1);
    expect(testApp.db.select().from(libraryFilters).all()).toHaveLength(0);
    expect(testApp.db.select().from(subscriptionLibraryFilters).all()).toHaveLength(0);
    expect(testApp.db.select().from(subscriptions).all()).toHaveLength(1);
  });

  // --- Import: telegram account inside appSettings -----------------------

  it('POST /api/system/export embeds the telegram_account row inside appSettings', async () => {
    const key = randomBytes(32);
    const env = encryptSessionString('FAKE_SESSION_STRING', key);
    const now = new Date();
    testApp.db
      .insert(telegramAccount)
      .values({
        id: 1,
        encryptedSessionString: env.ciphertext,
        keyFingerprint: env.keyFingerprint,
        phoneNumber: '+15551234567',
        displayName: 'Tester',
        username: 'tester',
        telegramUserId: '123',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/export',
      headers: { cookie },
      payload: { sections: ['appSettings'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ExportFile;
    expect(body.appSettings?.telegramAccount).toMatchObject({
      keyFingerprint: env.keyFingerprint,
      phoneNumber: '+15551234567',
      displayName: 'Tester',
      username: 'tester',
      telegramUserId: '123',
    });
  });

  it('POST /api/system/import skips the embedded account when no encryption key is configured', async () => {
    const key = randomBytes(32);
    const env = encryptSessionString('SESSION', key);
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      appSettings: {
        delayMs: 8000,
        albumDebounceMs: 2000,
        telegramAccount: {
          encryptedSessionString: env.ciphertext,
          keyFingerprint: env.keyFingerprint,
          phoneNumber: null,
          displayName: 'X',
          username: 'x',
          telegramUserId: '1',
        },
      },
    };
    // No `getEncryptionKey` dep on the test app → key is treated as null.
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/import',
      headers: { cookie },
      payload: { sections: ['appSettings'], conflictStrategy: 'replace', data },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json() as ImportResult;
    expect(result.warnings.some((w) => w.kind === 'telegram_account_no_key')).toBe(true);
    expect(testApp.db.select().from(telegramAccount).all()).toHaveLength(0);
  });

  it('POST /api/system/import skips the embedded account on key fingerprint mismatch', async () => {
    const exportedKey = randomBytes(32);
    const localKey = randomBytes(32);
    const env = encryptSessionString('SESSION', exportedKey);
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      appSettings: {
        delayMs: 8000,
        albumDebounceMs: 2000,
        telegramAccount: {
          encryptedSessionString: env.ciphertext,
          keyFingerprint: env.keyFingerprint,
          phoneNumber: null,
          displayName: null,
          username: null,
          telegramUserId: null,
        },
      },
    };
    const app = await buildTestApp({ getEncryptionKey: () => localKey });
    const localCookie = await app.loginAndGetCookie();
    try {
      const res = await app.app.inject({
        method: 'POST',
        url: '/api/system/import',
        headers: { cookie: localCookie },
        payload: { sections: ['appSettings'], conflictStrategy: 'replace', data },
      });
      expect(res.statusCode).toBe(200);
      const result = res.json() as ImportResult;
      expect(result.warnings.some((w) => w.kind === 'telegram_account_key_mismatch')).toBe(true);
      expect(app.db.select().from(telegramAccount).all()).toHaveLength(0);
      // Sanity: the non-account part of appSettings still imported.
      expect(result.appSettings.created + result.appSettings.replaced).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('POST /api/system/import upserts the embedded account when fingerprint matches', async () => {
    const key = randomBytes(32);
    const env = encryptSessionString('SESSION', key);
    const data: ExportFile = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: '2026-05-10T00:00:00.000Z',
      appVersion: '0.1.0',
      appSettings: {
        delayMs: 8000,
        albumDebounceMs: 2000,
        telegramAccount: {
          encryptedSessionString: env.ciphertext,
          keyFingerprint: getKeyFingerprint(key),
          phoneNumber: '+15551234567',
          displayName: 'Imported',
          username: 'imp',
          telegramUserId: '42',
        },
      },
    };
    const app = await buildTestApp({ getEncryptionKey: () => key });
    const localCookie = await app.loginAndGetCookie();
    try {
      const res = await app.app.inject({
        method: 'POST',
        url: '/api/system/import',
        headers: { cookie: localCookie },
        payload: { sections: ['appSettings'], conflictStrategy: 'replace', data },
      });
      expect(res.statusCode).toBe(200);
      const result = res.json() as ImportResult;
      expect(result.warnings.filter((w) => w.kind.startsWith('telegram_account'))).toHaveLength(0);
      const rows = app.db.select().from(telegramAccount).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.username).toBe('imp');
      expect(rows[0]!.keyFingerprint).toBe(getKeyFingerprint(key));
    } finally {
      await app.close();
    }
  });

  it('POST /api/system/wipe is idempotent', async () => {
    const res1 = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      headers: { cookie },
      payload: { sections: ['subscriptions', 'destinations', 'libraryFilters'] },
    });
    expect((res1.json() as WipeResult).deleted).toEqual({
      subscriptions: 0,
      destinations: 0,
      libraryFilters: 0,
    });

    const res2 = await testApp.app.inject({
      method: 'POST',
      url: '/api/system/wipe',
      headers: { cookie },
      payload: { sections: ['subscriptions'] },
    });
    expect(res2.statusCode).toBe(200);
  });
});
