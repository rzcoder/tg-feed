/**
 * Settings routes.
 *
 * Wire format is the flat `{ delayMs, albumDebounceMs }`; internally this
 * maps to the `app_settings` row keyed `'global'` whose `value` JSON is the
 * same shape. PUT accepts a partial body (either field optional) and merges
 * into the existing row, so the UI can edit one knob at a time without
 * round-tripping the other.
 *
 * `GET` never 404s. If the row is missing or malformed, fall back to the
 * documented defaults (8 s throttle, 2 s album window) — same defensive
 * read the forwarding pipeline does in `getGlobalDelayMs` /
 * `getAlbumDebounceMs`. Settings always exist with sane defaults from the
 * client's perspective.
 */
import type { FastifyInstance } from 'fastify';
import { updateSettingsRequestSchema, type SettingsDto } from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { appSettings } from '../../db/schema.js';
import {
  DEFAULT_ALBUM_DEBOUNCE_MS,
  DEFAULT_DELAY_MS,
  GLOBAL_SETTINGS_KEY,
  getAlbumDebounceMs,
  getGlobalDelayMs,
} from '../../forwarding/throttle.js';

export interface RegisterSettingsDeps {
  db: Db;
}

export function registerSettingsRoutes(app: FastifyInstance, deps: RegisterSettingsDeps): void {
  const { db } = deps;

  app.get('/settings', async () => {
    const response: SettingsDto = {
      delayMs: getGlobalDelayMs(db),
      albumDebounceMs: getAlbumDebounceMs(db),
    };
    return response;
  });

  app.put('/settings', async (request) => {
    const body = updateSettingsRequestSchema.parse(request.body);
    // Merge: read current values (with defaults for missing/malformed rows),
    // overlay any fields the client supplied, write the unified row back.
    // Keeps callers that only know about one knob from clobbering the other.
    const merged = {
      delayMs: body.delayMs ?? getGlobalDelayMs(db),
      albumDebounceMs: body.albumDebounceMs ?? getAlbumDebounceMs(db),
    };
    db.insert(appSettings)
      .values({ key: GLOBAL_SETTINGS_KEY, value: merged })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: merged } })
      .run();
    const response: SettingsDto = merged;
    return response;
  });
}

// Re-export for tests that want to assert default values.
export { DEFAULT_DELAY_MS, DEFAULT_ALBUM_DEBOUNCE_MS };
