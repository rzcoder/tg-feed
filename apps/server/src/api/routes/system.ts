/**
 * System status routes.
 *
 * Surface enough info for the web UI to explain why some features are
 * unavailable (e.g. Telegram disconnected → subscribing/forwarding
 * disabled). Status is captured at boot — reconnection / live health
 * checks are out of scope.
 */
import type { FastifyInstance } from 'fastify';
import type { SystemStatusResponse, TelegramStatus } from '@tg-feed/shared';

export interface RegisterSystemRoutesDeps {
  telegramStatus: TelegramStatus;
}

export function registerSystemRoutes(app: FastifyInstance, deps: RegisterSystemRoutesDeps): void {
  app.get('/system/status', async (): Promise<SystemStatusResponse> => {
    return { telegram: deps.telegramStatus };
  });
}
