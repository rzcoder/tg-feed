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
    /** Present in native Telegram clients (Desktop/iOS/Android webviews). */
    TelegramWebviewProxy?: unknown;
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
 * Best-effort detection of a Telegram launch that works BEFORE the (async)
 * SDK script has populated `window.Telegram.WebApp`. Native clients expose
 * `TelegramWebviewProxy`; web clients put the launch params in the URL hash
 * as `tgWebAppData`. Used to decide whether it's worth waiting for the SDK.
 */
export function detectTelegramLaunch(): boolean {
  if (typeof window === 'undefined') return false;
  if (getTelegramInitData() !== null) return true;
  if (window.TelegramWebviewProxy !== undefined) return true;
  return window.location.hash.includes('tgWebAppData');
}

/**
 * Resolve the signed initData once the async SDK has populated it. Resolves
 * immediately when it's already present, or with null when this isn't a
 * Telegram launch. When it *is* a Telegram launch but the SDK script hasn't
 * finished loading yet, polls briefly (up to `timeoutMs`) before giving up
 * and falling back to null (→ password login). This closes the race opened
 * by loading the SDK `async`.
 */
export function waitForTelegramInitData(timeoutMs = 3000, intervalMs = 50): Promise<string | null> {
  const immediate = getTelegramInitData();
  if (immediate) return Promise.resolve(immediate);
  if (!detectTelegramLaunch()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = (): void => {
      const data = getTelegramInitData();
      if (data) return resolve(data);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    setTimeout(tick, intervalMs);
  });
}

/**
 * Telegram's current light/dark scheme, or null when not in Telegram / the
 * SDK isn't loaded. Lets the app's `system` theme preference follow the
 * surrounding Telegram chrome instead of the OS `prefers-color-scheme`.
 */
export function getTelegramColorScheme(): 'light' | 'dark' | null {
  const scheme = getTelegramWebApp()?.colorScheme;
  return scheme === 'light' || scheme === 'dark' ? scheme : null;
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
