// Telegram Mini App helpers. The SDK injects window.Telegram.WebApp inside a Telegram client; outside it the global is absent and getters return null.

interface TelegramWebApp {
  // Empty string when not launched from Telegram.
  initData: string;
  // UNVERIFIED — cosmetic hints only, never for authorization (use signed initData server-side).
  initDataUnsafe?: { user?: { id: number } };
  ready: () => void;
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

export function getTelegramInitData(): string | null {
  const webApp = getTelegramWebApp();
  if (!webApp || !webApp.initData) return null;
  return webApp.initData;
}

export function isInsideTelegram(): boolean {
  return getTelegramInitData() !== null;
}

// From unverified initDataUnsafe — cosmetic hints only, never authorization.
export function getTelegramUserId(): string | null {
  const id = getTelegramWebApp()?.initDataUnsafe?.user?.id;
  return typeof id === 'number' ? String(id) : null;
}

// Detects a launch BEFORE the async SDK populates window.Telegram.WebApp (via TelegramWebviewProxy or the tgWebAppData hash).
export function detectTelegramLaunch(): boolean {
  if (typeof window === 'undefined') return false;
  if (getTelegramInitData() !== null) return true;
  if (window.TelegramWebviewProxy !== undefined) return true;
  return window.location.hash.includes('tgWebAppData');
}

// Resolves initData now if present, null if not a launch, else polls up to timeoutMs while the async SDK populates it.
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

// Lets the `system` theme follow Telegram chrome instead of OS prefers-color-scheme.
export function getTelegramColorScheme(): 'light' | 'dark' | null {
  const scheme = getTelegramWebApp()?.colorScheme;
  return scheme === 'light' || scheme === 'dark' ? scheme : null;
}

// No-op outside Telegram, safe to call unconditionally.
export function initTelegramViewport(): void {
  const webApp = getTelegramWebApp();
  if (!webApp) return;
  try {
    webApp.ready();
    webApp.expand();
  } catch {
    // Non-fatal: SDK present but a call failed (old client).
  }
}
