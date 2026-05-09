/**
 * Settings routes.
 *
 * Wire format is the flat `{ delayMs }`; internally this maps to the
 * `app_settings` row keyed `'global'` whose `value` JSON is `{ delayMs }`.
 * The multi-key abstraction is hidden — adding a future setting can
 * simply add a field to the wire shape and serialize alongside.
 *
 * `GET` never 404s. If the row is missing or malformed, fall back to
 * `DEFAULT_DELAY_MS` (8 s) — same defensive read the forwarding pipeline
 * already does in `getGlobalDelayMs`. Settings always exist with sane
 * defaults from the client's perspective.
 */
import type { FastifyInstance } from 'fastify';
import { updateSettingsRequestSchema, type SettingsDto } from '@tg-feed/shared';
import type { Db } from '../../db/client.js';
import { appSettings } from '../../db/schema.js';
import {
  DEFAULT_DELAY_MS,
  GLOBAL_SETTINGS_KEY,
  getGlobalDelayMs,
} from '../../forwarding/throttle.js';

export interface RegisterSettingsDeps {
  db: Db;
}

export function registerSettingsRoutes(app: FastifyInstance, deps: RegisterSettingsDeps): void {
  const { db } = deps;

  app.get('/settings', async () => {
    const response: SettingsDto = { delayMs: getGlobalDelayMs(db) };
    return response;
  });

  app.put('/settings', async (request) => {
    const body = updateSettingsRequestSchema.parse(request.body);
    const value = { delayMs: body.delayMs };
    db.insert(appSettings)
      .values({ key: GLOBAL_SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
      .run();
    const response: SettingsDto = { delayMs: body.delayMs };
    return response;
  });
}

// Re-export for tests that want to assert default value
export { DEFAULT_DELAY_MS };
