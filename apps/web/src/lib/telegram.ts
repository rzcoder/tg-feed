/**
 * Telegram Mini App helpers.
 *
 * The Telegram SDK script (loaded in index.html) injects
 * `window.Telegram.WebApp` when the page runs inside a Telegram client. We
 * only need a sliver of its surface: the signed `initData` string (posted to
 * `/api/auth/telegram`) and a couple of lifecycle/theming calls. Everything
 * here is defensive — outside Telegram the global is absent and the helpers
 * report "not in Telegram" so the app falls back to password login.
 */

interface TelegramWebApp {
  /** Signed init payload. Empty string when not launched from Telegram. */
  initData: string;
  /** Signals to Telegram that the app is ready to be shown. */
  ready: () => void;
  /** Expands the Mini App to full height. */
  expand: () => void;
  colorScheme?: 'light' | 'dark';
}

interface TelegramNamespace {
  WebApp?: TelegramWebApp;
}

declare global {
  interface Window {
    Telegram?: TelegramNamespace;
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * The signed initData string, or null when not running inside Telegram (the
 * SDK leaves `initData` as an empty string outside a Telegram client).
 */
export function getTelegramInitData(): string | null {
  const webApp = getTelegramWebApp();
  if (!webApp || !webApp.initData) return null;
  return webApp.initData;
}

/** True when the app is being rendered inside a Telegram client. */
export function isInsideTelegram(): boolean {
  return getTelegramInitData() !== null;
}

/**
 * Tell Telegram the Mini App is ready and expand it to full height. Safe to
 * call unconditionally — a no-op outside Telegram.
 */
export function initTelegramViewport(): void {
  const webApp = getTelegramWebApp();
  if (!webApp) return;
  try {
    webApp.ready();
    webApp.expand();
  } catch {
    // SDK present but a call failed (old client). Non-fatal.
  }
}
